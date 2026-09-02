"""Small, bounded messages for EvalScope subprocess communication."""

import sys


MAX_ERROR_LOG_CHARS = 16 * 1024


class _TailCapture:
    """Text stream that keeps only a bounded tail for failure diagnostics."""

    encoding = "utf-8"

    def __init__(self, max_chars: int = MAX_ERROR_LOG_CHARS):
        self.max_chars = max_chars
        self._value = ""

    def write(self, value: str) -> int:
        text = str(value)
        self._value = (self._value + text)[-self.max_chars:]
        return len(text)

    def flush(self) -> None:
        pass

    def getvalue(self) -> str:
        return self._value


def run_eval_subprocess(config, result_queue) -> None:
    """Run EvalScope and send only completion metadata through the IPC pipe."""
    old_stdout = sys.stdout
    old_stderr = sys.stderr
    stdout_capture = _TailCapture()
    stderr_capture = _TailCapture()

    try:
        sys.stdout = stdout_capture
        sys.stderr = stderr_capture

        from evalscope import run_task

        run_task(config)
        # Reports and normal logs already live under config.work_dir. Sending
        # them again can fill multiprocessing.Queue's pipe during process exit.
        result_queue.put({"error": None, "logs": ""})
    except Exception as exc:
        captured = stdout_capture.getvalue() + stderr_capture.getvalue()
        error_logs = f"{captured}\n\n错误: {exc}\n"[-MAX_ERROR_LOG_CHARS:]
        result_queue.put({"error": str(exc), "logs": error_logs})
    finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr
