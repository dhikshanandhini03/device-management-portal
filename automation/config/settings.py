"""Environment-driven settings. Secrets come from environment variables or a local .env file, never from code."""

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
# Real environment wins, then a developer .env, then the documented development defaults.
load_dotenv(ROOT / ".env", override=False)
load_dotenv(ROOT / ".env.example", override=False)


def _required(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable {name}")
    return value


@dataclass(frozen=True)
class Credentials:
    username: str
    password: str


@dataclass(frozen=True)
class Settings:
    base_url: str = field(default_factory=lambda: os.getenv("BASE_URL", "http://localhost:3000").rstrip("/"))
    api_url: str = field(default_factory=lambda: os.getenv("API_URL", "http://localhost:3000/api").rstrip("/"))
    gateway_key: str = field(default_factory=lambda: os.getenv("GATEWAY_API_KEY", ""))
    default_timeout_ms: int = field(default_factory=lambda: int(os.getenv("DEFAULT_TIMEOUT_MS", "15000")))
    command_timeout_s: int = field(default_factory=lambda: int(os.getenv("COMMAND_TIMEOUT_S", "60")))
    deployment_timeout_s: int = field(default_factory=lambda: int(os.getenv("DEPLOYMENT_TIMEOUT_S", "150")))

    def credentials(self, role: str) -> Credentials:
        prefix = {"admin": "ADMIN", "support": "SUPPORT", "readonly": "READONLY"}[role]
        return Credentials(_required(f"{prefix}_USERNAME"), _required(f"{prefix}_PASSWORD"))


settings = Settings()
