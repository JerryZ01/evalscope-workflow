import json
import multiprocessing
import sys
from types import SimpleNamespace

import pytest

from app.core.eval_process import MAX_ERROR_LOG_CHARS, run_eval_subprocess
from evalscope_wrapper.runner import _read_score_from_report_file


class RecordingQueue:
    def __init__(self):
        self.items = []

    def put(self, item):
        self.items.append(item)


def test_success_sends_only_small_completion_message(monkeypatch):
    large_result = {"report": "x" * 1_000_000}

    def fake_run_task(_config):
        print("log" * 500_000)
        return large_result

    monkeypatch.setitem(sys.modules, "evalscope", SimpleNamespace(run_task=fake_run_task))
    queue = RecordingQueue()

    run_eval_subprocess(object(), queue)

    assert queue.items == [{"error": None, "logs": ""}]


def test_large_evaluation_result_does_not_block_process_exit(monkeypatch):
    def fake_run_task(_config):
        print("log" * 500_000)
        return {"report": "x" * 2_000_000}

    monkeypatch.setitem(sys.modules, "evalscope", SimpleNamespace(run_task=fake_run_task))
    context = multiprocessing.get_context("fork")
    queue = context.Queue()
    process = context.Process(target=run_eval_subprocess, args=(object(), queue))

    process.start()
    process.join(timeout=5)
    if process.is_alive():
        process.kill()
        process.join()

    assert process.exitcode == 0
    assert queue.get(timeout=1) == {"error": None, "logs": ""}
    queue.close()
    queue.join_thread()


def test_failure_log_payload_is_bounded(monkeypatch):
    def fake_run_task(_config):
        print("a" * (MAX_ERROR_LOG_CHARS * 2))
        raise RuntimeError("expected failure")

    monkeypatch.setitem(sys.modules, "evalscope", SimpleNamespace(run_task=fake_run_task))
    queue = RecordingQueue()

    run_eval_subprocess(object(), queue)

    payload = queue.items[0]
    assert payload["error"] == "expected failure"
    assert len(payload["logs"]) <= MAX_ERROR_LOG_CHARS
    assert "expected failure" in payload["logs"]


def test_multiple_reports_are_aggregated_from_disk(tmp_path):
    reports_dir = tmp_path / "reports" / "model"
    reports_dir.mkdir(parents=True)
    (reports_dir / "first.json").write_text(
        json.dumps({"score": 0.4, "metrics": [{"name": "first"}]}),
        encoding="utf-8",
    )
    (reports_dir / "second.json").write_text(
        json.dumps({"score": 0.8, "metrics": [{"name": "second"}]}),
        encoding="utf-8",
    )

    result = _read_score_from_report_file(str(tmp_path))

    assert result["score"] == pytest.approx(0.6)
    assert result["metrics"] == [{"name": "first"}, {"name": "second"}]
