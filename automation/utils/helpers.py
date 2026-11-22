import csv
import io
import re
import time
from collections.abc import Callable
from typing import TypeVar

from utils.logger import get_logger

log = get_logger("helpers")
T = TypeVar("T")


def wait_until(
    fn: Callable[[], T],
    predicate: Callable[[T], bool] = bool,
    timeout: float = 30,
    interval: float = 1.0,
    message: str = "condition",
) -> T:
    """Poll fn() until predicate(result) is true. Used for backend state, never as a fixed sleep."""
    deadline = time.monotonic() + timeout
    last: T | None = None
    while True:
        last = fn()
        if predicate(last):
            return last
        if time.monotonic() >= deadline:
            raise TimeoutError(f"Timed out after {timeout}s waiting for {message}; last value: {last!r}")
        time.sleep(interval)


def parse_int(text: str) -> int:
    digits = re.sub(r"[^0-9-]", "", text or "")
    if not digits:
        raise ValueError(f"No integer in {text!r}")
    return int(digits)


def parse_float(text: str) -> float:
    match = re.search(r"-?\d+(\.\d+)?", text or "")
    if not match:
        raise ValueError(f"No number in {text!r}")
    return float(match.group(0))


def read_csv_text(text: str) -> tuple[list[str], list[dict[str, str]]]:
    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)
    return list(reader.fieldnames or []), rows


def read_csv_file(path) -> tuple[list[str], list[dict[str, str]]]:
    with open(path, encoding="utf-8", newline="") as f:
        return read_csv_text(f.read())


def unique_suffix() -> str:
    return f"{int(time.time() * 1000) % 10_000_000:07d}"
