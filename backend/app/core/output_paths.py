"""Helpers for naming evaluation output directories."""

from datetime import datetime
from typing import Optional


def build_run_directory_name(now: Optional[datetime] = None) -> str:
    """Return a locally ordered, microsecond-precision run timestamp."""
    return (now or datetime.now()).strftime("%Y%m%d_%H%M%S_%f")
