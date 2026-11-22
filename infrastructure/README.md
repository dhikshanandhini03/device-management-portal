# Infrastructure

* `docker-compose.yml` (repository root) – local/CI stack: `db`, `backend`, `simulator`, `frontend`, all with health checks.
* `.github/workflows/ci.yml` – build, start the stack, run the Playwright/API suite, publish reports as artifacts.

## Hosting the portal for remote automation

GitHub hosts the source and runs the full stack inside GitHub Actions for every push. To expose the portal at a
public URL (for running the automation from another machine), deploy the same containers to any Docker host
(e.g. a small VM, Azure Container Apps, Render, Fly.io):

1. Provision PostgreSQL (or run the `db` service with a persistent volume).
2. Set strong values for `JWT_SECRET`, `GATEWAY_API_KEY`, `POSTGRES_PASSWORD` and the `SEED_*_PASSWORD` variables.
3. `docker compose up -d --build` and put TLS in front of the `frontend` service (port 80).
4. Point the automation at it: `BASE_URL=https://<host> API_URL=https://<host>/api pytest`.
