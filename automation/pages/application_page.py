import re

from playwright.sync_api import expect

from pages.base_page import BasePage


class ApplicationPage(BasePage):
    path = "/applications"

    def open(self, path: str | None = None):
        super().open(path)
        expect(self.by_id("applications-page")).to_be_visible()
        expect(self.rows.first).to_be_visible()
        return self

    @property
    def rows(self):
        return self.page.get_by_test_id("application-row")

    def search(self, term: str) -> None:
        self.await_refresh(lambda: self.by_id("app-search").fill(term), "/api/applications")

    def filter_category(self, category: str) -> None:
        self.await_refresh(lambda: self.select_option("app-category-filter", category), "/api/applications")

    def filter_updates(self, label: str) -> None:
        self.await_refresh(lambda: self.select_option("app-update-filter", label), "/api/applications")

    def names(self) -> list[str]:
        return self.column_texts(self.rows, "cell-app-name")

    def packages(self) -> list[str]:
        return self.column_texts(self.rows, "cell-app-package")

    def row_for(self, package_id: str):
        return self.page.locator(f"[data-testid='application-row'][data-package='{package_id}']")

    def open_application(self, package_id: str) -> None:
        self.row_for(package_id).click()
        expect(self.page).to_have_url(re.compile(r"/applications/\d+"))
        expect(self.by_id("application-details-page")).to_be_visible()

    # details page
    def detail_package(self) -> str:
        return self.get_text("application-package")

    def detail_latest(self) -> str:
        return self.get_text("application-latest")

    def version_rows(self):
        return self.page.get_by_test_id("app-version-row")

    def version_counts(self) -> dict[str, int]:
        out = {}
        for i in range(self.version_rows().count()):
            row = self.version_rows().nth(i)
            out[row.get_attribute("data-version")] = int(row.get_by_test_id("app-version-count").inner_text())
        return out

    def filter_installations_by_version(self, version: str) -> None:
        self.await_refresh(lambda: self.select_option("app-version-filter", version), "/installations")

    def installation_versions(self) -> list[str]:
        return self.page.get_by_test_id("app-installation-row").evaluate_all("els => els.map(e => e.getAttribute('data-version'))")
