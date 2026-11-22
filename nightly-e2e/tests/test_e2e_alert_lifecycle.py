"""E2E: alert triage by a support engineer, verified in the audit trail by an administrator."""

import pytest
from playwright.sync_api import expect

from pages.alerts_page import AlertsPage
from pages.audit_logs_page import AuditLogsPage
from utils import demo_data
from utils.waits import wait_until

pytestmark = [pytest.mark.end_to_end, pytest.mark.alerts]


def test_support_acknowledges_and_resolves_alert(login, page):
    dashboard = login("support")
    alert = demo_data.open_alert(page)
    assert alert, "seed data must contain an OPEN alert"
    code = alert["alert_code"]

    alerts = AlertsPage(page).open()
    resolved_before = wait_until(page, lambda: alerts.text("alerts-resolved-value"), lambda v: v.replace(",", "").isdigit())
    alerts.search(code)
    expect(alerts.row(code)).to_have_attribute("data-status", "OPEN")

    alerts.acknowledge(code)
    alerts.resolve(code, "Nightly E2E: investigated and resolved")
    alerts.filter_status("Resolved")
    expect(alerts.row(code)).to_have_attribute("data-status", "RESOLVED")
    wait_until(page, lambda: alerts.summary("resolved"), lambda v: v >= int(resolved_before.replace(",", "")) + 1,
               message="resolved counter to increase")
    dashboard.logout()

    login("admin")
    audit = AuditLogsPage(page).open()
    audit.expect_event("ALERT_ACKNOWLEDGED", username="support", target=code)
    audit.expect_event("ALERT_RESOLVED", username="support", target=code)
