import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


@dataclass
class SimDevice:
    device_id: str
    model: str
    profile: str
    firmware_version: str
    status: str
    network_type: str
    cpu: float
    memory: float
    storage: float
    temperature: float
    signal: float | None
    boot_time: datetime
    applications: list[str] = field(default_factory=list)
    base_cpu: float = 20.0
    base_memory: float = 45.0
    spike_ticks: int = 0
    busy: bool = False
    dirty: bool = True

    @classmethod
    def from_gateway(cls, d: dict, rng: random.Random) -> "SimDevice":
        boot = d.get("last_boot_at")
        boot_time = datetime.fromisoformat(boot.replace("Z", "+00:00")) if boot else utcnow() - timedelta(hours=rng.uniform(1, 200))
        cpu = d.get("cpu_usage") or rng.uniform(8, 35)
        mem = d.get("memory_usage") or rng.uniform(30, 60)
        return cls(
            device_id=d["device_id"], model=d["model"], profile=d.get("simulation_profile", "STANDARD"),
            firmware_version=d.get("firmware_version", ""), status=d.get("connection_status", "OFFLINE"),
            network_type=d.get("network_type", "ETHERNET"), cpu=cpu, memory=mem,
            storage=d.get("storage_usage") or rng.uniform(20, 60), temperature=d.get("temperature_c") or rng.uniform(42, 55),
            signal=d.get("signal_strength_dbm"), boot_time=boot_time, applications=d.get("applications", []),
            base_cpu=min(cpu, 55) if cpu < 80 else rng.uniform(15, 40), base_memory=min(mem, 65) if mem < 80 else rng.uniform(35, 60),
            spike_ticks=rng.randint(3, 20) if cpu >= 80 else 0,
        )

    @property
    def online(self) -> bool:
        return self.status == "ONLINE"

    def drift(self, rng: random.Random) -> None:
        """Random-walk resource metrics with occasional load spikes."""
        if not self.online:
            return
        if self.spike_ticks > 0:
            self.spike_ticks -= 1
            target_cpu, target_mem = rng.uniform(86, 99), rng.uniform(75, 96)
        else:
            hour = utcnow().hour
            prime_time = 1.25 if 22 <= hour or hour <= 4 else 1.0  # 18:00-23:00 ET ~= 22:00-04:00 UTC
            target_cpu, target_mem = self.base_cpu * prime_time, self.base_memory
        self.cpu = clamp(self.cpu + (target_cpu - self.cpu) * 0.3 + rng.gauss(0, 3), 1, 100)
        self.memory = clamp(self.memory + (target_mem - self.memory) * 0.2 + rng.gauss(0, 1.5), 10, 100)
        self.storage = clamp(self.storage + rng.uniform(-0.02, 0.05), 5, 99)
        self.temperature = clamp(40 + self.cpu * 0.28 + rng.gauss(0, 1), 30, 95)
        if self.network_type == "WIFI":
            self.signal = clamp((self.signal or -60) + rng.gauss(0, 1.5), -88, -32)

    def report(self, record_telemetry: bool, rng: random.Random) -> dict:
        wifi = self.network_type == "WIFI"
        online = self.online
        weak = wifi and (self.signal or -60) < -75
        return {
            "device_id": self.device_id,
            "connection_status": self.status,
            "cpu_usage": round(self.cpu, 1) if online else 0,
            "memory_usage": round(self.memory, 1) if online else 0,
            "storage_usage": round(self.storage, 1),
            "temperature_c": round(self.temperature, 1),
            "network_type": self.network_type,
            "signal_strength_dbm": round(self.signal, 0) if wifi and self.signal is not None else None,
            "bandwidth_mbps": round(rng.uniform(20, 90) if wifi else rng.uniform(150, 940), 1) if online else 0,
            "latency_ms": round(rng.uniform(15, 60 if weak else 35) if wifi else rng.uniform(4, 16), 1) if online else 0,
            "packet_loss_pct": round(rng.choice([0, 0, 0, 0.1, 0.4] + ([3.5, 6.2] if weak else [])), 1) if online else 0,
            "boot_time": self.boot_time.isoformat(),
            "record_telemetry": record_telemetry and online,
        }
