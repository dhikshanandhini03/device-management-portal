"""Read-only test-data lookups against the demo's in-browser data store (the demo equivalent of a DB query).

All test *actions* go through the UI; this only finds suitable records (e.g. a lab device or an open alert).
"""

from playwright.sync_api import Page

STATE_KEY = "bellstb.demo.state"

_JS_PRELUDE = """
const s = JSON.parse(localStorage.getItem(key) || 'null');
if (!s) return null;
const fw = (id) => s.firmware.find((f) => f.id === id);
"""


def _query(page: Page, body: str, arg=None):
    return page.evaluate(f"([key, arg]) => {{ {_JS_PRELUDE} {body} }}", [STATE_KEY, arg])


def is_seeded(page: Page) -> bool:
    return bool(page.evaluate("key => !!localStorage.getItem(key)", STATE_KEY))


def stable_online_device(page: Page) -> dict:
    """A lab device that the simulator keeps ONLINE (deterministic command outcomes)."""
    return _query(page, """
        const d = s.devices.find((x) => x.profile === 'STABLE_ONLINE' && x.st.connection_status === 'ONLINE');
        return d && { device_id: d.device_id, serial_number: d.serial_number, model: d.model, firmware_version: fw(d.fw_id).version };
    """)


def stable_offline_device(page: Page) -> dict:
    return _query(page, """
        const d = s.devices.find((x) => x.profile === 'STABLE_OFFLINE');
        return d && { device_id: d.device_id, serial_number: d.serial_number, model: d.model };
    """)


def firmware(page: Page, model: str, status: str | None = None, latest: bool | None = None) -> dict:
    return _query(page, """
        const f = s.firmware.find((x) => x.model === arg.model && (!arg.status || x.status === arg.status)
            && (arg.latest === null || x.is_latest === arg.latest));
        return f && { id: f.id, version: f.version, status: f.status, is_latest: f.is_latest };
    """, {"model": model, "status": status, "latest": latest})


def open_alert(page: Page) -> dict:
    """An OPEN alert on a device the simulator will not auto-resolve during the test."""
    return _query(page, """
        const auto = ['HIGH_CPU', 'HIGH_MEMORY', 'DEVICE_OFFLINE', 'NETWORK_DISCONNECT'];
        const a = s.alerts.find((x) => x.status === 'OPEN' && !auto.includes(x.category));
        const d = a && s.devices.find((x) => x.id === a.pk);
        return a && { alert_code: a.code, category: a.category, device_id: d.device_id };
    """)


def model_device_count(page: Page, model: str) -> int:
    return _query(page, "return s.devices.filter((d) => d.model === arg).length;", model)
