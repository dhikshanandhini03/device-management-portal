from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "BELL STB DEVICE MANAGEMENT"
    environment: str = "development"
    database_url: str = "postgresql+psycopg://bellstb:bellstb_dev_password@localhost:5432/bellstb"

    jwt_secret: str = "change-me-in-env"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60

    gateway_api_key: str = "dev-gateway-key"
    simulator_url: str = "http://simulator:8100"

    cors_origins: str = "http://localhost:3000,http://localhost:5173"

    command_default_timeout_seconds: int = 120
    telemetry_raw_retention_hours: int = 24
    background_interval_seconds: int = 5

    seed_device_count: int = 500
    seed_admin_password: str = "Admin@12345"
    seed_support_password: str = "Support@12345"
    seed_readonly_password: str = "Readonly@12345"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
