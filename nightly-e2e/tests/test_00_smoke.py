"""Availability gate: the pipeline runs the full nightly suite only if these pass."""

import pytest
from playwright.sync_api import expect

from pages.login_page import LoginPage
from utils import demo_data

pytestmark = pytest.mark.smoke


def test_demo_site_serves_login_and_seeds_data(page):
    login = LoginPage(page).reset_demo()
    expect(login.by_id("demo-mode-banner")).to_be_visible()
    assert demo_data.is_seeded(page), "demo data store was not initialised"
    assert demo_data.stable_online_device(page), "seed data has no STABLE_ONLINE lab device"


@pytest.mark.parametrize(
    ("role", "label", "admin_nav"),
    [("admin", "Administrator", True), ("support", "Support Engineer", False), ("readonly", "Read Only", False)],
)
def test_each_role_signs_in_with_correct_navigation(login, role, label, admin_nav):
    dashboard = login(role)
    assert dashboard.header_role() == label
    for nav in ("dashboard", "device-inventory", "firmware", "alerts", "monitoring", "analytics"):
        expect(dashboard.nav_item(nav)).to_be_visible()
    expect(dashboard.nav_item("users")).to_have_count(1 if admin_nav else 0)
    expect(dashboard.nav_item("audit-logs")).to_have_count(1 if admin_nav else 0)
    dashboard.logout()


def test_invalid_credentials_are_rejected(page):
    login = LoginPage(page).open()
    login.login("admin", "Wrong@Password1", expect_success=False)
    assert "Invalid username or password" in login.error_text()
