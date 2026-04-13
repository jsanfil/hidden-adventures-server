# Hidden Adventures Server

TypeScript backend for the Hidden Adventures rebuild.

This README is intentionally repo-local and operational. It explains how to run the server, which environments exist, what each script does, and how the legacy MongoDB migration pipeline works. Product planning, feature sequencing, and delivery status live in the sibling `hidden-adventures-plan` repo, not here.

## Contract And Source Of Truth

- API contract: [docs/contract.md](/Users/josephsanfilippo/Documents/projects/hidden-adventures-rebuild/hidden-adventures-server/docs/contract.md)
- Deployment baseline: [deploy/README.md](/Users/josephsanfilippo/Documents/projects/hidden-adventures-rebuild/hidden-adventures-server/deploy/README.md)
- Schema migrations: [db/migrations](/Users/josephsanfilippo/Documents/projects/hidden-adventures-rebuild/hidden-adventures-server/db/migrations)

When route behavior, payload shape, validation, or default behavior changes, update Vitest coverage and `docs/contract.md` in the same change.

## What This Repo Contains

- Fastify API server
- PostgreSQL + PostGIS schema and migrations
- local automation and manual-QA workflows
- fixture packs for disposable automation data
- archive import tooling for legacy MongoDB data
- deployment and smoke-test assets

## Environment Model

This repo uses three explicit environments.

### 1. Automation Testing

- env file: `.env.local.automation`
- database: `hidden_adventures_test`
- auth mode: `test_jwt`
- data model: disposable and fully scripted
- use this for regression testing, fixture seeding, and automated local development

### 2. Manual QA

- env file: `.env.local.manual-qa`
- database: `hidden_adventures_nonprod`
- auth mode: `cognito`
- data model: persistent and forward-migrated
- use this for real manual testing against preserved migrated data
- do not reseed this database from fixture packs

### 3. Production

- env file: `.env.prod`
- database: `hidden_adventures_prod`
- auth mode: `cognito`
- data model: future persistent production environment
- use this only with explicit production commands

### Important Safety Rule

The repo-root `.env` file is intentionally blanked out. It is a fail-fast trap, not a working environment. If a script accidentally falls back to `.env`, it should fail instead of silently writing to the wrong database, Cognito pool, or S3 bucket.

## Prerequisites

- Node.js 22+
- Docker Desktop
- npm

Install dependencies:

```sh
npm install
```

Start the local Docker stack:

```sh
docker compose up --build -d
```

## Quick Start

### Automation Testing Setup

Create the automation database:

```sh
npm run db:create:test
```

Run schema migrations:

```sh
npm run db:migrate:test
```

Seed the disposable `test-core` dataset:

```sh
npm run fixtures:validate:test -- --pack test-core
npm run fixtures:seed-db:test -- --pack test-core
```

Run the test suite:

```sh
npm test
```

Run the full disposable regression loop:

```sh
npm run test:regression
```

Or force a clean rebuild of the test database first:

```sh
npm run test:regression:clean
```

Start the server in automation mode:

```sh
npm run dev:automation
```

### Manual QA Setup

Create the manual-QA database once if needed:

```sh
npm run db:create:qa
```

Run schema migrations against the persistent manual-QA database:

```sh
npm run db:migrate:qa
```

Start the server in manual-QA mode:

```sh
npm run dev:manual-qa
```

Important:

- `hidden_adventures_nonprod` is meant to be preserved
- do not run fixture reseed workflows against manual QA
- manual QA should move forward by SQL migrations and legacy-data import/publish workflows only

## Script Reference

### Server Runtime

- `npm run dev:automation`
  Runs the server with `.env.local.automation`

- `npm run dev:manual-qa`
  Runs the server with `.env.local.manual-qa`

- `npm run build`
  Compiles TypeScript to `dist/`

- `npm start`
  Runs `dist/index.js`

- `npm run check`
  Runs TypeScript typechecking without emitting files

- `npm test`
  Runs the Vitest suite

### Database Lifecycle

- `npm run db:create:test`
  Creates `hidden_adventures_test` if missing

- `npm run db:migrate:test`
  Applies all pending SQL migrations to `hidden_adventures_test`

- `npm run db:reset:test`
  Drops and recreates `hidden_adventures_test`

- `npm run db:create:qa`
  Creates `hidden_adventures_nonprod` if missing

- `npm run db:migrate:qa`
  Applies all pending SQL migrations to `hidden_adventures_nonprod`

- `npm run db:migrate:prod`
  Applies all pending SQL migrations to `hidden_adventures_prod` using `.env.prod`

Notes:

- there is no `db:reset:qa`
- manual QA is intentionally not a disposable reset/reseed environment
- there is no generic “safe” `db:migrate` alias for local workflows; use the explicit environment-specific commands

### Backups

- `npm run db:backup:test`
  Backs up `hidden_adventures_test`

- `npm run db:backup:qa`
  Backs up `hidden_adventures_nonprod`

- `npm run db:backup:prod`
  Backs up `hidden_adventures_prod`

Backup files include the active database name in the output filename.

### Fixture Workflows

These scripts are for disposable automation data, not manual QA.

- `npm run fixtures:validate:test -- --pack test-core`
  Validates the `test-core` fixture pack against the automation environment

- `npm run fixtures:seed-db:test -- --pack test-core`
  Replaces the contents of the public app tables in `hidden_adventures_test` with the `test-core` fixture pack

- `npm run db:seed:local-fixtures:test`
  Seeds the older local fixture helper path into the automation environment only

- `npm run fixtures:mint-test-token -- --pack test-core --persona <persona-key>`
  Mints a deterministic JWT for automation/local testing

Important:

- fixture seed scripts are destructive
- they delete and recreate public app data in the target database
- they should only be used against `hidden_adventures_test`

### Legacy Migration Pipeline

These scripts are for rebuilding an environment from the legacy MongoDB archive and related Cognito exports.

- `npm run migration:stage-archive`
  Stages raw archive documents into `migration_stage.*`

- `npm run migration:transform-stage`
  Converts staged legacy data into normalized `migration_work.*` rows and writes a report

- `npm run migration:publish-run`
  Replaces the public application tables from one transformed import run and writes a reconciliation report

- `npm run migration:export-cognito`
  Exports Cognito users to a local backup JSON file

- `npm run migration:link-cognito`
  Links imported legacy users to Cognito users in the work tables

- `npm run migration:namespace-media-assets`
  Rewrites/normalizes legacy media storage key namespaces

- `npm run migration:clear-missing-profile-media`
  Clears broken/missing profile media references

## Fixture Packs

Fixture manifests live under [fixtures/packs](/Users/josephsanfilippo/Documents/projects/hidden-adventures-rebuild/hidden-adventures-server/fixtures/packs).

Current packs:

- `test-core`
  Deterministic automation dataset for `hidden_adventures_test`

- `qa-rich`
  Rich non-production fixture dataset retained for disposable or exploratory use, but not part of the normal persistent manual-QA workflow

Even though `qa-rich` still exists in the repo, the normal manual-QA environment is the persisted `hidden_adventures_nonprod` database, not a fixture-reseeded copy.

## Legacy Import Workflow

Use the migration pipeline when you need to build an environment from the archived MongoDB data rather than fixture packs.

### Step 1: Export Cognito Users

```sh
npm run migration:export-cognito
```

The export is written outside git, typically under:

```text
~/.hidden-adventures/backups/cognito/
```

### Step 2: Stage The MongoDB Archive

Example:

```sh
POSTGRES_HOST=127.0.0.1 \
npm run migration:stage-archive -- \
  --archive ../hidden-adventures-plan/migration/archives/legacy-mongodb-backup-2026-03-01.archive \
  --report /tmp/ha-stage-report.json
```

This creates a new `migration_meta.import_runs` row and loads raw collections into `migration_stage`.

### Step 3: Transform Staged Data

Example:

```sh
POSTGRES_HOST=127.0.0.1 \
npm run migration:transform-stage -- \
  --run-id 2 \
  --report /tmp/ha-transform-report.json
```

This reads:

- `migration_stage.profiles_raw`
- `migration_stage.adventures_raw`
- `migration_stage.sidekicks_raw`
- `migration_stage.favorites_raw`
- `migration_stage.comments_raw`

and writes normalized work rows to `migration_work.*`.

### Step 4: Link Cognito Users

Example:

```sh
POSTGRES_HOST=127.0.0.1 \
npm run migration:link-cognito -- \
  --input /absolute/path/to/cognito-users.json \
  --run-id 2 \
  --report /tmp/ha-cognito-link-report.json
```

Notes:

- dry-run is the default
- add `--apply` to persist `cognito_subject` links in the work tables

### Step 5: Publish The Run

Example:

```sh
POSTGRES_HOST=127.0.0.1 \
npm run migration:publish-run -- \
  --run-id 2 \
  --report /tmp/ha-publish-report.json
```

This replaces the public application tables from the chosen import run and writes a publish report comparing work-table counts to published counts.

Expected published counts after the canonical rebuild:

- `users`: `2598`
- `profiles`: `2598`
- `adventures`: `352`
- `connections`: `1004`
- `adventure_favorites`: `1869`
- `adventure_comments`: `140`
- `media_assets`: `1839`
- `adventure_media`: `352`
- `adventure_stats`: `352`


## Recommended Environment Workflows

### Automation

Use when:

- running Vitest
- checking request/response contract behavior
- seeding known deterministic users and adventures
- exercising auth with local signed test tokens

Recommended flow:

```sh
npm run db:create:test
npm run db:migrate:test
npm run fixtures:validate:test -- --pack test-core
npm run fixtures:seed-db:test -- --pack test-core
npm test
```

### Manual QA

Use when:

- manually testing the app against preserved migrated data
- validating real profile/adventure behavior on a fuller dataset
- checking Cognito-backed login flows in non-production

Recommended flow:

```sh
npm run db:backup:qa
npm run db:migrate:qa
npm run dev:manual-qa
```

Do not:

- run fixture reseeds
- wipe rows casually
- treat `hidden_adventures_nonprod` as disposable

### Production Bootstrap

When the production environment is created later, the intended model is:

1. use `.env.prod`
2. create or point at `hidden_adventures_prod`
3. run schema migrations
4. stage/transform/publish the legacy archive into `hidden_adventures_prod`
5. from that point on, move forward with ordinary SQL migrations only

## Current API Surface

For the current implemented contract, see [docs/contract.md](/Users/josephsanfilippo/Documents/projects/hidden-adventures-rebuild/hidden-adventures-server/docs/contract.md).

At a high level, the current server includes:

- health
- auth bootstrap and handle claim
- feed
- adventure detail and ordered media
- authenticated media delivery
- profile read/update
- sidekick discovery, search, and management

All business routes except `GET /api/health` require bearer auth.

## Local Development Notes

- The Docker dev stack uses PostgreSQL 16 with PostGIS.
- The app process reads env from the explicit script-provided env file, not from planning docs.
- The root `.env` file should not be used for local work.
- `AUTH_MODE=test_jwt` is the automation path.
- `AUTH_MODE=cognito` is required for manual QA and production.

## Deployment Notes

Deployment-oriented assets live under [deploy](/Users/josephsanfilippo/Documents/projects/hidden-adventures-rebuild/hidden-adventures-server/deploy).

Useful entrypoints:

- [deploy/README.md](/Users/josephsanfilippo/Documents/projects/hidden-adventures-rebuild/hidden-adventures-server/deploy/README.md)
- [Dockerfile.deploy](/Users/josephsanfilippo/Documents/projects/hidden-adventures-rebuild/hidden-adventures-server/Dockerfile.deploy)
- [deploy/env/production.env.example](/Users/josephsanfilippo/Documents/projects/hidden-adventures-rebuild/hidden-adventures-server/deploy/env/production.env.example)
- [deploy/smoke/staging-smoke.sh](/Users/josephsanfilippo/Documents/projects/hidden-adventures-rebuild/hidden-adventures-server/deploy/smoke/staging-smoke.sh)

## Verification

Common checks:

```sh
npm run check
npm test
npm run build
docker compose ps
```

## Repo Boundaries

This repo is responsible for:

- backend code
- migrations
- local environments and scripts
- fixture packs
- legacy import tooling
- deployment assets

This repo is not the source of truth for:

- product roadmap
- feature sequencing
- milestone tracking
- cross-repo planning status

Those live in `hidden-adventures-plan`.
