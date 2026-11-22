from playwright.sync_api import Locator, expect

from pages.base_page import BasePage


class AuditLogsPage(BasePage):
    path = "/audit-logs"

    def open(self, path: str | None = None):
        super().open(path)
        expect(self.by_id("audit-logs-page")).to_be_visible()
        expect(self.rows().first).to_be_visible()
        return self

    def rows(self) -> Locator:
        return self.page.get_by_test_id("audit-row")

    def filter(self, username: str = "", action: str = "", target: str = "") -> None:
        self.by_id("audit-username").fill(username)
        if action:
            self.select_option("audit-action", action)
        self.by_id("audit-target").fill(target)
        self.by_id("audit-apply").click()
        self.wait_for_loaded()

    def expect_event(self, action: str, username: str | None = None, target: str | None = None) -> Locator:
        """Filter the trail and assert at least one matching event exists; returns the first matching row."""
        self.filter(username=username or "", action=action, target=target or "")
        row = self.page.locator(f"[data-testid='audit-row'][data-action='{action}']").first
        expect(row).to_be_visible()
        if username:
            expect(row).to_have_attribute("data-username", username)
        if target:
            expect(row.get_by_test_id("cell-audit-target")).to_contain_text(target)
        return row

    def attr(self, name: str) -> list[str]:
        return self.rows().evaluate_all(f"els => els.map(e => e.getAttribute('{name}'))")
