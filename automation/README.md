# BELL STB Portal – Playwright (Python) Automation Framework

End-to-end UI, API and workflow automation for the BELL STB Device Management portal, written in
**Python 3.12+ with Playwright (sync API) and pytest**. It runs against the dockerised portal and its
device simulator – never against real Bell devices.

## Structure

```
automation/
├── config/          settings.py (env-driven URLs/credentials), config.py (paths, constants)
├── pages/           Page Object Model – BasePage + one page object per portal module
├── tests/           test_<module>.py UI suites, test_api.py (REST), test_end_to_end.py (workflows)
├── fixtures/        test_fixtures.py – browser/session/API/test-data fixtures (registered in conftest)
├── test_data/       users.json, devices.json, test_data_factory.py (Faker builders)
├── api/             api_client.py, auth_api.py, device_api.py (setup, teardown, API tests)
├── utils/           logger, helpers (polling), screenshot_helper, assertions (JSON schema etc.)
├── reports/         HTML report, Allure results, Playwright traces, downloads
├── screenshots/     failure + workflow evidence
├── logs/            automation.log / pytest.log
├── conftest.py      browser context config, failure evidence hooks, report metadata
└── pytest.ini       discovery, markers, reporting defaults
```

## Setup

```bash
cd automation
python -m venv .venv && . .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m playwright install --with-deps chromium firefox webkit
cp .env.example .env                                  # adjust URLs/credentials if needed
```

The portal must be running (`docker compose up -d --build` from the repository root, UI at http://localhost:3000).

Credentials are read from environment variables (or `.env`). `.env.example` only contains the
documented **development-only** demo accounts of the local simulated stack.

## Running

```bash
pytest -v                                   # full suite (chromium, headless)
pytest -m smoke                             # critical path
pytest -m regression
pytest -m end_to_end
pytest -m api                               # REST API tests only (no browser)
pytest --browser chromium
pytest --browser firefox
pytest --browser webkit
pytest --browser chromium --browser firefox # cross-browser
pytest --headed --slowmo 300                # watch the browser
pytest -n 4                                 # parallel (pytest-xdist)
pytest --html=reports/report.html --self-contained-html
pytest --tracing retain-on-failure          # default; traces in reports/test-results
pytest --reruns 1                           # optional retry for infrastructure flakiness
```

Markers: `smoke, regression, sanity, login, dashboard, device_management, remote_operations, firmware,
applications, monitoring, alerts, analytics, users, audit, api, end_to_end`.

## Reports & evidence

| Artifact | Location |
|---|---|
| pytest-html report (self-contained, screenshots embedded for failures) | `reports/report.html` |
| Allure results | `reports/allure-results` → `allure serve reports/allure-results` |
| Playwright traces (retained on failure) | `reports/test-results/**/trace.zip` → `playwright show-trace <zip>` |
| Failure / workflow screenshots | `screenshots/` |
| Execution logs | `logs/automation.log`, `logs/pytest.log` |

## Design notes

* **Page Object Model** – tests never touch selectors directly; `BasePage` holds shared helpers
  (navigation, MUI select handling, dialogs, toasts, waits, screenshots).
* **Locators** – `data-testid` attributes and ARIA roles; web-first `expect` assertions; no fixed sleeps
  (backend state is polled with `utils.helpers.wait_until`).
* **Isolation** – each test creates its own devices/users through the API (`device_factory`,
  `user_factory`) and removes/deactivates them on teardown. Automation devices use deterministic
  simulator profiles (`STABLE_ONLINE`, `STABLE_OFFLINE`) so command and firmware outcomes are predictable.
* **UI + backend validation** – UI actions are verified against API state (command lifecycle, deployment
  counts, firmware on device, audit records).
* **Fast authentication** – most UI tests inject an API-issued session; the login suite exercises the real form.
* **Device events** – alert tests act as a device via the gateway API (`GATEWAY_API_KEY`) to raise a real alert.
