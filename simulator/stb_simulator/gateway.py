"""Gateway abstraction.

The simulator only talks to the portal through this interface. A real integration (for example an
ACS/USP connector receiving data from physical Bell STBs) would push the same payloads to the same
backend gateway endpoints, so the simulator can be replaced without changing the portal.
"""

from typing import Protocol

import httpx


class DeviceGateway(Protocol):
    async def list_devices(self) -> list[dict]: ...
    async def send_heartbeats(self, reports: list[dict]) -> None: ...
    async def send_events(self, events: list[dict], logs: list[dict]) -> None: ...
    async def pending_commands(self) -> list[dict]: ...
    async def update_command(self, code: str, status: str, message: str | None = None) -> None: ...
    async def deployment_targets(self) -> list[dict]: ...
    async def update_target(self, target_id: int, status: str, error: str | None = None) -> None: ...
    async def register_device(self, payload: dict) -> dict | None: ...


class HttpDeviceGateway:
    def __init__(self, base_url: str, key: str):
        self._client = httpx.AsyncClient(base_url=base_url.rstrip("/") + "/api/gateway",
                                         headers={"X-Gateway-Key": key}, timeout=30)

    async def close(self) -> None:
        await self._client.aclose()

    async def list_devices(self) -> list[dict]:
        r = await self._client.get("/devices")
        r.raise_for_status()
        return r.json()

    async def send_heartbeats(self, reports: list[dict]) -> None:
        for i in range(0, len(reports), 500):
            r = await self._client.post("/heartbeats", json={"reports": reports[i:i + 500]})
            r.raise_for_status()

    async def send_events(self, events: list[dict], logs: list[dict]) -> None:
        if not events and not logs:
            return
        r = await self._client.post("/events", json={"events": events, "logs": logs})
        r.raise_for_status()

    async def pending_commands(self) -> list[dict]:
        r = await self._client.get("/commands/pending")
        r.raise_for_status()
        return r.json()

    async def update_command(self, code: str, status: str, message: str | None = None) -> None:
        r = await self._client.post(f"/commands/{code}/status", json={"status": status, "message": message})
        if r.status_code not in (200, 409):
            r.raise_for_status()

    async def deployment_targets(self) -> list[dict]:
        r = await self._client.get("/deployments/targets")
        r.raise_for_status()
        return r.json()

    async def update_target(self, target_id: int, status: str, error: str | None = None) -> None:
        r = await self._client.post(f"/deployments/targets/{target_id}/status",
                                    json={"status": status, "error_message": error})
        if r.status_code not in (200, 409):
            r.raise_for_status()

    async def register_device(self, payload: dict) -> dict | None:
        r = await self._client.post("/devices/register", json=payload)
        if r.status_code == 409:
            return None
        r.raise_for_status()
        return r.json()
