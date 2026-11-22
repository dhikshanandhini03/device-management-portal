# Nightly E2E – BELL STB demo portal

Playwright (Python) + pytest end-to-end suite that runs nightly in Jenkins against the GitHub Pages demo
(https://dhikshanandhini03.github.io/device-management-portal/). Independent from `../automation`
(which targets the full Docker stack and its REST API).

Every test gets a new browser context, so the demo seeds a fresh, isolated dataset per test. All actions go
through the UI; `utils/demo_data.py` only *reads* the demo's data store to pick suitable records
(e.g. a lab device or an open alert).

## Suites

| File | Workflow |
|---|---|
| `test_00_smoke.py` | Site up, seeded data, sign-in + navigation per role, invalid login (pipeline gate) |
| `test_e2e_device_monitoring.py` | Dashboard KPIs/charts → inventory search → device tabs → diagnostics; filter + CSV export reconciliation |
| `test_e2e_remote_operations.py` | Support reboots a device (full lifecycle, events, audit), config sync, read-only and offline restrictions |
| `test_e2e_firmware_lifecycle.py` | Register 2 lab devices → beta firmware deployment → verify → rollback → verify → audit |
| `test_e2e_alert_lifecycle.py` | Support acknowledges + resolves an alert, summary updates, admin audit |
| `test_e2e_user_rbac.py` | Admin creates a support engineer → access limits → deactivation → login denied → audit |
| `test_e2e_reports_and_settings.py` | Analytics charts + CSV export, log severity filter, threshold change + audit, read-only settings |

## Run locally

```bash
cd nightly-e2e
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m playwright install chromium
pytest -n 4 --browser chromium --html=reports/report.html --self-contained-html
pytest -m smoke                                   # availability gate only
pytest -m "firmware or alerts" --headed           # selected workflows
BASE_URL=http://localhost:5173 pytest             # another deployment of the demo build
```

Failures keep a screenshot, video and Playwright trace in `reports/test-results/`
(`playwright show-trace <trace.zip>`); the HTML report embeds the failure screenshot and URL.

## Jenkins job

1. Plugins: Pipeline, Git, Docker Pipeline, JUnit, HTML Publisher, Timestamper (optional: Allure, Email Extension).
   The agent needs Docker; the pipeline runs inside `mcr.microsoft.com/playwright/python:v1.55.0-noble`.
2. New Item → **Pipeline** → *Pipeline script from SCM* → Git
   `https://github.com/dhikshanandhini03/device-management-portal.git`, branch `main`,
   Script Path `nightly-e2e/Jenkinsfile`.
3. Run once with **Build with Parameters** so Jenkins registers the parameters and the nightly trigger
   (`H 2 * * *`, around 02:00 server time).

Parameters: `BASE_URL`, `BROWSERS` (`chromium` / `firefox` / `webkit` / `all`), `MARKERS` (pytest `-m` filter),
`WORKERS`, `NOTIFY_EMAIL`.

Stages: validate parameters → install → **smoke gate** (stops the build if the site is down) → E2E per browser.
Test failures mark the build **UNSTABLE**; infrastructure errors mark it **FAILED**. Each build publishes JUnit
results, the HTML report (tab per browser), Allure results and archived evidence (`reports/**`).

Agents without Docker: replace the `agent { docker { ... } }` block with `agent { label 'linux' }` and add
`python -m playwright install --with-deps chromium firefox webkit` to the Install stage.
