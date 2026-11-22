import time
from collections.abc import Callable
from typing import TypeVar

from playwright.sync_api import Page

T = TypeVar("T")


def wait_until(page: Page, probe: Callable[[], T], check: Callable[[T], bool], timeout_ms: int = 20000, message: str = "") -> T:
    """Poll a UI read (e.g. a stat card that refreshes on an interval) until the check passes."""
    deadline = time.monotonic() + timeout_ms / 1000
    value = probe()
    while not check(value):
        if time.monotonic() > deadline:
            raise AssertionError(f"Timed out waiting: {message or 'condition'} (last value: {value!r})")
        page.wait_for_timeout(500)
        value = probe()
    return value


def read_csv(download) -> list[list[str]]:
    import csv
    import io
    from pathlib import Path

    text = Path(download.path()).read_text(encoding="utf-8-sig")
    return list(csv.reader(io.StringIO(text)))
