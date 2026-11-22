import re

from playwright.sync_api import expect

from pages.base_page import BasePage


class LoginPage(BasePage):
    path = "/login"

    @property
    def username_input(self):
        return self.by_id("login-username")

    @property
    def password_input(self):
        return self.by_id("login-password")

    @property
    def submit_button(self):
        return self.by_id("login-submit")

    @property
    def error_banner(self):
        return self.by_id("login-error")

    def open(self, path: str | None = None):
        super().open(path)
        expect(self.by_id("login-title")).to_be_visible()
        return self

    def login(self, username: str, password: str, expect_success: bool = True) -> None:
        self.log.info("UI login as %s", username)
        self.fill(self.username_input, username)
        self.fill(self.password_input, password)
        self.submit_button.click()
        if expect_success:
            expect(self.page).to_have_url(re.compile(r"/dashboard"))
            expect(self.by_id("current-username")).to_be_visible()

    def submit_empty(self) -> None:
        self.submit_button.click()

    def error_text(self) -> str:
        expect(self.error_banner).to_be_visible()
        return self.error_banner.inner_text()

    def username_error(self) -> str:
        return self.get_text("login-username-error")

    def password_error(self) -> str:
        return self.get_text("login-password-error")

    def toggle_password_visibility(self) -> None:
        self.by_id("toggle-password-visibility").click()

    def password_field_type(self) -> str | None:
        return self.password_input.get_attribute("type")

    def session_expired_message(self):
        return self.by_id("session-expired")
