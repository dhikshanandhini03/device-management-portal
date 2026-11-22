"""Test data builders. Generated values are unique per call so tests can run in parallel."""

import json
import random
import uuid

from faker import Faker

from config.config import TEST_DATA_DIR

fake = Faker("en_CA")


def load_json(name: str) -> dict:
    with open(TEST_DATA_DIR / name, encoding="utf-8") as f:
        return json.load(f)


USERS = load_json("users.json")
DEVICES = load_json("devices.json")


def _token(n: int) -> str:
    return uuid.uuid4().hex[:n].upper()


def device_payload(model: str | None = None, profile: str = "STABLE_ONLINE", status: str = "ONLINE", region: str | None = None) -> dict:
    model = model or DEVICES["default_test_model"]
    spec = DEVICES["models"][model]
    region = region or random.choice(list(DEVICES["regions"]))
    # Leading 9 keeps automation device IDs (STB-9xxxxxxx) after seeded devices in default sort order.
    digits = f"9{uuid.uuid4().int % 10**7:07d}"
    return {
        "serial_number": f"{spec['serial_prefix']}{digits}",
        "mac_address": "02:" + ":".join(f"{random.randint(0, 255):02X}" for _ in range(5)),
        "model": model,
        "hardware_version": spec["hardware"],
        "ip_address": f"10.{random.randint(10, 250)}.{random.randint(0, 255)}.{random.randint(2, 250)}",
        "customer_ref": f"QA-{_token(8)}",
        "region": region,
        "city": random.choice(DEVICES["regions"][region]),
        "simulation_profile": profile,
        "initial_status": status,
    }


def user_payload(role: str = "SUPPORT_ENGINEER", active: bool = True) -> dict:
    first, last = fake.first_name(), fake.last_name()
    suffix = _token(6).lower()
    username = f"qa.{first.lower()[:6]}.{suffix}".replace("'", "")
    return {
        "username": username,
        "email": f"{username}@qa.bellstb.local",
        "full_name": f"{first} {last}",
        "role": role,
        "password": f"Qa!{_token(6)}a9",
        "is_active": active,
    }


def deployment_name() -> str:
    return f"QA rollout {_token(6)}"
