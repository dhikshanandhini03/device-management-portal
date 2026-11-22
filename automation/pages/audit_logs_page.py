from playwright.sync_api import expect

from pages.base_page import BasePage


class AuditLogsPage(BasePage):
    path = "/audit-logs"

    def open(self, path: str | None = None):
        super().open(path)
        return self

    def expect_loaded(self) -> None:
        expect(self.by_id("audit-logs-page")).to_be_visible()
        expect(self.rows().first).to_be_visible()

    def rows(self):
        return self.page.get_by_test_id("audit-row")

    def apply_filters(self, username: str = "", action: str = "", result: str = "", target: str = "",
                      date_from: str = "", date_to: str = "") -> None:
        if username:
            self.by_id("audit-username").fill(username)
        if action:
            self.select_option("audit-action", action)
        if result:
            self.select_option("audit-result", result)
        if target:
            self.by_id("audit-target").fill(target)
        if date_from:
            self.by_id("audit-from").fill(date_from)
        if date_to:
            self.by_id("audit-to").fill(date_to)
        self.await_refresh(lambda: self.by_id("audit-apply").click(), "/api/audit-logs?")

    def attr(self, name: str) -> list[str]:
        return self.rows().evaluate_all(f"els => els.map(e => e.getAttribute('{name}'))")

    def targets(self) -> list[str]:
        return self.column_texts(self.rows(), "cell-audit-target")

    def open_first_detail(self) -> None:
        self.rows().first.click()
        expect(self.by_id("audit-detail-dialog")).to_be_visible()
