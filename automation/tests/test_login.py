import base64
import json
import re
import time

import pytest
from playwright.sync_api import expect

from config.config import ROLE_LABELS
from pages.dashboard_page import DashboardPage
from pages.login_page import LoginPage
from test_data.test_data_factory import USERS

pytestmark = [pytest.mark.login, pytest.mark.regression]


def _fake_token(exp_offset_s: int) -> str:
    def b64(obj) -> str:
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")

    return f"{b64({'alg': 'HS256', 'typ': 'JWT'})}.{b64({'sub': '1', 'role': 'ADMIN', 'exp': int(time.time()) + exp_offset_s})}.invalidsignature"


@pytest.mark.smoke
@pytest.mark.parametrize("role", ["admin", "support", "readonly"])
def test_valid_login_per_role(page, credentials, role):
    """TC 1-3: valid login for each role shows the dashboard with the right identity and role."""
    login = LoginPage(page).open()
    creds = credentials(role)
    login.login(creds.username, creds.password)
    dashboard = DashboardPage(page)
    expect(dashboard.by_id("dashboard-page")).to_be_visible()
    expected = USERS["roles"][role]
    assert dashboard.header_username() == expected["full_name"]
    assert dashboard.header_role() == ROLE_LABELS[expected["role"]]
    # Navigation reflects role permissions.
    for nav in expected["allowed_nav"]:
        expect(page.get_by_test_id(f"nav-{nav}")).to_be_visible()
    for nav in expected.get("denied_nav", []):
        expect(page.get_by_test_id(f"nav-{nav}")).to_have_count(0)


def test_invalid_username(page):
    login = LoginPage(page).open()
    login.login(f"nosuchuser{int(time.time())}", "Whatever@123", expect_success=False)
    assert "Invalid username or password" in login.error_text()
    expect(page).to_have_url(re.compile("/login"))


def test_invalid_password(page):
    login = LoginPage(page).open()
    login.login(USERS["invalid_password_user"], "Wrong-Password-1!", expect_success=False)
    assert "Invalid username or password" in login.error_text()
    assert login.token() is None


def test_empty_username(page):
    login = LoginPage(page).open()
    login.fill(login.password_input, "Something@1")
    login.submit_empty()
    assert login.username_error() == "Username or email is required"
    assert login.password_error() == ""
    expect(page).to_have_url(re.compile("/login"))


def test_empty_password(page, credentials):
    login = LoginPage(page).open()
    login.fill(login.username_input, credentials("admin").username)
    login.submit_empty()
    assert login.password_error() == "Password is required"
    assert login.username_error() == ""


def test_both_fields_empty(page):
    login = LoginPage(page).open()
    login.submit_empty()
    assert login.username_error() == "Username or email is required"
    assert login.password_error() == "Password is required"
    expect(login.error_banner).to_have_count(0)


def test_password_visibility_toggle(page):
    login = LoginPage(page).open()
    login.fill(login.password_input, "Secret@123")
    assert login.password_field_type() == "password"
    login.toggle_password_visibility()
    assert login.password_field_type() == "text"
    login.toggle_password_visibility()
    assert login.password_field_type() == "password"


@pytest.mark.smoke
def test_logout(page, credentials):
    login = LoginPage(page).open()
    creds = credentials("support")
    login.login(creds.username, creds.password)
    DashboardPage(page).logout()
    expect(page.get_by_test_id("login-title")).to_be_visible()
    assert login.token() is None
    # Protected pages are no longer reachable.
    page.goto("/devices")
    expect(page).to_have_url(re.compile("/login"))


def test_session_expiration_redirects_to_login(page, credentials):
    login = LoginPage(page).open()
    creds = credentials("readonly")
    login.login(creds.username, creds.password)
    # Replace the session token with one the server rejects (as happens when the JWT expires server-side).
    page.evaluate("t => window.localStorage.setItem('bellstb.token', t)", _fake_token(3600))
    page.get_by_test_id("nav-device-inventory").click()
    expect(page).to_have_url(re.compile(r"/login\?expired=1"))
    expect(login.session_expired_message()).to_contain_text("session has expired")


def test_expired_token_is_rejected_on_reload(page, credentials):
    login = LoginPage(page).open()
    creds = credentials("readonly")
    login.login(creds.username, creds.password)
    page.evaluate("t => window.localStorage.setItem('bellstb.token', t)", _fake_token(-60))
    page.reload()
    expect(page).to_have_url(re.compile("/login"))


@pytest.mark.parametrize("path", ["/dashboard", "/devices", "/users", "/audit-logs"])
def test_unauthenticated_route_access_redirects(page, path):
    page.goto(path)
    expect(page).to_have_url(re.compile("/login"))
    expect(page.get_by_test_id("login-title")).to_be_visible()


@pytest.mark.parametrize("path", ["/users", "/audit-logs"])
def test_unauthorized_role_route_access(readonly_page, path):
    readonly_page.goto(path)
    expect(readonly_page.get_by_test_id("access-denied")).to_be_visible()


def test_login_after_logout(page, credentials):
    login = LoginPage(page).open()
    creds = credentials("admin")
    login.login(creds.username, creds.password)
    DashboardPage(page).logout()
    login.login(creds.username, creds.password)
    expect(page.get_by_test_id("dashboard-page")).to_be_visible()
    assert DashboardPage(page).header_role() == "Administrator"


def test_deactivated_user_cannot_login(page, credentials):
    # The seeded deactivated account shares the support engineer seed password.
    login = LoginPage(page).open()
    login.login(USERS["deactivated_seed_user"], credentials("support").password, expect_success=False)
    assert "deactivated" in login.error_text().lower()


def test_redirect_back_to_requested_page_after_login(page, credentials):
    page.goto("/alerts")
    expect(page).to_have_url(re.compile("/login"))
    creds = credentials("support")
    login = LoginPage(page)
    login.fill(login.username_input, creds.username)
    login.fill(login.password_input, creds.password)
    login.submit_button.click()
    expect(page).to_have_url(re.compile("/alerts"))
