"""Root conftest: plugin registration, failure evidence (screenshots, URL) and report metadata."""

import base64
import platform
from pathlib import Path

import pytest
from playwright.sync_api import expect

from config.config import REPORTS_DIR, VIEWPORT
from config.settings import settings
from utils.logger import get_logger
from utils.screenshot_helper import capture

pytest_plugins = ["fixtures.test_fixtures"]

log = get_logger("conftest")
expect.set_options(timeout=settings.default_timeout_ms)


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args, base_url):
    return {
        **browser_context_args,
        "base_url": base_url,
        "viewport": VIEWPORT,
        "accept_downloads": True,
        "locale": "en-CA",
    }


def pytest_configure(config):
    config.addinivalue_line("markers", "workflow: business workflow evidence screenshots")
    try:
        from pytest_metadata.plugin import metadata_key

        meta = config.stash[metadata_key]
        meta["Base URL"] = settings.base_url
        meta["API URL"] = settings.api_url
        meta["Browsers"] = ", ".join(config.getoption("browser") or ["chromium"])
        meta["Headed"] = str(config.getoption("headed", False))
        meta["Platform"] = platform.platform()
    except Exception:  # metadata plugin optional
        pass


def pytest_html_report_title(report):
    report.title = "BELL STB Device Management - Automation Report"


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    if report.when != "call" and not (report.when == "setup" and report.failed):
        return
    browser_name = item.funcargs.get("browser_name") if hasattr(item, "funcargs") else None
    if browser_name:
        report.user_properties.append(("browser", browser_name))
    if not report.failed:
        return
    page = item.funcargs.get("page") if hasattr(item, "funcargs") else None
    if page is None or page.is_closed():
        return
    png = capture(page, f"FAILED_{item.name}")
    log.error("Test failed: %s at %s", item.nodeid, page.url)
    extras = getattr(report, "extras", [])
    try:
        import pytest_html

        extras.append(pytest_html.extras.url(page.url, name="Page URL"))
        if png:
            extras.append(pytest_html.extras.png(base64.b64encode(png).decode(), name="Failure screenshot"))
    except ImportError:
        pass
    report.extras = extras


def pytest_sessionfinish(session, exitstatus):
    allure_dir = session.config.getoption("--alluredir", default=None)
    if allure_dir:
        path = Path(allure_dir)
        path.mkdir(parents=True, exist_ok=True)
        browsers = ",".join(session.config.getoption("browser") or ["chromium"])
        (path / "environment.properties").write_text(
            f"Base.URL={settings.base_url}\nAPI.URL={settings.api_url}\nBrowsers={browsers}\n"
            f"Python={platform.python_version()}\nPlatform={platform.system()}\n",
            encoding="utf-8",
        )
    log.info("Session finished with status %s; reports in %s", exitstatus, REPORTS_DIR)
