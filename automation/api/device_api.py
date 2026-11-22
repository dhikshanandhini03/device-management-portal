"""Domain helpers on top of ApiClient: devices, commands, firmware, alerts, users, audit."""

from api.api_client import ApiClient
from config.config import COMMAND_TERMINAL_STATUSES, DEPLOYMENT_FINAL_STATUSES
from config.settings import settings
from utils.helpers import wait_until


class DeviceApi:
    def __init__(self, client: ApiClient):
        self.c = client

    # ---- devices
    def list(self, **params) -> dict:
        return self.c.json("GET", "/devices", params=params)

    def get(self, device_id: str) -> dict:
        return self.c.json("GET", f"/devices/{device_id}")

    def create(self, payload: dict) -> dict:
        return self.c.json("POST", "/devices", expected=201, json=payload)

    def delete(self, device_id: str):
        return self.c.delete(f"/devices/{device_id}")

    def filters(self) -> dict:
        return self.c.json("GET", "/devices/filters")

    def first(self, **params) -> dict:
        items = self.list(page_size=1, **params)["items"]
        assert items, f"No device matches {params}"
        return items[0]

    def software(self, device_id: str) -> dict:
        return self.c.json("GET", f"/devices/{device_id}/software")

    def network(self, device_id: str) -> dict:
        return self.c.json("GET", f"/devices/{device_id}/network")

    def logs(self, device_id: str, **params) -> dict:
        return self.c.json("GET", f"/devices/{device_id}/logs", params=params)

    def events(self, device_id: str, **params) -> dict:
        return self.c.json("GET", f"/devices/{device_id}/events", params=params)

    def telemetry(self, device_id: str, hours: int = 24) -> dict:
        return self.c.json("GET", f"/devices/{device_id}/telemetry", params={"hours": hours})

    def wait_for_status(self, device_id: str, status: str, timeout: float = 60) -> dict:
        return wait_until(lambda: self.get(device_id), lambda d: d["connection_status"] == status, timeout=timeout,
                          message=f"{device_id} to be {status}")

    # ---- commands
    def send_command(self, device_id: str, command_type: str, **extra):
        return self.c.post("/commands", json={"device_id": device_id, "command_type": command_type, **extra})

    def command(self, code: str) -> dict:
        return self.c.json("GET", f"/commands/{code}")

    def commands(self, **params) -> dict:
        return self.c.json("GET", "/commands", params=params)

    def wait_for_command(self, code: str, statuses: set[str] | None = None, timeout: float | None = None) -> dict:
        target = statuses or COMMAND_TERMINAL_STATUSES
        return wait_until(lambda: self.command(code), lambda c: c["status"] in target,
                          timeout=timeout or settings.command_timeout_s, message=f"command {code} in {target}")

    # ---- firmware
    def firmware(self, **params) -> list[dict]:
        return self.c.json("GET", "/firmware", params=params)

    def create_deployment(self, payload: dict):
        return self.c.post("/firmware/deployments", json=payload)

    def deployment(self, code: str) -> dict:
        return self.c.json("GET", f"/firmware/deployments/{code}")

    def deployment_targets(self, code: str, **params) -> dict:
        return self.c.json("GET", f"/firmware/deployments/{code}/targets", params=params)

    def wait_for_deployment(self, code: str, timeout: float | None = None) -> dict:
        return wait_until(lambda: self.deployment(code), lambda d: d["status"] in DEPLOYMENT_FINAL_STATUSES,
                          timeout=timeout or settings.deployment_timeout_s, interval=2,
                          message=f"deployment {code} to finish")

    def deployable_firmware(self, model: str, exclude_version: str) -> dict:
        candidates = [f for f in self.firmware(model=model) if f["status"] == "ACTIVE" and f["version"] != exclude_version]
        assert candidates, f"No alternative ACTIVE firmware for {model}"
        return candidates[0]

    # ---- alerts
    def alerts(self, **params) -> dict:
        return self.c.json("GET", "/alerts", params=params)

    def device_alerts(self, device_id: str) -> list[dict]:
        return self.c.json("GET", f"/devices/{device_id}/alerts")


class AdminApi:
    def __init__(self, client: ApiClient):
        self.c = client

    def users(self, **params) -> dict:
        return self.c.json("GET", "/users", params=params)

    def find_user(self, username: str) -> dict | None:
        items = self.users(search=username, page_size=50)["items"]
        return next((u for u in items if u["username"] == username), None)

    def create_user(self, payload: dict) -> dict:
        return self.c.json("POST", "/users", expected=201, json=payload)

    def deactivate_user(self, user_id: int):
        return self.c.post(f"/users/{user_id}/deactivate")

    def audit(self, **params) -> dict:
        return self.c.json("GET", "/audit-logs", params=params)

    def wait_for_audit(self, timeout: float = 20, **params) -> dict:
        return wait_until(lambda: self.audit(**params), lambda r: r["total"] > 0, timeout=timeout,
                          message=f"audit entry {params}")
