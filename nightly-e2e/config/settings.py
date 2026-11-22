"""Environment-driven settings for the nightly E2E suite (Jenkins passes these as environment variables)."""

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
REPORTS_DIR = ROOT / "reports"
load_dotenv(ROOT / ".env", override=False)

DEMO_URL = "https://dhikshanandhini03.github.io/device-management-portal"
# Public demo accounts shown on the demo login page; override via environment for other deployments.
DEFAULT_ACCOUNTS = {
    "admin": ("admin", "Admin@12345"),
    "support": ("support", "Support@12345"),
    "readonly": ("readonly", "Readonly@12345"),
}
ROLE_LABELS = {"ADMIN": "Administrator", "SUPPORT_ENGINEER": "Support Engineer", "READ_ONLY": "Read Only"}


@dataclass(frozen=True)
class Credentials:
    username: str
    password: str


@dataclass(frozen=True)
class Settings:
    base_url: str = field(default_factory=lambda: os.getenv("BASE_URL", DEMO_URL).rstrip("/"))
    default_timeout_ms: int = field(default_factory=lambda: int(os.getenv("DEFAULT_TIMEOUT_MS", "15000")))
    command_timeout_ms: int = field(default_factory=lambda: int(os.getenv("COMMAND_TIMEOUT_MS", "60000")))
    deployment_timeout_ms: int = field(default_factory=lambda: int(os.getenv("DEPLOYMENT_TIMEOUT_MS", "120000")))

    def credentials(self, role: str) -> Credentials:
        user, pwd = DEFAULT_ACCOUNTS[role]
        prefix = role.upper()
        return Credentials(os.getenv(f"{prefix}_USERNAME", user), os.getenv(f"{prefix}_PASSWORD", pwd))


settings = Settings()
