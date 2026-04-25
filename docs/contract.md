# Server Contract

This document describes the current implemented API contract for `hidden-adventures-server`, derived from the route code and the Vitest suite.

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
  - `latitude`: optional number, min `-90`, max `90`
  - `longitude`: optional number, min `-180`, max `180`
  - `radiusMiles`: optional number, min `1`, max `100`, default `25`
  - `sort`: optional enum `recent | distance`
  - `latitude` and `longitude` must be provided together
  - `sort=distance` requires `latitude` and `longitude`
- any extra query param is rejected with `400`
- `viewerHandle` is rejected with `400`
- response: `200`
- default behavior:
  - without `latitude` and `longitude`, the feed returns the standard visibility-filtered recent feed
  - with geo scope and omitted `sort`, the feed filters by `radiusMiles` and then sorts by recency
  - with geo scope and `sort=distance`, the feed filters by `radiusMiles` and then sorts by nearest first
- stable top-level fields:
  - `scope` when geo filtering is active
  - `items`
  - `paging.limit`
  - `paging.offset`
  - `paging.returned`
- stable `scope` fields when present:
  - `center.latitude`
  - `center.longitude`
  - `radiusMiles`
- stable feed item fields:
  - `id`
  - `title`
  - `description`
  - `categorySlug`
    - allowed values: `viewpoints`, `trails`, `water_spots`, `food_drink`, `abandoned_places`, `caves`, `nature_escapes`, `roadside_stops`
  - `visibility`
  - `createdAt`
  - `publishedAt`
  - `location`
  - `placeLabel`
  - `author.handle`
  - `author.displayName`
  - `author.homeCity`
  - `author.homeRegion`
  - `primaryMedia`
  - `stats.favoriteCount`
  - `stats.commentCount`
  - `stats.ratingCount`
  - `stats.averageRating`
  - `distanceMiles` when geo filtering is active

### `GET /api/discover/home`

- auth: required
- any query param is rejected with `400`
- response:
  - `200` with `{ modules }`
- returns the full canonical Discover home module set in server-owned order
- stable top-level fields:
  - `modules`
- stable `modules[]` fields:
  - `id`
  - `type`
  - `title`
  - `items`
- currently implemented module ids and types:
  - `explore-adventurers` with `type=adventurers`
  - `popular-adventures` with `type=adventures`
- stable Discover adventurer fields:
  - `id`
  - `handle`
  - `displayName`
  - `homeCity`
  - `homeRegion`
  - `avatar`
  - `previewMedia`
  - `publicAdventureCount`
  - `topCategorySlugs`
- Discover adventurers include only authors with at least one `public` + `published` adventure
- `Explore Adventurers` ordering:
  - public adventure count descending
  - latest public published adventure descending
  - stable id tie-break
- `previewMedia` is the primary media from the adventurer's most recent public published adventure when present
- `topCategorySlugs` contains the top `1-2` canonical category slugs across the adventurer's public published adventures
- `Popular Adventures` item shape:
  - same as `GET /api/feed`
- `Popular Adventures` ordering:
  - favorite count descending
  - comment count descending
  - average rating descending
  - publish recency descending
  - stable id tie-break

### `GET /api/discover/search`

- auth: required
- query:
  - `q`: non-empty trimmed string
  - `limit`: integer, min `1`, max `50`, default `20`
  - `offset`: integer, min `0`, default `0`
- any extra query param is rejected with `400`
- `viewerHandle` is rejected with `400`
- response:
  - `200` with `{ query, people, adventures }`
- stable top-level fields:
  - `query`
  - `people.items`
  - `people.paging.limit`
  - `people.paging.offset`
  - `people.paging.returned`
  - `adventures.items`
  - `adventures.paging.limit`
  - `adventures.paging.offset`
  - `adventures.paging.returned`
- `people.items` shape:
  - same as Discover adventurer shape from `GET /api/discover/home`
- `adventures.items` shape:
  - same as `GET /api/feed`
- `People` search matches:
  - `handle`
  - `displayName`
- `People` result ordering:
  - exact handle match
  - exact display name match
  - handle prefix match
  - display name prefix match
  - same adventurer ranking used by `Explore Adventurers`
- `Adventures` search matches:
  - `title`
  - `placeLabel`
- `Adventures` result ordering:
  - exact title match
  - exact place label match
  - title prefix match
  - place label prefix match
  - publish recency descending
  - stable id tie-break
- Discover search is text search only:
  - no geography expansion
  - no description matching in the current implementation

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

### `GET /api/adventures/:id/media`

- auth: required
- params:
  - `id`: UUID
- any query param is rejected with `400`
- response:
  - `200` with `{ items }` when the adventure is visible to the caller
  - `404` with `{ error: "Adventure not found." }` when missing or not visible
- stable media item fields:
  - `id`
  - `sortOrder`
  - `isPrimary`
  - `width`
  - `height`

### `GET /api/media/:id`

- auth: required
- params:
  - `id`: UUID
- response:
  - `200` with image bytes when the media belongs to a visible published adventure or is linked as a profile avatar or cover
  - `304` when `If-None-Match` matches the current ETag
  - `404` with `{ error: "Media not found." }` when missing or not visible
  - `503` with `{ error: "Media delivery is unavailable." }` when S3 delivery is not configured
- stable headers:
  - `Content-Type`
  - `Cache-Control`
  - `ETag`
  - `Content-Length`

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

### `GET /api/me/sidekicks`

- auth: required
- query:
  - `limit`: integer, min `1`, max `50`, default `20`
  - `offset`: integer, min `0`, default `0`
- any extra query param is rejected with `400`
- response:
  - `200` with `{ items, paging }`
- returns only outbound sidekick grants from the authenticated viewer

### `GET /api/sidekicks/discover`

- auth: required
- query:
  - `limit`: integer, min `1`, max `50`, default `20`
  - `offset`: integer, min `0`, default `0`
- any extra query param is rejected with `400`
- response:
  - `200` with `{ items, paging }`
- ordered by signup date descending and excludes the authenticated viewer

### `GET /api/sidekicks/search`

- auth: required
- query:
  - `q`: non-empty trimmed string
  - `limit`: integer, min `1`, max `50`, default `20`
  - `offset`: integer, min `0`, default `0`
- any extra query param is rejected with `400`
- response:
  - `200` with `{ items, paging, query }`
- matches `handle`, `displayName`, `homeCity`, and `homeRegion`
- excludes the authenticated viewer

### `POST /api/me/sidekicks/:handle`

- auth: required
- params:
  - `handle`: non-empty string up to `64` chars
- response:
  - `200` with `{ item }`
  - `400` when the viewer targets their own handle
  - `404` with `{ error: "Profile not found." }`
- creates or preserves a unilateral sidekick grant from the viewer to the target

### `DELETE /api/me/sidekicks/:handle`

- auth: required
- params:
  - `handle`: non-empty string up to `64` chars
- response:
  - `200` with `{ item }`
  - `400` when the viewer targets their own handle
  - `404` with `{ error: "Profile not found." }`
- removes the viewer's unilateral sidekick grant to the target when present

## Auth And Visibility Rules

- `GET /api/health` is public; all other current `/api` routes require bearer auth.
- Local automation runs with `AUTH_MODE=test_jwt` and deterministic signed test tokens minted from the `test-core` fixture pack.
- Local manual QA runs with `AUTH_MODE=cognito` against the persistent `hidden_adventures_nonprod` database and a dedicated non-prod Cognito pool.
- Production must run with `AUTH_MODE=cognito`.
- Connected-viewer behavior comes only from authenticated auth context; there is no supported handle-based viewer override.
- Invalid bearer tokens are rejected with `401` and `{ error: "Invalid authentication token." }`.
- Missing bearer tokens on protected routes are rejected with `401` and `{ error: "Authentication required." }`.
- Read visibility is currently:
  - authenticated viewers can read `public` adventures
  - an authenticated author can read their own published adventures
  - a viewer can read `sidekicks` adventures only when the author has granted that viewer sidekick access
  - non-visible or missing adventures collapse to the same `404`

## Payload Assumptions The iOS Thread May Rely On

- All response objects use camelCase JSON keys.
- Zod validation failures return `400` with `{ error: "Invalid request.", details: [{ path, message }] }`.
- Media objects are either `null` or `{ id, storageKey }`.
- `primaryMedia.id` is the stable feed-card media reference in Slice 1.
- `primaryMedia.storageKey` may still appear in JSON payloads, but the client must not treat it as a delivery URL or construct S3 requests from it.
- `location` is either `null` or `{ latitude, longitude }`.
- `distanceMiles` is present only for geo-scoped feed reads and is a numeric mile distance rounded to one decimal place.
- Geo-scoped feed reads default to recency ordering when `sort` is omitted.
- `stats` is always present on adventure payloads. Missing database aggregates are normalized to zeroes.
- `profile.email` is not exposed by `GET /api/profiles/:handle`.
- `user` in auth payloads may be `null` when `accountState` is `new_user_needs_handle`.
- `suggestedHandle` may be `null` or a normalized lowercase underscore-separated string.
- The iOS client should treat `handle` as the public username and `displayName` as optional profile presentation data.
- Sidekick list/discovery/search rows use `{ profile, relationship, stats }` and reuse the profile media object shape for `profile.avatar`.
- Discover home is a `modules[]` composition response, not a set of fixed top-level arrays.
- Discover home module `items` are homogeneous per module:
  - `type=adventurers` uses Discover adventurer summaries
  - `type=adventures` uses the standard adventure card shape
- `previewMedia` in Discover adventurer summaries follows the same media object shape as other collection payloads and is not a delivery URL.
- `topCategorySlugs` values come from the canonical adventure category taxonomy:
  - `viewpoints`, `trails`, `water_spots`, `food_drink`, `abandoned_places`, `caves`, `nature_escapes`, `roadside_stops`
- Discover search returns grouped `people` and `adventures` sections in one response, each with its own paging object.

## Intentional Non-Contract Items

- No map-specific endpoint exists yet in this server repo.
- Feed remains single-image even though detail media is now ordered for future carousel work.
- Postman request definitions are for manual smoke checks only and are not formal acceptance.

## Current Documentation Notes

- The iOS app should continue to rely on bearer-auth viewer identity rather than any handle-based viewer override.
- Local automation uses the disposable `hidden_adventures_test` database and may be recreated through migration plus fixture seeding.
- Local manual QA uses the persistent `hidden_adventures_nonprod` database and should be migrated forward only; do not reseed it with fixture packs.
- Future production should use `.env.prod`; the repo-root `.env` file is intentionally blank so accidental fallback fails fast.
- Legacy archive-derived databases should continue to flow through the existing `migration:*` pipeline, which now publishes sidekick grants directly.
- No OpenAPI schema or generated client exists yet; the current contract lives in route code, Vitest, and this document.
