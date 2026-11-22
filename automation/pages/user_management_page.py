from playwright.sync_api import expect

from config.config import ROLE_LABELS
from pages.base_page import BasePage


class UserManagementPage(BasePage):
    path = "/users"

    def open(self, path: str | None = None):
        super().open(path)
        return self

    def expect_loaded(self) -> None:
        expect(self.by_id("users-page")).to_be_visible()
        expect(self.rows().first).to_be_visible()

    def rows(self):
        return self.page.get_by_test_id("user-row")

    def row(self, username: str):
        return self.page.locator(f"[data-testid='user-row'][data-username='{username}']")

    def _refresh(self, action) -> None:
        self.await_refresh(action, "/api/users?")

    def search(self, term: str) -> None:
        self._refresh(lambda: self.by_id("user-search").fill(term))

    def filter_role(self, role: str) -> None:
        self._refresh(lambda: self.select_option("user-role-filter", ROLE_LABELS[role]))

    def filter_status(self, label: str) -> None:
        self._refresh(lambda: self.select_option("user-status-filter", label))

    def usernames(self) -> list[str]:
        return self.column_texts(self.rows(), "cell-username")

    def roles(self) -> list[str]:
        return self.rows().get_by_test_id("cell-role").evaluate_all("els => els.map(e => e.getAttribute('data-role'))")

    def open_create(self) -> None:
        self.by_id("create-user").click()
        expect(self.by_id("user-form-dialog")).to_be_visible()

    def fill_form(self, data: dict) -> None:
        if "username" in data:
            self.by_id("user-username").fill(data["username"])
        if "full_name" in data:
            self.by_id("user-fullname").fill(data["full_name"])
        if "email" in data:
            self.by_id("user-email").fill(data["email"])
        if "role" in data:
            self.select_option("user-role", ROLE_LABELS[data["role"]])
        if "password" in data:
            self.by_id("user-password").fill(data["password"])

    def submit_form(self, expect_ok: bool = True) -> None:
        if expect_ok:
            with self.page.expect_response(lambda r: "/api/users" in r.url and r.request.method in ("POST", "PATCH")) as resp:
                self.by_id("user-form-submit").click()
            assert resp.value.status in (200, 201), resp.value.text()
            expect(self.by_id("user-form-dialog")).to_have_count(0)
        else:
            self.by_id("user-form-submit").click()

    def create_user(self, data: dict) -> None:
        self.open_create()
        self.fill_form(data)
        self.submit_form()

    def edit_user(self, username: str, changes: dict) -> None:
        self.row(username).get_by_test_id("user-edit").click()
        expect(self.by_id("user-form-dialog")).to_be_visible()
        self.fill_form(changes)
        self.submit_form()

    def toggle_active(self, username: str, activate: bool) -> None:
        self.row(username).get_by_test_id("user-activate" if activate else "user-deactivate").click()
        expect(self.by_id("user-toggle-dialog")).to_be_visible()
        with self.page.expect_response(lambda r: "/activate" in r.url or "/deactivate" in r.url) as resp:
            self.by_id("user-toggle-dialog-confirm").click()
        assert resp.value.status == 200, resp.value.text()

    def row_role(self, username: str) -> str:
        return self.row(username).get_by_test_id("cell-role").get_attribute("data-role") or ""

    def row_status(self, username: str) -> str:
        return (self.row(username).get_by_test_id("cell-user-status").locator("[data-status]").get_attribute("data-status") or "")

    def open_history(self, username: str) -> None:
        self.row(username).get_by_test_id("user-history").click()
        expect(self.by_id("user-history-dialog")).to_be_visible()
