import random
import string
import time

LAB_MODEL = "VIP5662W"


def run_id() -> str:
    return f"{time.strftime('%m%d%H%M')}{random.randint(10, 99)}"


def lab_device(model: str = LAB_MODEL) -> dict:
    """A STABLE_ONLINE lab device; the device ID is STB-<last 8 chars of the serial>."""
    serial = "LAB" + "".join(random.choices(string.digits, k=9))
    return {
        "serial_number": serial,
        "mac_address": "02:4E:" + ":".join(f"{random.randint(0, 255):02X}" for _ in range(4)),
        "model": model,
        "hardware_version": "2.3",
        "ip_address": f"10.{random.randint(1, 250)}.{random.randint(0, 255)}.{random.randint(2, 250)}",
        "customer_ref": f"LAB-{random.randint(100000, 999999)}",
        "region": "Ontario",
        "city": "Toronto",
        "profile_label": "Stable online (lab device)",
        "status_label": "Online",
    }


def support_user() -> dict:
    suffix = run_id()
    return {
        "username": f"nightly.{suffix}",
        "full_name": f"Nightly Support {suffix}",
        "email": f"nightly.{suffix}@bellstb.local",
        "role": "SUPPORT_ENGINEER",
        "password": f"Nightly@{random.randint(1000, 9999)}x",
    }
