import re
from datetime import datetime

from playwright.sync_api import Page

from config.config import SCREENSHOTS_DIR
from utils.logger import get_logger

log = get_logger("screenshots")


def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", name)[:120]


def capture(page: Page, name: str, full_page: bool = True) -> bytes | None:
    """Save a screenshot under screenshots/ and attach it to Allure when available."""
    try:
        path = SCREENSHOTS_DIR / f"{_safe(name)}_{datetime.now():%Y%m%d_%H%M%S_%f}.png"
        png = page.screenshot(path=str(path), full_page=full_page)
        log.info("Screenshot saved: %s", path)
        try:
            import allure

            allure.attach(png, name=name, attachment_type=allure.attachment_type.PNG)
        except Exception:  # allure not active
            pass
        return png
    except Exception as exc:
        log.warning("Could not capture screenshot %s: %s", name, exc)
        return None
