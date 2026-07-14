from datetime import datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.security import ApiAuthMiddleware, router
from app.db.models import EvaluationTask, ManagedModel, TaskStatus
from app.schemas.managed_model import ManagedModelResponse
from app.schemas.task import TaskDetailSchema


def test_auth_cookie_protects_api_without_exposing_token(monkeypatch):
    monkeypatch.setattr(settings, "API_AUTH_TOKEN", "test-secret-token")
    monkeypatch.setattr(settings, "SESSION_COOKIE_SECURE", False)

    app = FastAPI()
    app.add_middleware(ApiAuthMiddleware)
    app.include_router(router, prefix="/api/auth")

    @app.get("/api/protected")
    async def protected():
        return {"ok": True}

    with TestClient(app) as client:
        assert client.get("/api/protected").status_code == 401
        assert client.post("/api/auth/login", json={"token": "wrong"}).status_code == 401

        response = client.post(
            "/api/auth/login", json={"token": "test-secret-token"}
        )
        assert response.status_code == 200
        assert "test-secret-token" not in response.headers["set-cookie"]
        assert "HttpOnly" in response.headers["set-cookie"]
        assert client.get("/api/protected").json() == {"ok": True}


def test_response_schemas_do_not_serialize_api_keys():
    now = datetime.utcnow()
    model = ManagedModel(
        id=1,
        name="model",
        model_type="openai_api",
        model_name="gpt-test",
        api_url="https://example.test/v1",
        api_key="model-secret",
        generation_config={},
        is_default=False,
        is_active=True,
        use_count=0,
        created_at=now,
        updated_at=now,
    )
    model_payload = ManagedModelResponse.model_validate(model).model_dump()
    assert "api_key" not in model_payload
    assert model_payload["has_api_key"] is True

    task = EvaluationTask(
        id=1,
        task_uuid="00000000-0000-0000-0000-000000000001",
        name="task",
        model_name="gpt-test",
        model_type="openai_api",
        model_url="https://example.test/v1",
        model_key="task-secret",
        generation_config={},
        datasets=["gsm8k"],
        dataset_args={},
        eval_batch_size=1,
        engine="native",
        rerun_review=False,
        status=TaskStatus.PENDING,
        progress=0,
        created_at=now,
        updated_at=now,
    )
    task_payload = TaskDetailSchema.model_validate(task).model_dump()
    assert "model_key" not in task_payload
    assert task_payload["has_model_key"] is True
