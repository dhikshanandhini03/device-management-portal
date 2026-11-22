"""Nightly E2E fixtures: fresh demo data per test, role logins and failure evidence for the HTML report."""

import base64
import platform

import pytest
from playwright.sync_api import Page, expect

from config.settings import REPORTS_DIR, settings
from pages.dashboard_page import DashboardPage
from pages.login_page import LoginPage
from utils.logger import get_logger

log = get_logger("conftest")
expect.set_options(timeout=settings.default_timeout_ms)


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    # Each test gets a new context (empty localStorage), so the demo seeds a fresh, isolated dataset.
    return {**browser_context_args, "viewport": {"width": 1440, "height": 900}, "accept_downloads": True, "locale": "en-CA"}


@pytest.fixture
def login(page: Page):
    """login("admin" | "support" | "readonly") -> DashboardPage for that role."""

    def _login(role: str) -> DashboardPage:
        page.set_default_timeout(settings.default_timeout_ms)
        LoginPage(page).open().login_as(role)
        return DashboardPage(page).expect_loaded()

    return _login


def pytest_configure(config):
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    try:
        from pytest_metadata.plugin import metadata_key

        meta = config.stash[metadata_key]
        meta["Base URL"] = settings.base_url
        meta["Browsers"] = ", ".join(config.getoption("browser") or ["chromium"])
        meta["Platform"] = platform.platform()
    except Exception:  # pytest-metadata is optional
        pass


def pytest_html_report_title(report):
    report.title = "BELL STB Demo - Nightly E2E Report"


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    if report.when != "call" or not report.failed:
        return
    page = item.funcargs.get("page")
    if page is None or page.is_closed():
        return
    log.error("FAILED %s at %s", item.nodeid, page.url)
    try:
        import pytest_html

        png = page.screenshot(full_page=True)
        extras = getattr(report, "extras", [])
        extras.append(pytest_html.extras.url(page.url, name="Page URL"))
        extras.append(pytest_html.extras.png(base64.b64encode(png).decode(), name="Failure screenshot"))
        report.extras = extras
    except Exception as exc:  # evidence capture must never mask the real failure
        log.warning("Could not attach failure evidence: %s", exc)


def pytest_sessionfinish(session, exitstatus):
    allure_dir = session.config.getoption("--alluredir", default=None)
    if allure_dir:
        from pathlib import Path

        Path(allure_dir).mkdir(parents=True, exist_ok=True)
        browsers = ",".join(session.config.getoption("browser") or ["chromium"])
        (Path(allure_dir) / "environment.properties").write_text(
            f"Base.URL={settings.base_url}\nBrowsers={browsers}\nPython={platform.python_version()}\n", encoding="utf-8")
