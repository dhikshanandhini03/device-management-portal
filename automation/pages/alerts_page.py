from playwright.sync_api import expect

from pages.base_page import BasePage


class AlertsPage(BasePage):
    path = "/alerts"

    def open(self, path: str | None = None):
        with self.page.expect_response(lambda r: "/api/alerts?" in r.url):
            super().open(path)
        expect(self.by_id("alerts-page")).to_be_visible()
        return self

    def _refresh(self, action) -> None:
        self.await_refresh(action, "/api/alerts?")

    def rows(self):
        return self.page.get_by_test_id("alert-row")

    def row(self, alert_code: str):
        return self.page.locator(f"[data-testid='alert-row'][data-alert-code='{alert_code}']")

    def filter_severity(self, label: str) -> None:
        self._refresh(lambda: self.select_option("alert-severity-filter", label))

    def filter_status(self, label: str) -> None:
        self._refresh(lambda: self.select_option("alert-status-filter", label))

    def filter_category(self, label: str) -> None:
        self._refresh(lambda: self.select_option("alert-category-filter", label))

    def search(self, term: str) -> None:
        box = self.by_id("alert-search")
        box.fill(term)
        self._refresh(lambda: box.press("Enter"))

    def attr(self, name: str) -> list[str]:
        return self.rows().evaluate_all(f"els => els.map(e => e.getAttribute('{name}'))")

    def acknowledge(self, alert_code: str) -> None:
        with self.page.expect_response(lambda r: r.url.endswith(f"/alerts/{alert_code}/acknowledge")) as resp:
            self.row(alert_code).get_by_test_id("alert-acknowledge").click()
        assert resp.value.status == 200, resp.value.text()

    def resolve(self, alert_code: str, note: str = "") -> None:
        self.row(alert_code).get_by_test_id("alert-resolve").click()
        expect(self.by_id("resolve-dialog")).to_be_visible()
        if note:
            self.by_id("resolve-note").fill(note)
        with self.page.expect_response(lambda r: r.url.endswith(f"/alerts/{alert_code}/resolve")) as resp:
            self.by_id("resolve-dialog-confirm").click()
        assert resp.value.status == 200, resp.value.text()

    def row_status(self, alert_code: str) -> str:
        return self.row(alert_code).get_attribute("data-status") or ""

    def open_detail(self, alert_code: str) -> None:
        self.row(alert_code).locator("td").first.click()
        expect(self.by_id("alert-detail-dialog")).to_be_visible()

    def summary_value(self, key: str) -> int:
        return int(self.get_text(f"alerts-{key}-value"))
