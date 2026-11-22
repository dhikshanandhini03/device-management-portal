import re

from playwright.sync_api import Download, Locator, Page, expect

from config.settings import settings
from utils.logger import get_logger


class BasePage:
    """Shared navigation and MUI helpers. The demo serves its API in-browser, so waits target UI state, not network."""

    path = "/"

    def __init__(self, page: Page):
        self.page = page
        self.base_url = settings.base_url
        self.log = get_logger(type(self).__name__)

    def open(self, path: str | None = None):
        url = f"{self.base_url}{path or self.path}"
        self.log.info("Open %s", url)
        self.page.goto(url)
        self.wait_for_loaded()
        return self

    def wait_for_loaded(self) -> None:
        expect(self.page.get_by_test_id("loading-state")).to_have_count(0)

    def by_id(self, test_id: str) -> Locator:
        return self.page.get_by_test_id(test_id)

    def text(self, test_id: str) -> str:
        # MUI renders empty helper text as a zero-width space.
        return self.by_id(test_id).inner_text().replace("\u200b", "").strip()

    def select_option(self, test_id: str, label: str, exact: bool = True) -> None:
        """Pick an option in a MUI select whose hidden input carries the data-testid."""
        self.by_id(test_id).locator("xpath=..").get_by_role("combobox").click()
        listbox = self.page.get_by_role("listbox")
        listbox.get_by_role("option", name=label, exact=exact).first.click()
        expect(listbox).to_have_count(0)

    def select_by_label(self, label: str, option: str) -> None:
        self.page.get_by_role("combobox", name=label).click()
        listbox = self.page.get_by_role("listbox")
        listbox.get_by_role("option", name=option).click()
        expect(listbox).to_have_count(0)

    def navigate(self, nav_id: str) -> None:
        self.by_id(f"nav-{nav_id}").click()
        self.wait_for_loaded()

    def nav_item(self, nav_id: str) -> Locator:
        return self.by_id(f"nav-{nav_id}")

    def expect_toast(self, text: str | re.Pattern) -> None:
        expect(self.by_id("toast").filter(has_text=text).first).to_be_visible()

    def download(self, test_id: str) -> Download:
        with self.page.expect_download() as info:
            self.by_id(test_id).click()
        return info.value

    def header_role(self) -> str:
        return self.text("current-role")

    def header_username(self) -> str:
        return self.text("current-username")

    def logout(self) -> None:
        self.by_id("profile-menu-button").click()
        self.by_id("logout-button").click()
        expect(self.page).to_have_url(re.compile(r"/login"))
        expect(self.by_id("login-title")).to_be_visible()
