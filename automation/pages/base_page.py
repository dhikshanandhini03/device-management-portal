import re

from playwright.sync_api import Locator, Page, expect
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

from config.config import TOKEN_STORAGE_KEY, USER_STORAGE_KEY
from config.settings import settings
from utils.logger import get_logger
from utils.screenshot_helper import capture


class BasePage:
    """Common page behaviour: navigation, interaction helpers, MUI widgets, waits and evidence capture."""

    path = "/"

    def __init__(self, page: Page, base_url: str | None = None):
        self.page = page
        self.base_url = (base_url or settings.base_url).rstrip("/")
        self.log = get_logger(self.__class__.__name__)
        page.set_default_timeout(settings.default_timeout_ms)

    # ------------------------------------------------------------------ navigation
    def open(self, path: str | None = None):
        url = f"{self.base_url}{path or self.path}"
        self.log.info("Navigate to %s", url)
        self.page.goto(url)
        self.wait_for_loaded()
        return self

    def navigate_via_sidebar(self, nav_id: str):
        self.page.get_by_test_id(f"nav-{nav_id}").click()
        self.wait_for_loaded()
        return self

    def current_path(self) -> str:
        return re.sub(r"^https?://[^/]+", "", self.page.url)

    def wait_for_loaded(self, timeout: float | None = None) -> None:
        self.page.wait_for_load_state("domcontentloaded")
        loading = self.page.get_by_test_id("loading-state")
        try:
            expect(loading).to_have_count(0, timeout=timeout or settings.default_timeout_ms)
        except AssertionError:
            self.log.warning("Loading indicators still visible on %s", self.page.url)

    # ------------------------------------------------------------------ element helpers
    def by_id(self, test_id: str) -> Locator:
        return self.page.get_by_test_id(test_id)

    def click(self, target: str | Locator) -> None:
        self._loc(target).click()

    def fill(self, target: str | Locator, text: str) -> None:
        loc = self._loc(target)
        loc.fill("")
        loc.fill(text)

    def get_text(self, target: str | Locator) -> str:
        # MUI renders empty helper text as a zero-width space.
        return self._loc(target).inner_text().replace("\u200b", "").strip()

    def is_visible(self, target: str | Locator) -> bool:
        return self._loc(target).is_visible()

    def wait_visible(self, target: str | Locator, timeout: float | None = None) -> Locator:
        loc = self._loc(target)
        expect(loc).to_be_visible(timeout=timeout or settings.default_timeout_ms)
        return loc

    def expect_visible(self, target: str | Locator) -> None:
        expect(self._loc(target)).to_be_visible()

    def _loc(self, target: str | Locator) -> Locator:
        return self.page.get_by_test_id(target) if isinstance(target, str) else target

    def await_refresh(self, action, url_part: str, timeout: float = 5000) -> None:
        """Run a UI action and wait for the matching API call, tolerating responses served from the query cache."""
        try:
            with self.page.expect_response(lambda r: url_part in r.url and r.request.method == "GET", timeout=timeout):
                action()
        except PlaywrightTimeoutError:
            self.log.info("No network refresh for %s (cached)", url_part)
        self.page.wait_for_timeout(100)

    def select_option(self, test_id: str, option_label: str, exact: bool = True) -> None:
        """Select an option in a MUI Select identified by the data-testid on its hidden input."""
        combobox = self.page.get_by_test_id(test_id).locator("xpath=..").get_by_role("combobox")
        combobox.click()
        listbox = self.page.get_by_role("listbox")
        listbox.get_by_role("option", name=option_label, exact=exact).first.click()
        expect(listbox).to_have_count(0)

    def selected_value(self, test_id: str) -> str:
        return self.page.get_by_test_id(test_id).input_value()

    def column_texts(self, rows: Locator, cell_test_id: str) -> list[str]:
        return [t.strip() for t in rows.get_by_test_id(cell_test_id).all_inner_texts()]

    # ------------------------------------------------------------------ dialogs / toasts
    def confirm_dialog(self, test_id: str = "confirm-dialog") -> None:
        self.page.get_by_test_id(f"{test_id}-confirm").click()

    def cancel_dialog(self, test_id: str = "confirm-dialog") -> None:
        self.page.get_by_test_id(f"{test_id}-cancel").click()
        expect(self.page.get_by_test_id(test_id)).to_have_count(0)

    def handle_browser_dialog(self, accept: bool = True) -> None:
        self.page.once("dialog", lambda d: d.accept() if accept else d.dismiss())

    def expect_toast(self, text: str | re.Pattern, severity: str | None = None) -> Locator:
        toast = self.page.get_by_test_id("toast").filter(has_text=text)
        expect(toast).to_be_visible()
        if severity:
            expect(toast).to_have_attribute("data-severity", severity)
        return toast

    # ------------------------------------------------------------------ session
    def token(self) -> str | None:
        return self.page.evaluate(f"() => window.localStorage.getItem('{TOKEN_STORAGE_KEY}')")

    def set_session(self, token: str, user: dict) -> None:
        import json

        self.page.evaluate(
            "([tk, uk, t, u]) => { window.localStorage.setItem(tk, t); window.localStorage.setItem(uk, u); }",
            [TOKEN_STORAGE_KEY, USER_STORAGE_KEY, token, json.dumps(user)],
        )

    def logout(self) -> None:
        self.page.get_by_test_id("profile-menu-button").click()
        self.page.get_by_test_id("logout-button").click()
        expect(self.page).to_have_url(re.compile(r"/login"))

    def header_role(self) -> str:
        return self.get_text("current-role")

    def header_username(self) -> str:
        return self.get_text("current-username")

    def page_title(self) -> str:
        return self.get_text("page-title")

    def screenshot(self, name: str) -> None:
        capture(self.page, name)
