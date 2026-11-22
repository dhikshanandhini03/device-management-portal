"""Reusable assertions for API responses and data comparisons."""

import jsonschema
import requests

from utils.logger import get_logger

log = get_logger("assertions")


def assert_status(response: requests.Response, expected: int | tuple[int, ...]) -> None:
    expected_set = (expected,) if isinstance(expected, int) else expected
    assert response.status_code in expected_set, (
        f"{response.request.method} {response.url} -> {response.status_code}, expected {expected_set}. "
        f"Body: {response.text[:500]}"
    )


def assert_schema(payload, schema: dict) -> None:
    try:
        jsonschema.validate(payload, schema)
    except jsonschema.ValidationError as exc:
        raise AssertionError(f"Schema validation failed at {list(exc.absolute_path)}: {exc.message}") from exc


def assert_required_fields(obj: dict, fields: list[str]) -> None:
    missing = [f for f in fields if f not in obj]
    assert not missing, f"Missing fields {missing} in {sorted(obj)}"


def assert_close(actual: float, expected: float, tolerance: float, label: str = "value") -> None:
    assert abs(actual - expected) <= tolerance, f"{label}: {actual} differs from {expected} by more than {tolerance}"


def assert_sorted(values: list, descending: bool = False, label: str = "values") -> None:
    assert values == sorted(values, reverse=descending), f"{label} not sorted ({'desc' if descending else 'asc'}): {values}"


def page_schema(item_schema: dict) -> dict:
    return {
        "type": "object",
        "required": ["items", "total", "page", "page_size", "pages"],
        "properties": {
            "items": {"type": "array", "items": item_schema},
            "total": {"type": "integer", "minimum": 0},
            "page": {"type": "integer", "minimum": 1},
            "page_size": {"type": "integer", "minimum": 1},
            "pages": {"type": "integer", "minimum": 1},
        },
    }


DEVICE_SCHEMA = {
    "type": "object",
    "required": ["device_id", "serial_number", "mac_address", "model", "firmware_version", "connection_status",
                 "health_status", "ip_address", "region", "customer_ref"],
    "properties": {
        "device_id": {"type": "string", "pattern": "^STB-"},
        "serial_number": {"type": "string"},
        "mac_address": {"type": "string", "pattern": "^([0-9A-F]{2}:){5}[0-9A-F]{2}$"},
        "connection_status": {"enum": ["ONLINE", "OFFLINE", "REBOOTING"]},
        "health_status": {"enum": ["HEALTHY", "WARNING", "CRITICAL"]},
        "update_available": {"type": "boolean"},
    },
}

COMMAND_SCHEMA = {
    "type": "object",
    "required": ["command_code", "device_id", "command_type", "status", "created_at", "expires_at", "history"],
    "properties": {
        "command_code": {"type": "string", "pattern": "^CMD-"},
        "status": {"enum": ["PENDING", "QUEUED", "SENT", "ACKNOWLEDGED", "EXECUTING", "SUCCESSFUL", "FAILED", "TIMED_OUT"]},
        "history": {"type": "array"},
    },
}

ALERT_SCHEMA = {
    "type": "object",
    "required": ["alert_code", "device_id", "category", "severity", "status", "created_at"],
    "properties": {
        "severity": {"enum": ["INFO", "WARNING", "CRITICAL"]},
        "status": {"enum": ["OPEN", "ACKNOWLEDGED", "RESOLVED"]},
    },
}

USER_SCHEMA = {
    "type": "object",
    "required": ["id", "username", "email", "full_name", "role", "is_active"],
    "properties": {"role": {"enum": ["ADMIN", "SUPPORT_ENGINEER", "READ_ONLY"]}, "is_active": {"type": "boolean"}},
}

AUDIT_SCHEMA = {
    "type": "object",
    "required": ["id", "username", "action", "result", "created_at"],
    "properties": {"result": {"enum": ["SUCCESS", "FAILURE", "DENIED"]}},
}

FIRMWARE_SCHEMA = {
    "type": "object",
    "required": ["id", "version", "model", "status", "is_latest", "device_count"],
    "properties": {"status": {"enum": ["ACTIVE", "BETA", "DEPRECATED"]}, "device_count": {"type": "integer"}},
}

DEPLOYMENT_SCHEMA = {
    "type": "object",
    "required": ["deployment_code", "firmware_version", "status", "target_count", "successful_count", "failed_count",
                 "pending_count", "created_at"],
}

APPLICATION_SCHEMA = {
    "type": "object",
    "required": ["id", "name", "package_id", "latest_version", "device_count", "update_available_count"],
}
