import asyncio
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from stb_simulator.config import config
from stb_simulator.engine import SimulatorEngine
from stb_simulator.gateway import HttpDeviceGateway

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
log = logging.getLogger("simulator")
logging.getLogger("httpx").setLevel(logging.WARNING)

gateway = HttpDeviceGateway(config.backend_url, config.gateway_key)
engine = SimulatorEngine(config, gateway)


async def _autostart() -> None:
    for attempt in range(60):
        try:
            await engine.start()
            return
        except Exception as exc:
            log.info("Waiting for backend gateway (%s), attempt %d", exc.__class__.__name__, attempt + 1)
            await asyncio.sleep(5)


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(_autostart()) if config.autostart else None
    yield
    if task:
        task.cancel()
    await engine.stop()
    await gateway.close()


app = FastAPI(title="BELL STB Device Simulator", version="1.0.0", lifespan=lifespan,
              description="Simulated STB fleet. Not connected to real Bell devices.")


@app.get("/status")
def status():
    return engine.status()


@app.post("/start")
async def start():
    await engine.start()
    return engine.status()


@app.post("/stop")
async def stop():
    await engine.stop()
    return engine.status()


@app.post("/reset")
async def reset():
    await engine.reset()
    return engine.status()


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=config.port)
