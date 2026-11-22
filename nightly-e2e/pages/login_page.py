import re

from playwright.sync_api import expect

from config.settings import settings
from pages.base_page import BasePage


class LoginPage(BasePage):
    path = "/login"

    def open(self, path: str | None = None):
        super().open(path)
        expect(self.by_id("login-title")).to_be_visible()
        return self

    def reset_demo(self):
        """Start from freshly seeded demo data (also clears any session)."""
        return self.open("/login?reset-demo=1")

    def login(self, username: str, password: str, expect_success: bool = True) -> None:
        self.log.info("Login as %s", username)
        self.by_id("login-username").fill(username)
        self.by_id("login-password").fill(password)
        self.by_id("login-submit").click()
        if expect_success:
            expect(self.page).to_have_url(re.compile(r"/dashboard"))
            expect(self.by_id("current-username")).not_to_be_empty()

    def login_as(self, role: str) -> None:
        creds = settings.credentials(role)
        self.login(creds.username, creds.password)

    def error_text(self) -> str:
        expect(self.by_id("login-error")).to_be_visible()
        return self.text("login-error")
