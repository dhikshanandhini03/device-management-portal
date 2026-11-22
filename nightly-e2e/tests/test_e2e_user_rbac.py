"""E2E: user lifecycle and role-based access control."""

import re

import pytest
from playwright.sync_api import expect

from pages.audit_logs_page import AuditLogsPage
from pages.devices_page import DeviceInventoryPage
from pages.login_page import LoginPage
from pages.users_page import UsersPage
from utils import test_data

pytestmark = [pytest.mark.end_to_end, pytest.mark.users]


def test_admin_onboards_and_offboards_support_engineer(login, page):
    user = test_data.support_user()

    # 1. Admin creates the account.
    dashboard = login("admin")
    users = UsersPage(page).open()
    users.create_user(user)
    assert users.row_role(user["username"]) == "SUPPORT_ENGINEER"
    users.expect_toast(f"User {user['username']} created")
    dashboard.logout()

    # 2. New engineer signs in with support permissions only.
    login_page = LoginPage(page).open()
    login_page.login(user["username"], user["password"])
    assert login_page.header_role() == "Support Engineer"
    expect(login_page.nav_item("users")).to_have_count(0)
    login_page.navigate("device-inventory")
    DeviceInventoryPage(page).expect_loaded()
    page.goto(f"{login_page.base_url}/users")
    expect(page.get_by_test_id("access-denied")).to_be_visible()
    login_page.logout()

    # 3. Admin deactivates the account; the engineer can no longer sign in.
    login("admin")
    UsersPage(page).open().set_active(user["username"], active=False)
    UsersPage(page).logout()
    login_page = LoginPage(page).open()
    login_page.login(user["username"], user["password"], expect_success=False)
    assert re.search("deactivated", login_page.error_text(), re.I)

    # 4. The lifecycle is audited.
    login("admin")
    audit = AuditLogsPage(page).open()
    audit.expect_event("USER_CREATED", username="admin", target=user["username"])
    audit.expect_event("USER_DEACTIVATED", username="admin", target=user["username"])
    audit.filter(username=user["username"], action="LOGIN_FAILED")
    expect(audit.rows().first).to_have_attribute("data-result", "DENIED")
