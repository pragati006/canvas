.PHONY: help install frontend backend dev run test

help:
	@echo "make install     Install frontend and backend dependencies"
	@echo "make frontend    Start the interview UI at http://localhost:5173"
	@echo "make backend     Start the API at http://127.0.0.1:8000"
	@echo "make dev         Start the UI and the API together"
	@echo "make run         Same as make dev"
	@echo "make test        Run frontend and backend tests"

install:
	cd frontend && npm install
	cd backend && uv sync

frontend:
	cd frontend && npm run dev

backend:
	cd backend && uv run python -m uvicorn app.main:app --reload

dev run:
	$(MAKE) -j2 frontend backend

test:
	cd frontend && npm test
	cd backend && uv run python -m pytest
