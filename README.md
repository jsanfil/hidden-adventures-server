# Hidden Adventures Server

TypeScript backend for the Hidden Adventures rebuild.

## Goals

- relational domain model with PostgreSQL + PostGIS
- hybrid API with clean resources plus workflow and query endpoints
- local-first Docker development
- cheap production deployment on AWS Lightsail
- repeatable staging and deployment baseline for Slice 1 server rollout

## Getting Started

1. Copy `.env.example` to `.env`.
2. Install dependencies with `npm install`.
3. Start the local stack with `docker compose up --build`.
4. Seed the local auth fixtures with `npm run db:seed:local-fixtures`.
5. Run the app locally with `npm run dev` if you want to iterate outside Docker.

The Docker dev app now re-syncs `node_modules` on boot whenever `package.json` or `package-lock.json` changes, which prevents stale named-volume dependencies from leaving the server container up while the app process crashes.

Local development defaults to `AUTH_MODE=local_identity`, which requires bearer auth for all business routes while accepting stable local tokens such as `local:connected_viewer` and `local:new_user`. Production must run with `AUTH_MODE=cognito`.

## Deployment Baseline

Deployment-oriented artifacts now live in `deploy/`:

- `Dockerfile.deploy`: production-style server image that builds TypeScript once and runs `node dist/index.js`
- `deploy/README.md`: image versioning, environment and secrets expectations, rollout and rollback steps, and the staging smoke path
- `deploy/env/*.example`: staging and production runtime variable templates
- `deploy/docker-compose.staging.yml`: minimal single-service compose example for a staging host using an external PostgreSQL database
- `deploy/smoke/staging-smoke.sh`: repeatable smoke checks for the current Slice 1 server surface

Helpful deployment commands:

- `docker build -f Dockerfile.deploy -t hidden-adventures-server:$(git rev-parse --short HEAD) .`
- `npm run db:migrate:dist`
- `BASE_URL=https://your-staging-host npm run smoke:staging`

## Verified Local Commands

- `docker compose up --build -d`
- `npm run db:backup:local`
- `npm run db:seed:local-fixtures`
- `docker compose ps`
- `docker compose exec -T app wget -qO- http://127.0.0.1:3000/`
- `docker compose exec -T app wget -qO- http://127.0.0.1:3000/api/health`
- `docker compose down`

## Testing

- `npm test`
- `npm run check`
- `npm run build`

The current suite covers the shipped Slice 1 read surface, auth bootstrap and handle selection behavior, repository mapping, and request validation. Read-route tests explicitly reject the retired `viewerHandle` query-param pattern.

The locked Slice 1 contract handoff for the iOS thread lives in `docs/slice-1-contract.md`.

## Initial Runtime Shape

- `app`: Fastify-based API service
- `postgres`: PostgreSQL 16 with PostGIS enabled via a repo-local ARM-native image build

## Current Implemented API Surface

- `GET /api/health`
- `GET /api/auth/bootstrap`
- `POST /api/auth/handle`
- `GET /api/feed`
- `GET /api/adventures/:id`
- `GET /api/profiles/:handle`

Notes:

- `GET /api/health` remains public for readiness and Docker health checks.
- All other current `/api` routes require `Authorization: Bearer <token>`.
- In local/test mode (`AUTH_MODE=local_identity`), use stable tokens such as `local:connected_viewer`, `local:non_connected_viewer`, and `local:new_user`.
- In production (`NODE_ENV=production`), the server fails fast unless `AUTH_MODE=cognito`.
- `viewerHandle` is no longer part of the public request contract.
- no other Slice 1 API routes are currently locked or blessed for client integration

## Local Fixture Workflow

- `npm run db:backup:local` creates a timestamped custom-format `pg_dump` outside the repo. The default location is `$HOME/.hidden-adventures/backups/postgres/`, or `LOCAL_BACKUP_DIR` if set.
- `npm run db:seed:local-fixtures` always creates that backup first, then refreshes the managed local fixture users and content.
- The seeded fixtures are:
- `local:fixture_author`: linked author who owns the seeded profile and adventures
- `local:connected_viewer`: linked viewer with an accepted connection to the author
- `local:non_connected_viewer`: linked viewer with no accepted connection to the author
- `local:new_user`: authenticated identity with no linked local user yet, used to exercise bootstrap and handle-selection flows
- The seed refresh also populates representative profiles, public and connections-only adventures, a connection edge, comments, favorites, ratings, and adventure stats.

## Current Data And Identity Snapshot

- Server migration tooling can stage the legacy Mongo archive, transform it into normalized work tables, publish a selected import run into the real `public` tables, and emit reconciliation reports.
- Import run `2` is currently published from the canonical archive.
- Imported legacy profiles are linked locally to Cognito by exact handle with `2598` linked legacy users and `1383` extra Cognito accounts intentionally left unmatched.
- Bulk reconciliation is intentionally handle-first for migration; verified-email matching remains a runtime bootstrap and recovery path.

## Current Priority

- lock contract documentation from the implemented response shapes
- keep the Vitest suite as the authoritative server verification path for Slice 1
- keep the Postman repo current for manual troubleshooting and API exploration
- support the iOS thread as it replaces fixture-backed services with real network integration
- define the first staging, deploy, and rollback baseline

## Migration Tooling

Run the first server-side SQL migration set:

- `npm run db:migrate`

Stage the legacy Mongo archive into the raw migration tables:

- `POSTGRES_HOST=127.0.0.1 npm run migration:stage-archive -- --archive ../hidden-adventures-plan/migration/archives/legacy-mongodb-backup-2026-03-01.archive --report /tmp/ha-stage-report.json`

Transform staged raw rows into normalized work tables:

- `POSTGRES_HOST=127.0.0.1 npm run migration:transform-stage -- --run-id 2 --report /tmp/ha-transform-report.json`

Publish a transformed run into the real `public` application tables and emit a reconciliation report:

- `POSTGRES_HOST=127.0.0.1 npm run migration:publish-run -- --run-id 2 --report /tmp/ha-publish-report.json`

Run the username-first Cognito linking job against a staged import run:

- `POSTGRES_HOST=127.0.0.1 npm run migration:link-cognito -- --input /absolute/path/to/cognito-users.json --run-id 1 --report /tmp/cognito-link-report.json`

Notes:

- the archive staging job creates a new `migration_meta.import_runs` row, loads the raw collection payloads into `migration_stage`, and records collection counts in `migration_meta.import_metrics`
- the transform job currently covers `profiles_raw`, `adventures_raw`, `sidekicks_raw`, `favorites_raw`, and `comments_raw` into the corresponding `migration_work` tables plus import audit rows for skipped or collapsed legacy records
- the publish job currently replaces the data in the `public` application tables from a chosen migration run and writes a reconciliation report comparing work-table counts to published counts
- the linking job expects a Cognito export JSON shaped either as an array of users or an object with a `Users` array
- dry-run is the default; add `--apply` to persist `cognito_subject` links and audit rows
- matching order is existing Cognito subject first, then exact Cognito username to legacy `handle`; bulk sync does not auto-link by email
- in apply mode, the linking job now fails if the number of updated `users_work` rows does not match the number of linkable Cognito users
- read endpoints now resolve the viewer from the authenticated bearer token and use local `users.id` for visibility decisions
- `handle` is the public username shown in the app and used for profile lookup; it is not the authenticated identity key
- `displayName` is the optional friendly profile label and can differ from `handle`
