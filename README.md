# Hidden Adventures Server

TypeScript backend for the Hidden Adventures rebuild.

## Goals

- relational domain model with PostgreSQL + PostGIS
- hybrid API with clean resources plus workflow/query endpoints
- local-first Docker development
- cheap production deployment on AWS Lightsail

## Getting Started

1. Copy `.env.example` to `.env`.
2. Install dependencies with `npm install`.
3. Start the local stack with `docker compose up --build`.
4. Run the app locally with `npm run dev` if you want to iterate outside Docker.

## Verified Local Commands

- `docker compose up --build -d`
- `docker compose ps`
- `docker compose exec -T app wget -qO- http://127.0.0.1:3000/`
- `docker compose exec -T app wget -qO- http://127.0.0.1:3000/api/health`
- `docker compose down`

## Testing

- `npm test`
- `npm run check`
- `npm run build`

The current suite covers the shipped read-only API surface and repository mapping behavior. Going forward, new server features should add or update tests in the same change.

## Initial Runtime Shape

- `app`: Fastify-based API service
- `postgres`: PostgreSQL 16 with PostGIS enabled via a repo-local ARM-native image build

## Near-Term Next Steps

- add route modules for slice 1
- add database access layer
- add auth bootstrap against Cognito
- document staging and production deployment

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
- matching order is exact Cognito username first, then unique email, then manual review
- in apply mode, the linking job now fails if the number of updated `users_work` rows does not match the number of linkable Cognito users
- the new read endpoints currently accept optional `viewerHandle` query params as a temporary development stand-in for real authenticated viewer identity
