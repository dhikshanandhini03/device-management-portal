"""Reusable pytest fixtures: browser/context config, role-based sessions, API clients and test data lifecycle."""

import pytest
from playwright.sync_api import Page

from api.api_client import ApiClient, GatewayClient
from api.auth_api import AuthApi
from api.device_api import AdminApi, DeviceApi
from config.settings import settings
from pages.base_page import BasePage
from test_data import test_data_factory as factory
from utils.logger import get_logger

log = get_logger("fixtures")


# ---------------------------------------------------------------- browser
@pytest.fixture(scope="session")
def base_url() -> str:
    return settings.base_url


# ---------------------------------------------------------------- API clients
@pytest.fixture(scope="session")
def api_client() -> ApiClient:
    return ApiClient()


@pytest.fixture(scope="session")
def auth_api(api_client) -> AuthApi:
    return AuthApi(api_client)


@pytest.fixture(scope="session")
def admin_api(auth_api) -> ApiClient:
    return auth_api.login_as("admin")


@pytest.fixture(scope="session")
def support_api(auth_api) -> ApiClient:
    return auth_api.login_as("support")


@pytest.fixture(scope="session")
def readonly_api(auth_api) -> ApiClient:
    return auth_api.login_as("readonly")


@pytest.fixture(scope="session")
def devices(admin_api) -> DeviceApi:
    return DeviceApi(admin_api)


@pytest.fixture(scope="session")
def admin(admin_api) -> AdminApi:
    return AdminApi(admin_api)


@pytest.fixture(scope="session")
def gateway() -> GatewayClient:
    if not settings.gateway_key:
        pytest.skip("GATEWAY_API_KEY not configured")
    return GatewayClient()


# ---------------------------------------------------------------- authenticated pages
def _start_session(page: Page, client: ApiClient, base_url: str) -> Page:
    """Authenticate the browser with an API-issued token (fast, avoids repeating the UI login flow)."""
    page.goto(f"{base_url}/login")
    BasePage(page, base_url).set_session(client.token, client.user)
    page.goto(f"{base_url}/dashboard")
    page.get_by_test_id("current-username").wait_for()
    return page


@pytest.fixture
def admin_page(page, admin_api, base_url) -> Page:
    return _start_session(page, admin_api, base_url)


@pytest.fixture
def support_page(page, support_api, base_url) -> Page:
    return _start_session(page, support_api, base_url)


@pytest.fixture
def readonly_page(page, readonly_api, base_url) -> Page:
    return _start_session(page, readonly_api, base_url)


@pytest.fixture
def login_as(page, auth_api, base_url):
    def _login(role: str) -> Page:
        return _start_session(page, auth_api.login_as(role), base_url)

    return _login


@pytest.fixture
def credentials():
    return settings.credentials


# ---------------------------------------------------------------- test data lifecycle
@pytest.fixture
def device_factory(devices):
    created: list[str] = []

    def _create(**kwargs) -> dict:
        for _ in range(3):
            response = devices.c.post("/devices", json=factory.device_payload(**kwargs))
            if response.status_code == 201:
                device = response.json()
                created.append(device["device_id"])
                log.info("Created test device %s (%s)", device["device_id"], kwargs)
                return device
            if response.status_code != 409:
                raise AssertionError(f"Device creation failed: {response.status_code} {response.text}")
        raise AssertionError("Could not create a unique test device")

    yield _create
    for device_id in created:
        r = devices.delete(device_id)
        log.info("Cleanup device %s -> %s", device_id, r.status_code)


@pytest.fixture
def online_device(device_factory) -> dict:
    return device_factory(profile="STABLE_ONLINE", status="ONLINE")


@pytest.fixture
def offline_device(device_factory) -> dict:
    return device_factory(profile="STABLE_OFFLINE", status="OFFLINE")


@pytest.fixture
def user_factory(admin):
    created: list[dict] = []

    def _create(role: str = "SUPPORT_ENGINEER", **overrides) -> dict:
        payload = {**factory.user_payload(role), **overrides}
        user = admin.create_user(payload)
        user["password"] = payload["password"]
        created.append(user)
        return user

    yield _create
    for user in created:
        admin.deactivate_user(user["id"])


@pytest.fixture
def track_user(admin):
    """Register usernames created through the UI so they are deactivated after the test."""
    usernames: list[str] = []
    yield usernames.append
    for username in usernames:
        user = admin.find_user(username)
        if user and user["is_active"]:
            admin.deactivate_user(user["id"])


@pytest.fixture
def device_alert(online_device, gateway, devices) -> dict:
    """Raise a real alert for a test device through the device gateway (as a device would)."""
    gateway.send_event(online_device["device_id"], "APP_CRASH", "ERROR",
                       f"Application ca.bell.fibetv crashed on {online_device['device_id']} (automation)",
                       package_id="ca.bell.fibetv")
    alerts = devices.device_alerts(online_device["device_id"])
    alert = next(a for a in alerts if a["category"] == "APP_CRASH" and a["status"] == "OPEN")
    return alert
