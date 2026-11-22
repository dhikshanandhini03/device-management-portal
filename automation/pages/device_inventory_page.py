import re
from collections.abc import Callable

from playwright.sync_api import Download, expect
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

from pages.base_page import BasePage

LIST_URL = re.compile(r"/api/devices\?")


class DeviceInventoryPage(BasePage):
    path = "/devices"

    def open(self, path: str | None = None):
        super().open(path)
        expect(self.by_id("device-inventory-page")).to_be_visible()
        expect(self.table.or_(self.by_id("empty-state"))).to_be_visible()
        return self

    def _reload_list(self, action: Callable[[], None]) -> None:
        """Run an action that changes the list; wait for the refetch unless TanStack Query serves it from cache."""
        try:
            with self.page.expect_response(lambda r: bool(LIST_URL.search(r.url)) and r.request.method == "GET", timeout=5000):
                action()
        except PlaywrightTimeoutError:
            self.log.info("Device list served from cache")
        self.page.wait_for_timeout(100)  # allow React to commit the new rows

    @property
    def table(self):
        return self.by_id("devices-table")

    @property
    def rows(self):
        return self.page.get_by_test_id("device-row")

    def row_count(self) -> int:
        return self.rows.count()

    def search(self, term: str) -> None:
        box = self.by_id("device-search")
        box.fill(term)
        self._reload_list(lambda: box.press("Enter"))

    def filter_by(self, filter_id: str, label: str) -> None:
        self._reload_list(lambda: self.select_option(filter_id, label))

    def filter_status(self, label: str) -> None:
        self.filter_by("filter-status", label)

    def filter_model(self, model: str) -> None:
        self.filter_by("filter-model", model)

    def filter_firmware(self, version: str) -> None:
        self.filter_by("filter-firmware", version)

    def filter_region(self, region: str) -> None:
        self.filter_by("filter-region", region)

    def clear_filters(self) -> None:
        self._reload_list(lambda: self.by_id("clear-filters").click())

    def sort_by(self, column: str) -> None:
        self._reload_list(lambda: self.by_id(f"sort-{column}").click())

    def column(self, cell_id: str) -> list[str]:
        return self.column_texts(self.rows, cell_id)

    def device_ids(self) -> list[str]:
        return self.column("cell-device-id")

    def statuses(self) -> list[str]:
        return [s.upper() for s in self.rows.get_by_test_id("cell-status").locator("[data-status]").evaluate_all(
            "els => els.map(e => e.getAttribute('data-status'))")]

    def empty_state_visible(self) -> bool:
        expect(self.by_id("empty-state")).to_be_visible()
        return True

    def next_page(self) -> None:
        self._reload_list(lambda: self.page.get_by_role("button", name="Next page").click())

    def previous_page(self) -> None:
        self._reload_list(lambda: self.page.get_by_role("button", name="Previous page").click())

    def set_page_size(self, size: int) -> None:
        def act():
            self.by_id("pagination").get_by_role("combobox").click()
            self.page.get_by_role("option", name=str(size), exact=True).click()

        self._reload_list(act)

    def pagination_text(self) -> str:
        return self.by_id("pagination").locator(".MuiTablePagination-displayedRows").inner_text()

    def export_csv(self) -> Download:
        with self.page.expect_download() as info:
            self.by_id("export-csv").click()
        return info.value

    def open_device(self, device_id: str) -> None:
        self.page.locator(f"[data-testid='device-row'][data-device-id='{device_id}']").click()
        expect(self.page).to_have_url(re.compile(f"/devices/{device_id}"))

    def open_first_device(self) -> str:
        device_id = self.device_ids()[0]
        self.open_device(device_id)
        return device_id
