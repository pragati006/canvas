import time
from collections import defaultdict

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect

from app.models import ApiError

router = APIRouter(tags=["Collaboration"])


class Hub:
    def __init__(self) -> None:
        self.sockets: dict[str, set[WebSocket]] = defaultdict(set)
        self.presence: dict[str, dict[str, dict]] = defaultdict(dict)

    def reset(self) -> None:
        self.sockets.clear()
        self.presence.clear()

    async def broadcast(self, session_id: str, event: dict) -> None:
        dead: list[WebSocket] = []
        for socket in list(self.sockets.get(session_id, ())):
            try:
                await socket.send_json(event)
            except Exception:
                dead.append(socket)
        for socket in dead:
            self.sockets[session_id].discard(socket)


async def publish(request: Request, events: list[tuple[str, dict]]) -> None:
    hub: Hub = request.app.state.hub
    for session_id, event in events:
        await hub.broadcast(session_id, event)


def _presence(participant: dict, **updates) -> dict:
    presence = {
        "participantId": participant["id"],
        "displayName": participant["displayName"],
        "color": participant["color"],
        "role": participant["role"],
        "connectionState": "connected",
        "cursor": None,
        "selection": [],
        "laser": None,
        "lastSeen": int(time.time() * 1000),
    }
    presence.update(updates)
    return presence


@router.websocket("/sessions/{sessionId}/collaboration")
async def collaboration(
    websocket: WebSocket,
    sessionId: str,
    access_token: str | None = None,
    actor: str = "user",
) -> None:
    store = websocket.app.state.store
    hub: Hub = websocket.app.state.hub
    if not access_token:
        await websocket.close(code=1008)
        return
    try:
        room = store.connect_room(access_token, sessionId, actor)
    except ApiError:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    participant = room["participant"]
    hub.sockets[sessionId].add(websocket)
    presence = _presence(participant)
    hub.presence[sessionId][participant["id"]] = presence
    await websocket.send_json(
        {
            "type": "room_joined",
            "document": room["document"],
            "cursor": room["cursor"],
            "epoch": room["epoch"],
            "participants": list(hub.presence[sessionId].values()),
            "session": room["session"],
        }
    )
    await hub.broadcast(sessionId, {"type": "presence_update", "presence": presence})
    try:
        while True:
            message = await websocket.receive_json()
            kind = message.get("type")
            if kind == "ping":
                await websocket.send_json({"type": "pong"})
            elif kind == "presence_update":
                current = hub.presence[sessionId].get(participant["id"], presence)
                for field in ("cursor", "selection", "laser"):
                    if field in message:
                        current[field] = message[field]
                current["lastSeen"] = int(time.time() * 1000)
                current["connectionState"] = "connected"
                hub.presence[sessionId][participant["id"]] = current
                await hub.broadcast(sessionId, {"type": "presence_update", "presence": current})
            elif kind == "document_update":
                try:
                    _cursor, event = store.apply_op(
                        access_token,
                        sessionId,
                        actor,
                        message.get("clientOperationId", ""),
                        message.get("op") or {},
                    )
                except ApiError as error:
                    await websocket.send_json(
                        {
                            "type": "rejected",
                            "code": error.code,
                            "message": error.message,
                            "document": store.room_document(sessionId),
                        }
                    )
                    continue
                if event is not None:
                    await hub.broadcast(sessionId, event)
            else:
                await websocket.send_json({"type": "error", "code": "invalid", "message": "Unsupported message."})
    except WebSocketDisconnect:
        pass
    finally:
        hub.sockets[sessionId].discard(websocket)
        hub.presence[sessionId].pop(participant["id"], None)
        await hub.broadcast(sessionId, {"type": "presence_left", "participantId": participant["id"]})
