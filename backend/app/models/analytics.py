from datetime import datetime

from sqlalchemy import DateTime, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class FleetSnapshot(Base):
    """Periodic fleet-wide status counts used for availability trend analytics."""

    __tablename__ = "fleet_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), unique=True, index=True, nullable=False)
    total_devices: Mapped[int] = mapped_column(Integer, nullable=False)
    online_devices: Mapped[int] = mapped_column(Integer, nullable=False)
    offline_devices: Mapped[int] = mapped_column(Integer, nullable=False)
    warning_devices: Mapped[int] = mapped_column(Integer, nullable=False)
    critical_devices: Mapped[int] = mapped_column(Integer, nullable=False)
