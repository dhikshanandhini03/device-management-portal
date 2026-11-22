from playwright.sync_api import Locator, expect

from pages.base_page import BasePage


class AlertsPage(BasePage):
    path = "/alerts"

    def open(self, path: str | None = None):
        super().open(path)
        expect(self.by_id("alerts-page")).to_be_visible()
        return self

    def row(self, alert_code: str) -> Locator:
        return self.page.locator(f"[data-testid='alert-row'][data-alert-code='{alert_code}']")

    def search(self, term: str) -> None:
        box = self.by_id("alert-search")
        box.fill(term)
        box.press("Enter")

    def filter_status(self, label: str) -> None:
        self.select_option("alert-status-filter", label)

    def summary(self, key: str) -> int:
        return int(self.text(f"alerts-{key}-value").replace(",", ""))

    def acknowledge(self, alert_code: str) -> None:
        self.row(alert_code).get_by_test_id("alert-acknowledge").click()
        expect(self.row(alert_code)).to_have_attribute("data-status", "ACKNOWLEDGED")

    def resolve(self, alert_code: str, note: str) -> None:
        self.row(alert_code).get_by_test_id("alert-resolve").click()
        expect(self.by_id("resolve-dialog")).to_be_visible()
        self.by_id("resolve-note").fill(note)
        self.by_id("resolve-dialog-confirm").click()
        expect(self.by_id("resolve-dialog")).to_have_count(0)
