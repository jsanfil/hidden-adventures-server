# Hidden Adventures Deployment Baseline

This is the first repeatable deployment and staging baseline for the Slice 1 server. It is intentionally conservative:

- build one immutable server image
- run schema migrations before traffic shifts
- deploy the same image to staging and production
- verify with a small smoke path against the currently shipped API surface
- prefer rollback by image digest unless a schema change requires a forward fix

## Deployment Artifacts

- `Dockerfile.deploy`: production-style image build
- `deploy/docker-compose.staging.yml`: example single-service staging runtime
- `deploy/env/staging.env.example`: staging runtime template
- `deploy/env/production.env.example`: production runtime template
- `deploy/smoke/staging-smoke.sh`: smoke script for root, health, feed, detail, profile, and optional auth checks

## Image Versioning Baseline

Use immutable image references for every deploy.

Required tags:

- `hidden-adventures-server:git-<full-sha>`
- `hidden-adventures-server:staging-<yyyymmddhhmm>-<short-sha>` for human-readable staging promotion logs

Recommended release metadata to capture in the deploy record:

- git commit SHA
- pushed image digest
- migration result
- operator
- environment
- smoke result and timestamp

Rules:

- deploy staging and production by digest, not by a mutable tag alone
- treat `staging` or `production` tags as convenience aliases only
- never rebuild an existing tag for a new commit
- if a deployment fails, keep the failing digest recorded so rollback remains explicit

Example build and tag flow:

```sh
GIT_SHA="$(git rev-parse HEAD)"
SHORT_SHA="$(git rev-parse --short HEAD)"
STAMP="$(date -u +%Y%m%d%H%M)"

docker build \
  -f Dockerfile.deploy \
  -t hidden-adventures-server:git-"$GIT_SHA" \
  -t hidden-adventures-server:staging-"$STAMP"-"$SHORT_SHA" \
  .
```

## Environment And Secrets Baseline

The server currently reads runtime configuration from process env only. Keep secrets out of the repo and inject them at deploy time.

Current runtime variables:

| Variable | Required | Secret | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | yes | no | `production` for staging and production |
| `PORT` | yes | no | container listens on this port |
| `LOG_LEVEL` | yes | no | `info` in staging, `warn` or `info` in production |
| `POSTGRES_HOST` | yes | no | hostname for the staging or production database |
| `POSTGRES_PORT` | yes | no | defaults to `5432` |
| `POSTGRES_DB` | yes | no | application database name |
| `POSTGRES_USER` | yes | usually no | application database user |
| `POSTGRES_PASSWORD` | yes | yes | inject from secret store only |
| `COGNITO_USER_POOL_ID` | optional for public reads | no | required if auth endpoints are expected to work |
| `COGNITO_CLIENT_ID` | optional for public reads | no | required if auth endpoints are expected to work |
| `AWS_REGION` | yes if Cognito is enabled | no | defaults to `us-west-2` in code |
| `S3_BUCKET` | optional right now | no | reserved for later media/storage integration |

Storage guidance:

- keep committed files at `deploy/env/*.example` as templates only
- store real env values in the host secret manager or deployment platform secret store
- do not bake `.env` files into images
- rotate `POSTGRES_PASSWORD` outside the image lifecycle

Practical split for the current baseline:

- non-secret config can live in the staging or production service definition
- `POSTGRES_PASSWORD` should come from a secret manager or container-platform secret injection
- Cognito IDs are not credentials, but until infra is more formalized it is fine to manage them alongside other runtime config

## Rollout Baseline

This baseline assumes one server container and one external PostgreSQL database per environment.

1. Build and push an immutable image from `Dockerfile.deploy`.
2. Record the git SHA and resulting image digest in the deploy log.
3. Update the staging environment definition to reference the new image digest.
4. Run migrations against the target database before shifting traffic:

```sh
docker run --rm \
  --env-file deploy/env/staging.env \
  hidden-adventures-server:git-<full-sha> \
  npm run db:migrate:dist
```

5. Start the new application container with the same image digest and runtime env.
6. Run the staging smoke flow.
7. If smoke passes, mark that digest as the current staging baseline.

If the environment is VM-based and Compose-backed, `deploy/docker-compose.staging.yml` can be used as the baseline runtime definition after replacing `deploy/env/staging.env.example` with a real untracked `deploy/env/staging.env`.

## Rollback Baseline

Rollback order:

1. Re-deploy the last known good image digest.
2. Re-run the smoke script against staging.
3. Only consider a database rollback if a migration was destructive and known to be reversible.

Guardrails:

- default to application-image rollback only
- treat schema migrations as forward-only unless a specific down migration exists and has been tested
- if a bad migration has already been applied, pause promotion and prepare a forward repair rather than improvising a database rollback in production

## Staging Smoke Path

Default smoke path is read-only:

1. `GET /`
2. `GET /api/health`
3. `GET /api/feed?limit=1&offset=0`
4. If feed returns an item, `GET /api/adventures/:id`
5. If feed returns an author handle, `GET /api/profiles/:handle?limit=1&offset=0`

Optional auth extension:

- if `AUTH_TOKEN` is provided, the smoke script also calls `GET /api/auth/bootstrap`
- if `HANDLE_CLAIM_TOKEN` and `HANDLE_TO_CLAIM` are both provided, the smoke script can attempt `POST /api/auth/handle`

The write-path check is opt-in because it mutates user state and requires a dedicated disposable staging account.

Run it with:

```sh
BASE_URL=https://staging.hidden-adventures.example.com \
sh deploy/smoke/staging-smoke.sh
```

## Current Hosting Assumptions

This baseline is written around the assumptions already implied by the repo:

- app image can run on AWS Lightsail, ECS, a small VM, or another single-container host
- PostgreSQL lives outside the app container
- a deploy operator can run one-off migration commands with the same image that serves traffic
- there is one staging environment used to validate image digests before production promotion

If those assumptions change, update this baseline before adding more operational automation.
