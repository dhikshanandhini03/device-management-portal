# Database

PostgreSQL 16 runs in the `db` service (`docker-compose.yml`). The schema is owned by Alembic migrations in
[`backend/alembic/versions`](../backend/alembic/versions) and applied automatically when the backend
container starts (`alembic upgrade head`), followed by the idempotent seed (`python -m app.seed`).

Manual operations:

```bash
docker compose exec backend alembic current
docker compose exec backend alembic upgrade head
docker compose exec db psql -U bellstb -d bellstb -c "\dt"
```

Reset all data: `docker compose down -v && docker compose up -d --build`.

See [docs/architecture.md](../docs/architecture.md#data-model) for the entity diagram and the telemetry
retention strategy.
