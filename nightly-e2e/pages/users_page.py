from playwright.sync_api import Locator, expect

from config.settings import ROLE_LABELS
from pages.base_page import BasePage


class UsersPage(BasePage):
    path = "/users"

    def open(self, path: str | None = None):
        super().open(path)
        expect(self.by_id("users-page")).to_be_visible()
        expect(self.rows().first).to_be_visible()
        return self

    def rows(self) -> Locator:
        return self.page.get_by_test_id("user-row")

    def row(self, username: str) -> Locator:
        return self.page.locator(f"[data-testid='user-row'][data-username='{username}']")

    def create_user(self, data: dict) -> None:
        self.by_id("create-user").click()
        expect(self.by_id("user-form-dialog")).to_be_visible()
        self.by_id("user-username").fill(data["username"])
        self.by_id("user-fullname").fill(data["full_name"])
        self.by_id("user-email").fill(data["email"])
        self.select_option("user-role", ROLE_LABELS[data["role"]])
        self.by_id("user-password").fill(data["password"])
        self.by_id("user-form-submit").click()
        expect(self.by_id("user-form-dialog")).to_have_count(0)
        expect(self.row(data["username"])).to_be_visible()

    def set_active(self, username: str, active: bool) -> None:
        self.row(username).get_by_test_id("user-activate" if active else "user-deactivate").click()
        expect(self.by_id("user-toggle-dialog")).to_be_visible()
        self.by_id("user-toggle-dialog-confirm").click()
        expect(self.by_id("user-toggle-dialog")).to_have_count(0)
        expect(self.row(username).get_by_test_id("cell-user-status").locator("[data-status]")).to_have_attribute(
            "data-status", "ACTIVE" if active else "INACTIVE")

    def row_role(self, username: str) -> str:
        return self.row(username).get_by_test_id("cell-role").get_attribute("data-role") or ""
