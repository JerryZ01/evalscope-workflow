from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.database import Base
from app.db.models import EvaluationTask, TaskStatus
from app.services import task_state


async def test_task_state_uses_configured_session_factory(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'tasks.db'}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(task_state, "async_session_maker", session_factory)

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async with session_factory() as session:
        task = EvaluationTask(
            name="test",
            model_name="mock",
            model_type="mock_llm",
            datasets=["demo"],
            status=TaskStatus.PENDING,
        )
        session.add(task)
        await session.commit()
        await session.refresh(task)
        task_id = task.id

    assert await task_state.update_task_state(
        task_id,
        status=TaskStatus.RUNNING,
        progress=25,
        current_step="running",
        output_dir=str(tmp_path / "outputs"),
    )
    assert await task_state.append_task_logs(task_id, "line one\n")
    assert await task_state.update_task_state(
        task_id,
        status=TaskStatus.COMPLETED,
        progress=100,
        current_step="done",
        results={"score": 1.0, "metrics": []},
    )

    async with session_factory() as session:
        result = await session.execute(
            select(EvaluationTask).where(EvaluationTask.id == task_id)
        )
        saved = result.scalar_one()
        assert saved.status == TaskStatus.COMPLETED
        assert saved.progress == 100
        assert saved.results["score"] == 1.0
        assert saved.logs == "line one\n"
        assert saved.output_dir == str(tmp_path / "outputs")
        assert saved.started_at is not None
        assert saved.completed_at is not None

    await engine.dispose()
