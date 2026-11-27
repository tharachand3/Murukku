# Docker deployment

Live URL: (add here when deployed)

## Run locally

From the repository root, start the database, API, and web app:

```sh
docker compose up -d --build
docker compose ps
```

Open [http://localhost:8080](http://localhost:8080). The API applies Prisma
migrations before starting. `SEED_ON_START` defaults to `true`, so the
idempotent demo seed runs on startup.

All six demo accounts use password `Demo@123`:

| Role | Email |
| --- | --- |
| Admin | admin@demo.com |
| Production | production@demo.com |
| Salesman A | salesman.a@demo.com |
| Salesman B | salesman.b@demo.com |
| Accountant | accountant@demo.com |
| Owner | owner@demo.com |

To check the running stack, use `npm run docker:smoke`. To follow backend and
frontend logs, use `npm run docker:logs`.

## Deploy on a Linux VM

1. Install Docker Engine and the Docker Compose plugin using Docker's
   instructions for your Linux distribution.
2. Clone the repository and enter its root directory:

   ```sh
   git clone https://github.com/tharachand3/Murukku.git
   cd Murukku
   cp .env.example .env
   ```

3. Generate a private JWT secret and put the output in `.env` as `JWT_SECRET`:

   ```sh
   openssl rand -base64 48
   ```

   Do not commit `.env` or share the generated secret. The Compose default is
   demo-only and is not suitable for a real deployment.
4. Start the stack:

   ```sh
   docker compose up -d --build
   docker compose logs -f backend
   ```

5. Once the first seed has run, set `SEED_ON_START=false` in `.env` if entering
   real data, then recreate the backend with `docker compose up -d backend`.
   This prevents demo records from being re-applied on later restarts.
6. Open only the chosen web port (8080 by default) in the firewall. The backend
   is not published to the host. The database service currently maps port 5433
   for local development; before deploying, remove the `ports` block under
   `db` in `docker-compose.yml`. Containers continue to reach the database over
   the private Compose network at `db:5432`. Never expose PostgreSQL publicly.

## HTTPS

HTTPS termination is not included in Compose. Put a host-installed reverse
proxy such as Caddy or nginx in front of the frontend container and configure
it with a certificate for your domain. Keep the proxy's upstream pointed at
the frontend's HTTP port, allow public firewall traffic only on 80/443, and
ensure port 8080 is not publicly reachable. Do not publish the backend or
database ports.

## Backups and restore

Create a plain SQL backup on the VM:

```sh
docker compose exec -T db pg_dump -U oda -d oda > murukku-backup.sql
```

Restore into an empty database volume:

```sh
docker compose exec -T db psql -U oda -d oda < murukku-backup.sql
```

Protect backup files as production data and verify backups by restoring them
to a separate test environment.

## Reset demo data

This deletes the database volume and all data stored in it. Use only when the
data is disposable demo data:

```sh
docker compose down -v
docker compose up -d --build
```

The backend runs with `NODE_ENV=production`, so `backend/scripts/reset-db.js`
refuses to reset the database by design. Do not use `down -v` on a live
deployment.

## Update

From the repository root:

```sh
git pull
docker compose up -d --build
```

Database migrations run automatically before the backend starts.

## Troubleshooting

- **Port 8080 is in use:** set `WEB_PORT` to an available port in `.env`, then
  run `docker compose up -d --build` again.
- **Backend is unhealthy:** inspect `docker compose logs backend db`. Confirm
  the database is healthy and allow startup migrations to finish. The API
  health check also requires a working database connection.
- **Database password changed after the volume was created:** PostgreSQL's
  `POSTGRES_PASSWORD` only initializes a new volume; changing it later does not
  change the existing database role. Keep the database credentials and
  `DATABASE_URL` consistent, and do not delete the volume to troubleshoot a
  live database.
