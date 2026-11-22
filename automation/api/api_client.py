"""Thin HTTP client for the portal REST API (used for test setup, teardown and API tests)."""

import requests

from config.settings import settings
from utils.logger import get_logger

log = get_logger("api")


class ApiClient:
    def __init__(self, base_url: str | None = None, token: str | None = None, timeout: float = 30):
        self.base_url = (base_url or settings.api_url).rstrip("/")
        self.session = requests.Session()
        self.timeout = timeout
        self.token: str | None = None
        self.user: dict | None = None
        if token:
            self.set_token(token)

    def set_token(self, token: str | None) -> None:
        self.token = token
        if token:
            self.session.headers["Authorization"] = f"Bearer {token}"
        else:
            self.session.headers.pop("Authorization", None)

    def request(self, method: str, path: str, **kwargs) -> requests.Response:
        url = path if path.startswith("http") else f"{self.base_url}{path}"
        kwargs.setdefault("timeout", self.timeout)
        response = self.session.request(method, url, **kwargs)
        log.debug("%s %s -> %s", method, url, response.status_code)
        return response

    def get(self, path: str, **kwargs) -> requests.Response:
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs) -> requests.Response:
        return self.request("POST", path, **kwargs)

    def put(self, path: str, **kwargs) -> requests.Response:
        return self.request("PUT", path, **kwargs)

    def patch(self, path: str, **kwargs) -> requests.Response:
        return self.request("PATCH", path, **kwargs)

    def delete(self, path: str, **kwargs) -> requests.Response:
        return self.request("DELETE", path, **kwargs)

    def json(self, method: str, path: str, expected: int = 200, **kwargs):
        response = self.request(method, path, **kwargs)
        if response.status_code != expected:
            raise AssertionError(f"{method} {path} -> {response.status_code} (expected {expected}): {response.text[:400]}")
        return response.json()


class GatewayClient:
    """Acts as a device through the device gateway API (requires the shared gateway key)."""

    def __init__(self, key: str | None = None, base_url: str | None = None):
        self.base_url = (base_url or settings.api_url).rstrip("/") + "/gateway"
        self.session = requests.Session()
        self.session.headers["X-Gateway-Key"] = key or settings.gateway_key

    def send_event(self, device_id: str, event_type: str, severity: str, description: str, package_id: str | None = None,
                   log_entry: dict | None = None) -> dict:
        event = {"device_id": device_id, "event_type": event_type, "severity": severity, "description": description}
        if package_id:
            event["package_id"] = package_id
        if log_entry:
            event["log"] = log_entry
        r = self.session.post(f"{self.base_url}/events", json={"events": [event]}, timeout=30)
        r.raise_for_status()
        return r.json()
