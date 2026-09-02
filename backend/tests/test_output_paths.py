from datetime import datetime

from app.core.output_paths import build_run_directory_name


def test_run_directory_name_uses_detailed_timestamp():
    timestamp = datetime(2026, 8, 26, 15, 18, 27, 603150)

    assert build_run_directory_name(timestamp) == "20260826_151827_603150"


def test_run_directory_names_sort_chronologically():
    earlier = datetime(2026, 8, 26, 15, 18, 27, 603150)
    later = datetime(2026, 8, 26, 15, 18, 28, 1)

    assert build_run_directory_name(earlier) < build_run_directory_name(later)
