"""Static framework configuration (paths, roles, labels)."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPORTS_DIR = ROOT / "reports"
SCREENSHOTS_DIR = ROOT / "screenshots"
LOGS_DIR = ROOT / "logs"
DOWNLOADS_DIR = ROOT / "reports" / "downloads"
TEST_DATA_DIR = ROOT / "test_data"

for _d in (REPORTS_DIR, SCREENSHOTS_DIR, LOGS_DIR, DOWNLOADS_DIR):
    _d.mkdir(parents=True, exist_ok=True)

ROLE_LABELS = {
    "ADMIN": "Administrator",
    "SUPPORT_ENGINEER": "Support Engineer",
    "READ_ONLY": "Read Only",
}

TOKEN_STORAGE_KEY = "bellstb.token"
USER_STORAGE_KEY = "bellstb.user"

COMMAND_TERMINAL_STATUSES = {"SUCCESSFUL", "FAILED", "TIMED_OUT"}
COMMAND_STAGE_ORDER = ["PENDING", "QUEUED", "SENT", "ACKNOWLEDGED", "EXECUTING", "SUCCESSFUL"]
DEPLOYMENT_FINAL_STATUSES = {"COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED", "CANCELLED", "ROLLED_BACK"}

VIEWPORT = {"width": 1440, "height": 900}
