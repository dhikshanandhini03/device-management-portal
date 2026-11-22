import os
from dataclasses import dataclass


@dataclass(frozen=True)
class SimConfig:
    backend_url: str = os.getenv("BACKEND_URL", "http://localhost:8010")
    gateway_key: str = os.getenv("GATEWAY_API_KEY", "dev-gateway-key-change-me")
    autostart: bool = os.getenv("SIM_AUTOSTART", "true").lower() == "true"
    tick_seconds: float = float(os.getenv("SIM_TICK_SECONDS", "5"))
    heartbeat_every_ticks: int = int(os.getenv("SIM_HEARTBEAT_EVERY_TICKS", "6"))
    telemetry_every_ticks: int = int(os.getenv("SIM_TELEMETRY_EVERY_TICKS", "12"))
    command_poll_seconds: float = float(os.getenv("SIM_COMMAND_POLL_SECONDS", "1"))
    command_stage_seconds: float = float(os.getenv("SIM_COMMAND_STAGE_SECONDS", "1.5"))
    reboot_seconds: float = float(os.getenv("SIM_REBOOT_SECONDS", "6"))
    deployment_concurrency: int = int(os.getenv("SIM_DEPLOYMENT_CONCURRENCY", "40"))
    disconnect_probability: float = float(os.getenv("SIM_DISCONNECT_PROBABILITY", "0.0012"))
    reconnect_probability: float = float(os.getenv("SIM_RECONNECT_PROBABILITY", "0.012"))
    registration_interval_minutes: float = float(os.getenv("SIM_REGISTRATION_INTERVAL_MINUTES", "30"))
    random_failure_rate: float = float(os.getenv("SIM_RANDOM_FAILURE_RATE", "0.03"))
    port: int = int(os.getenv("SIM_PORT", "8100"))


config = SimConfig()
