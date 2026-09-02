import asyncio
from types import SimpleNamespace

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from app.api import workflow as workflow_api
from app.workflows import eval_workflow
from app.workflows.eval_workflow import await_confirmation, validate_params


def test_workflow_state_never_requires_a_secret_value():
    valid = validate_params(
        {
            "model_type": "openai_api",
            "model_url": "https://example.test/v1",
            "has_model_key": True,
        }
    )
    assert valid["current_step"] == "参数校验通过"
    assert await_confirmation({})["current_step"] == "配置已确认"

    invalid = validate_params(
        {
            "model_type": "openai_api",
            "model_url": "https://example.test/v1",
            "has_model_key": False,
        }
    )
    assert invalid["eval_success"] is False
    assert "API Key" in invalid["eval_error"]


async def test_graph_stops_at_one_time_confirmation(monkeypatch):
    async def memory_checkpointer():
        return InMemorySaver()

    monkeypatch.setattr(eval_workflow, "get_checkpointer", memory_checkpointer)
    monkeypatch.setattr(
        "evalscope_wrapper.registry.EvalScopeRegistry.get_dataset_by_name",
        lambda _name: {"need_sandbox": False},
    )

    graph = await eval_workflow.build_eval_workflow()
    config = {"configurable": {"thread_id": "test-confirmation"}}
    await graph.ainvoke(
        {
            "task_id": 1,
            "task_uuid": "test",
            "model_name": "mock",
            "model_type": "mock_llm",
            "model_url": None,
            "has_model_key": False,
            "datasets": ["demo"],
            "generation_config": {},
            "dataset_args": {},
            "eval_batch_size": 1,
            "engine": "native",
            "retry_count": 0,
            "max_retries": 1,
        },
        config=config,
    )
    state = await graph.aget_state(config)
    assert state.next == ("await_confirmation",)
    assert "model_key" not in state.values


async def test_checkpoint_security_migration_runs_on_real_sqlite(tmp_path, monkeypatch):
    checkpoint_path = tmp_path / "checkpoints.db"
    monkeypatch.setattr(eval_workflow, "CHECKPOINT_DB_PATH", str(checkpoint_path))
    monkeypatch.setattr(eval_workflow, "_checkpoint_saver", None)

    saver = await eval_workflow.get_checkpointer()
    cursor = await saver.conn.execute(
        "SELECT value FROM workflow_meta WHERE key='security_schema_version'"
    )
    assert (await cursor.fetchone())[0] == eval_workflow.CHECKPOINT_SCHEMA_VERSION

    await saver.conn.close()
    eval_workflow._checkpoint_saver = None


async def test_retry_does_not_interrupt_for_confirmation_again(monkeypatch):
    calls = 0

    async def memory_checkpointer():
        return InMemorySaver()

    async def fake_run_eval(_state):
        nonlocal calls
        calls += 1
        if calls == 1:
            return {
                "eval_success": False,
                "eval_error": "connection timeout",
                "output_dir": "/tmp/test-output",
            }
        return {"eval_success": True, "eval_score": 1.0, "eval_metrics": []}

    async def fake_collect(_state):
        return {"current_step": "done"}

    monkeypatch.setattr(eval_workflow, "get_checkpointer", memory_checkpointer)
    monkeypatch.setattr(eval_workflow, "run_eval", fake_run_eval)
    monkeypatch.setattr(eval_workflow, "collect_results", fake_collect)
    monkeypatch.setattr(
        "evalscope_wrapper.registry.EvalScopeRegistry.get_dataset_by_name",
        lambda _name: {"need_sandbox": False},
    )

    graph = await eval_workflow.build_eval_workflow()
    config = {"configurable": {"thread_id": "test-retry"}}
    await graph.ainvoke(
        {
            "task_id": 1,
            "task_uuid": "test",
            "model_name": "mock",
            "model_type": "mock_llm",
            "model_url": None,
            "has_model_key": False,
            "datasets": ["demo"],
            "generation_config": {},
            "dataset_args": {},
            "eval_batch_size": 1,
            "engine": "native",
            "retry_count": 0,
            "max_retries": 1,
        },
        config=config,
    )
    await graph.ainvoke(Command(resume=True), config=config)

    state = await graph.aget_state(config)
    assert state.next == ()
    assert state.values["retry_count"] == 1
    assert calls == 2


async def test_confirm_returns_before_background_workflow_finishes(monkeypatch):
    release = asyncio.Event()

    class FakeGraph:
        async def aget_state(self, _config):
            return SimpleNamespace(next=("await_confirmation",), values={})

        async def aupdate_state(self, _config, _values):
            return None

        async def ainvoke(self, _command, config):
            await release.wait()

    async def fake_get_workflow():
        return FakeGraph()

    async def fake_update_status(_db, _task_id, _status, _step):
        return None

    monkeypatch.setattr(workflow_api, "get_workflow", fake_get_workflow)
    monkeypatch.setattr(workflow_api, "_update_task_status", fake_update_status)

    response = await asyncio.wait_for(
        workflow_api.confirm_workflow(
            42, workflow_api.ConfirmRequest(), db=SimpleNamespace()
        ),
        timeout=0.2,
    )
    assert response["status"] == "confirmed"
    assert 42 in workflow_api._workflow_tasks

    release.set()
    await workflow_api._workflow_tasks[42]
