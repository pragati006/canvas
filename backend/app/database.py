import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None


class Base(DeclarativeBase):
    pass


def default_database_url() -> str:
    path = (Path(__file__).resolve().parents[1] / "lattice.db").as_posix()
    return f"sqlite:///{path}"


def database_url() -> str:
    return os.environ.get("DATABASE_URL", default_database_url())


def _engine_for(url: str) -> Engine:
    connect_args: dict[str, object] = {}
    options: dict[str, object] = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
        if url.endswith(":memory:") or url == "sqlite://":
            options["poolclass"] = StaticPool
    return create_engine(url, connect_args=connect_args, **options)


def get_engine() -> Engine:
    global _engine, _session_factory
    if _engine is None:
        _engine = _engine_for(database_url())
        _session_factory = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def init_database() -> None:
    import app.tables  # noqa: F401

    Base.metadata.create_all(get_engine())


@contextmanager
def session_scope() -> Iterator[Session]:
    if _session_factory is None:
        get_engine()
    assert _session_factory is not None
    db = _session_factory()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
