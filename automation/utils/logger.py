import logging
import sys

from config.config import LOGS_DIR

_FORMAT = "%(asctime)s %(levelname)-7s [%(name)s] %(message)s"


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(f"bellstb.{name}")
    root = logging.getLogger("bellstb")
    if not root.handlers:
        root.setLevel(logging.DEBUG)
        fh = logging.FileHandler(LOGS_DIR / "automation.log", encoding="utf-8")
        fh.setFormatter(logging.Formatter(_FORMAT))
        fh.setLevel(logging.DEBUG)
        sh = logging.StreamHandler(sys.stdout)
        sh.setFormatter(logging.Formatter(_FORMAT))
        sh.setLevel(logging.WARNING)
        root.addHandler(fh)
        root.addHandler(sh)
        root.propagate = True
    return logger
