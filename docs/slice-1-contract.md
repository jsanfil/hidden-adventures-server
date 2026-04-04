# Slice 1 Contract Lock

This document freezes the current Slice 1 contract from the implemented server routes and the Vitest suite in `hidden-adventures-server`.

Vitest is the acceptance source for this contract. The Postman repo stays aligned for manual troubleshooting only.

## Stable Endpoints

### `GET /api/health`

- auth: none
- response: `200` when the app and database are healthy, `503` when the database check fails
- stable top-level fields:
  - `ok`
  - `checks.database.ok`
  - `checks.database.latencyMs` on success
  - `service`
  - `timestamp`

### `GET /api/feed`

- auth: required
- query:
  - `limit`: integer, min `1`, max `50`, default `20`
  - `offset`: integer, min `0`, default `0`
- any extra query param is rejected with `400`
- `viewerHandle` is rejected with `400`
- response: `200`
- stable top-level fields:
  - `items`
  - `paging.limit`
  - `paging.offset`
  - `paging.returned`
- stable feed item fields:
  - `id`
  - `title`
  - `summary`
  - `body`
  - `categorySlug`
  - `visibility`
  - `createdAt`
  - `publishedAt`
  - `location`
  - `author.handle`
  - `author.displayName`
  - `author.homeCity`
  - `author.homeRegion`
  - `primaryMedia`
  - `stats.favoriteCount`
  - `stats.commentCount`
  - `stats.ratingCount`
  - `stats.averageRating`

### `GET /api/adventures/:id`

- auth: required
- params:
  - `id`: UUID
- any query param is rejected with `400`
- `viewerHandle` is rejected with `400`
- response:
  - `200` with `{ item }` when visible to the caller
  - `404` with `{ error: "Adventure not found." }` when missing or not visible
- stable detail-only fields in `item`:
  - everything from the feed item shape
  - `updatedAt`
  - `placeLabel`

### `GET /api/profiles/:handle`

- auth: required
- params:
  - `handle`: non-empty string up to `64` chars
- query:
  - `limit`: integer, min `1`, max `50`, default `20`
  - `offset`: integer, min `0`, default `0`
- any extra query param is rejected with `400`
- `viewerHandle` is rejected with `400`
- response:
  - `200` with `{ profile, adventures, paging }`
  - `404` with `{ error: "Profile not found." }`
- stable `profile` fields:
  - `id`
  - `handle`
  - `displayName`
  - `bio`
  - `homeCity`
  - `homeRegion`
  - `avatar`
  - `cover`
  - `createdAt`
  - `updatedAt`
- stable `adventures` item shape:
  - same as `GET /api/feed`

### `GET /api/me/profile`

- auth: required
- response:
  - `200` with `{ profile }` for the authenticated viewer
  - `401` with `{ error: "Authentication required." }` when no authenticated identity is present
  - `404` with `{ error: "Profile not found." }` when the authenticated viewer has no resolvable local profile row
- stable `profile` fields:
  - same as `GET /api/profiles/:handle`

### `PUT /api/me/profile`

- auth: required
- request body:
  - `displayName`: string or `null`
  - `bio`: string or `null`
  - `homeCity`: string or `null`
  - `homeRegion`: string or `null`
- write behavior:
  - trims all string fields
  - empty strings are normalized to `null`
  - creates the backing `profiles` row if the authenticated viewer does not have one yet
  - does not edit `handle`; public handle creation remains on `POST /api/auth/handle`
- response:
  - `200` with `{ profile }` for the saved viewer profile
  - `401` with `{ error: "Authentication required." }` when no authenticated identity is present
  - `400` when the request body fails validation


### `GET /api/auth/bootstrap`

- auth: required
- requires `Authorization: Bearer <Cognito token>`
- response:
  - `401` with `{ error: "Authentication required." }` when no authenticated identity is present
  - `200` with bootstrap payload when auth succeeds
- stable top-level fields:
  - `accountState`
  - `user`
  - `suggestedHandle`
  - `recoveryEmail`
- stable `accountState` values exercised by Vitest:
  - `linked`
  - `legacy_claimed`
  - `new_user_needs_handle`
  - `manual_recovery_required`

### `POST /api/auth/handle`

- auth: required
- requires `Authorization: Bearer <Cognito token>`
- request body:
  - `handle`: string, trimmed by validation, min `3`, max `64`, regex `^[a-z0-9_]+$` with case-insensitive acceptance
- response:
  - `401` with `{ error: "Authentication required." }` when no authenticated identity is present
  - `400` when the request body fails validation
  - `409` with `{ error: "Handle unavailable." }` when the chosen handle already exists
  - `200` with the same bootstrap-style payload shape as `GET /api/auth/bootstrap`

## Auth And Visibility Rules

- `GET /api/health` is public; all other current `/api` routes require bearer auth.
- Local automation runs with `AUTH_MODE=test_jwt` and deterministic signed test tokens minted from the `test-core` fixture pack.
- Local manual QA runs with `AUTH_MODE=cognito` against a dedicated non-prod Cognito pool and the `qa-rich` fixture pack.
- Production must run with `AUTH_MODE=cognito`.
- Connected-viewer behavior comes only from authenticated auth context; there is no supported handle-based viewer override.
- Invalid bearer tokens are rejected with `401` and `{ error: "Invalid authentication token." }`.
- Missing bearer tokens on protected routes are rejected with `401` and `{ error: "Authentication required." }`.
- Read visibility is currently:
  - authenticated viewers can read `public` adventures
  - an authenticated author can read their own published adventures
  - an authenticated accepted connection can read `connections` visibility adventures
  - non-visible or missing adventures collapse to the same `404`

## Payload Assumptions The iOS Thread May Rely On

- All response objects use camelCase JSON keys.
- Zod validation failures return `400` with `{ error: "Invalid request.", details: [{ path, message }] }`.
- Media objects are either `null` or `{ id, storageKey }`.
- `location` is either `null` or `{ latitude, longitude }`.
- `stats` is always present on adventure payloads. Missing database aggregates are normalized to zeroes.
- `profile.email` is not exposed by `GET /api/profiles/:handle`.
- `user` in auth payloads may be `null` when `accountState` is `new_user_needs_handle`.
- `suggestedHandle` may be `null` or a normalized lowercase underscore-separated string.
- The iOS client should treat `handle` as the public username and `displayName` as optional profile presentation data.

## Intentional Non-Contract Items

- No map-specific endpoint exists yet in this server repo.
- No favorites, comments, ratings, or connections-management write surface is part of this lock.
- Postman request definitions are for manual smoke checks only and are not formal acceptance.

## Remaining Gaps Before Broader Slice 1 Completion

- The iOS app still needs to replace fixture-era `viewerHandle` plumbing with bearer-token-backed auth/bootstrap integration.
- No OpenAPI schema or generated client exists yet; the locked contract currently lives in route code, Vitest, and this handoff document.
