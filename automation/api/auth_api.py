from api.api_client import ApiClient
from config.settings import settings


class AuthApi:
    def __init__(self, client: ApiClient | None = None):
        self.client = client or ApiClient()

    def login_raw(self, username: str, password: str):
        return self.client.post("/auth/login", json={"username": username, "password": password})

    def login(self, username: str, password: str) -> ApiClient:
        response = self.login_raw(username, password)
        if response.status_code != 200:
            raise AssertionError(f"Login failed for {username}: {response.status_code} {response.text[:200]}")
        data = response.json()
        authed = ApiClient(self.client.base_url, token=data["access_token"])
        authed.user = data["user"]
        authed.login_payload = data  # type: ignore[attr-defined]
        return authed

    def login_as(self, role: str) -> ApiClient:
        creds = settings.credentials(role)
        return self.login(creds.username, creds.password)

    @staticmethod
    def me(client: ApiClient):
        return client.get("/auth/me")

    @staticmethod
    def logout(client: ApiClient):
        return client.post("/auth/logout")
