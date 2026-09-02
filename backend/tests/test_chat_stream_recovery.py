from types import SimpleNamespace

from app.api.chat import _extract_agent_content, _is_transient_stream_error


def test_detects_incomplete_chunked_stream():
    error = RuntimeError(
        "peer closed connection without sending complete message body "
        "(incomplete chunked read)"
    )

    assert _is_transient_stream_error(error) is True


def test_does_not_retry_regular_model_error():
    assert _is_transient_stream_error(RuntimeError("invalid api key")) is False


def test_extracts_final_agent_message_content():
    result = {
        "messages": [
            SimpleNamespace(content="question"),
            SimpleNamespace(content=[{"type": "text", "text": "answer"}]),
        ]
    }

    assert _extract_agent_content(result) == "answer"
