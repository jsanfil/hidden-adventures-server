# Hidden Adventures Server Agent Guide

This file is a repo-local operating guide for AI coding agents working in `hidden-adventures-server`. Use it to choose the safe default workflow, avoid the wrong environment, and know which docs are the source of truth before changing code or running scripts.

## Start Here

- Read [README.md](/Users/josephsanfilippo/Documents/projects/hidden-adventures-rebuild/hidden-adventures-server/README.md) for environment setup, script behavior, fixture workflows, and the legacy migration pipeline.
- Read [docs/contract.md](/Users/josephsanfilippo/Documents/projects/hidden-adventures-rebuild/hidden-adventures-server/docs/contract.md) before changing route behavior, validation, response shape, or auth-facing behavior.
- Read [deploy/README.md](/Users/josephsanfilippo/Documents/projects/hidden-adventures-rebuild/hidden-adventures-server/deploy/README.md) only when working on deploy, smoke-test, or production-operational behavior.

## Working Defaults

- Default local development mode is automation testing, not manual QA.
- Prefer `npm run dev:automation` for route work, scripted verification, and disposable local debugging.
- Prefer the automation database (`hidden_adventures_test`) plus the explicit automation scripts for reseedable work.
- Prefer `npm test` and `npm run check` as the baseline verification commands before claiming a change is complete.
- When you need a focused Vitest run outside the canned scripts, load `.env.local.automation` explicitly instead of relying on implicit defaults.

## Environment Model

### Automation Testing

- Env file: `.env.local.automation`
- Database: `hidden_adventures_test`
- Auth mode: `test_jwt`
- Use for disposable testing, regression runs, fixture seeding, and normal local development.

### Manual QA

- Env file: `.env.local.manual-qa`
- Database: `hidden_adventures_nonprod`
- Auth mode: `cognito`
- Use for persistent non-prod manual testing against forward-migrated data.

### Production

- Env file: `.env.prod`
- Database: `hidden_adventures_prod`
- Auth mode: `cognito`
- Use only for explicitly intended production commands.

## Safety Rules

- The repo-root `.env` file is intentionally blank. Treat it as a fail-fast trap, not a usable default environment.
- Do not reseed, reset, or otherwise treat manual QA as disposable. `hidden_adventures_nonprod` is persistent and should move forward by migrations and migration-pipeline workflows only.
- Fixture seed scripts are destructive and automation-only. Do not point them at manual QA or production.
- Do not improvise generic local migration commands when an environment-specific script already exists. Prefer `db:migrate:test`, `db:migrate:qa`, or `db:migrate:prod` as appropriate.
- Production-affecting commands require explicit intent. Do not use `.env.prod` or production scripts casually.

## Change Rules

- If route behavior, payload shape, validation, or default behavior changes, update Vitest coverage and [docs/contract.md](/Users/josephsanfilippo/Documents/projects/hidden-adventures-rebuild/hidden-adventures-server/docs/contract.md) in the same change.
- Follow the existing server layout instead of inventing a new structure mid-change.
- Keep environment selection explicit. This repo distinguishes sharply between automation, manual QA, and production workflows.
- Treat the Vitest suite as the acceptance source for the implemented API contract.

## Verification Checklist

- Run `npm run check` when changing TypeScript code or imports.
- Run `npm test` for normal code changes.
- Use targeted environment-specific database or fixture commands only when the task actually touches migrations, fixture packs, or migration scripts.
- Before reporting completion, confirm the exact commands you ran and that they succeeded.

## Repo Map

- `src/features`: domain logic grouped by feature such as adventures, auth, media, profiles, sidekicks, and fixtures.
- `src/routes`: Fastify route registration and HTTP-facing behavior.
- `src/scripts`: operational scripts for migrations, backups, fixtures, Cognito sync, and archive import/publish flows.
- `db/migrations`: SQL schema migrations.
- `tests`: Vitest coverage for routes, services, auth flows, and local script behavior.

## Common Commands

- `npm run dev:automation`
- `npm run dev:manual-qa`
- `npm run check`
- `npm test`
- `npm run test:regression`
- `npm run db:migrate:test`
- `npm run db:migrate:qa`

When in doubt, prefer the documented automation workflow in [README.md](/Users/josephsanfilippo/Documents/projects/hidden-adventures-rebuild/hidden-adventures-server/README.md) and avoid any command that could mutate persistent data unless the task clearly requires it.
