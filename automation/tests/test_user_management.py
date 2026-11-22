import re

import pytest
from playwright.sync_api import expect

from api.auth_api import AuthApi
from pages.login_page import LoginPage
from pages.user_management_page import UserManagementPage
from test_data import test_data_factory as factory
from test_data.test_data_factory import USERS
from utils.assertions import assert_status

pytestmark = [pytest.mark.users, pytest.mark.regression]


@pytest.fixture
def users_page(admin_page) -> UserManagementPage:
    page = UserManagementPage(admin_page).open()
    page.expect_loaded()
    return page


@pytest.mark.smoke
def test_create_new_user(users_page, admin, track_user):
    data = factory.user_payload("READ_ONLY")
    track_user(data["username"])
    users_page.create_user(data)
    users_page.expect_toast(f"User {data['username']} created")
    api = admin.find_user(data["username"])
    assert api and api["email"] == data["email"] and api["role"] == "READ_ONLY" and api["is_active"]
    # The new account can sign in.
    assert AuthApi().login(data["username"], data["password"]).user["role"] == "READ_ONLY"


def test_create_user_form_validation(users_page):
    users_page.open_create()
    users_page.fill_form({"username": "x", "full_name": "A", "email": "not-an-email", "password": "weak"})
    users_page.submit_form(expect_ok=False)
    expect(users_page.by_id("user-username-error")).to_contain_text("3-64 characters")
    expect(users_page.by_id("user-email-error")).to_contain_text("valid email")
    expect(users_page.by_id("user-password-error")).to_contain_text("At least 8 characters")
    expect(users_page.by_id("user-form-dialog")).to_be_visible()


def test_duplicate_username_rejected(users_page, user_factory):
    existing = user_factory("READ_ONLY")
    data = factory.user_payload("READ_ONLY")
    data["username"] = existing["username"]
    users_page.open_create()
    users_page.fill_form(data)
    users_page.submit_form(expect_ok=False)
    expect(users_page.by_id("user-form-error")).to_contain_text("already exists")


def test_edit_user_information(users_page, user_factory, admin):
    user = user_factory("READ_ONLY")
    users_page.search(user["username"])
    users_page.edit_user(user["username"], {"full_name": "Edited By Automation"})
    expect(users_page.row(user["username"]).get_by_test_id("cell-fullname")).to_have_text("Edited By Automation")
    assert admin.find_user(user["username"])["full_name"] == "Edited By Automation"


@pytest.mark.parametrize("role", ["ADMIN", "SUPPORT_ENGINEER", "READ_ONLY"])
def test_assign_role(users_page, user_factory, admin, role):
    start = "READ_ONLY" if role != "READ_ONLY" else "SUPPORT_ENGINEER"
    user = user_factory(start)
    users_page.search(user["username"])
    users_page.edit_user(user["username"], {"role": role})
    expect(users_page.row(user["username"]).get_by_test_id("cell-role")).to_have_attribute("data-role", role)
    assert admin.find_user(user["username"])["role"] == role
    assert AuthApi().login(user["username"], user["password"]).user["role"] == role


def test_deactivate_user(users_page, user_factory, page):
    user = user_factory("SUPPORT_ENGINEER")
    users_page.search(user["username"])
    users_page.toggle_active(user["username"], activate=False)
    expect(users_page.row(user["username"]).get_by_test_id("cell-user-status").locator("[data-status]")).to_have_attribute("data-status", "INACTIVE")
    r = AuthApi().login_raw(user["username"], user["password"])
    assert_status(r, 403)
    assert "deactivated" in r.json()["detail"].lower()


def test_activate_user(users_page, user_factory):
    user = user_factory("SUPPORT_ENGINEER", is_active=False)
    users_page.search(user["username"])
    users_page.toggle_active(user["username"], activate=True)
    expect(users_page.row(user["username"]).get_by_test_id("cell-user-status").locator("[data-status]")).to_have_attribute("data-status", "ACTIVE")
    assert_status(AuthApi().login_raw(user["username"], user["password"]), 200)


def test_search_users(users_page):
    users_page.search("support")
    names = users_page.usernames()
    emails = users_page.column_texts(users_page.rows(), "cell-email")
    full_names = users_page.column_texts(users_page.rows(), "cell-fullname")
    assert "support" in names
    assert all("support" in (n + e + f).lower() for n, e, f in zip(names, emails, full_names))


def test_filter_users(users_page):
    users_page.filter_role("ADMIN")
    assert set(users_page.roles()) == {"ADMIN"}
    users_page.filter_role("READ_ONLY")
    users_page.filter_status("Inactive")
    assert users_page.rows().count() == 0 or set(users_page.roles()) == {"READ_ONLY"}


def test_admin_cannot_deactivate_self(users_page):
    users_page.search("admin")
    expect(users_page.row("admin").get_by_test_id("user-deactivate")).to_be_disabled()


def test_login_history_and_activity(users_page):
    users_page.search("admin")
    users_page.open_history("admin")
    expect(users_page.page.get_by_test_id("user-history-row").first).to_be_visible()
    users_page.by_id("tab-user-activity").click()
    expect(users_page.page.get_by_test_id("user-history-row").first).to_be_visible()


@pytest.mark.parametrize("role", ["support", "readonly"])
def test_permission_restrictions(request, role):
    page = request.getfixturevalue(f"{role}_page")
    client = request.getfixturevalue(f"{role}_api")
    expect(page.get_by_test_id("nav-users")).to_have_count(0)
    page.goto("/users")
    expect(page.get_by_test_id("access-denied")).to_be_visible()
    assert_status(client.get("/users"), 403)
    assert_status(client.post("/users", json=factory.user_payload()), 403)


def test_new_support_engineer_login_via_ui(page, user_factory):
    user = user_factory("SUPPORT_ENGINEER")
    login = LoginPage(page).open()
    login.login(user["username"], user["password"])
    assert login.header_role() == "Support Engineer"
    expect(page).to_have_url(re.compile("/dashboard"))
    assert USERS["roles"]["support"]["role"] == "SUPPORT_ENGINEER"
