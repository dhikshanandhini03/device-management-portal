import logging
import sys

from config.settings import REPORTS_DIR

_configured = False


def get_logger(name: str) -> logging.Logger:
    global _configured
    if not _configured:
        REPORTS_DIR.mkdir(parents=True, exist_ok=True)
        fmt = logging.Formatter("%(asctime)s %(levelname)-7s [%(name)s] %(message)s")
        file_handler = logging.FileHandler(REPORTS_DIR / "nightly-e2e.log", encoding="utf-8")
        file_handler.setFormatter(fmt)
        stream = logging.StreamHandler(sys.stdout)
        stream.setFormatter(fmt)
        root = logging.getLogger("nightly")
        root.setLevel(logging.INFO)
        root.addHandler(file_handler)
        root.addHandler(stream)
        root.propagate = False
        _configured = True
    return logging.getLogger(f"nightly.{name}")
