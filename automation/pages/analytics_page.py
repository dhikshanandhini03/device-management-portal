from playwright.sync_api import Download, expect

from pages.base_page import BasePage

CHARTS = [
    "chart-availability",
    "chart-availability-pct",
    "chart-an-firmware",
    "chart-an-models",
    "chart-an-uptime",
    "chart-an-failures",
    "chart-an-applications",
    "chart-an-activity",
    "chart-an-registrations",
]


class AnalyticsPage(BasePage):
    path = "/analytics"

    def open(self, path: str | None = None):
        with self.page.expect_response(lambda r: "/api/analytics/report" in r.url):
            super().open(path)
        expect(self.by_id("analytics-page")).to_be_visible()
        return self

    def chart_rendered(self, test_id: str) -> bool:
        expect(self.by_id(f"{test_id}-body").locator("svg.recharts-surface").first).to_be_visible()
        return True

    def set_range(self, date_from: str, date_to: str) -> None:
        with self.page.expect_response(lambda r: "/api/analytics/report" in r.url):
            self.by_id("analytics-from").fill(date_from)
            self.by_id("analytics-to").fill(date_to)

    def preset(self, days: int) -> None:
        with self.page.expect_response(lambda r: "/api/analytics/report" in r.url):
            self.by_id(f"range-{days}d").click()

    def summary(self, key: str) -> str:
        return self.get_text(f"an-{key}-value")

    def export(self, report_label: str) -> Download:
        self.select_option("report-type", report_label)
        with self.page.expect_download() as info:
            self.by_id("export-report").click()
        return info.value
