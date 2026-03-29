#!/bin/sh

set -eu

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required for staging smoke checks." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required for staging smoke checks." >&2
  exit 1
fi

BASE_URL="${BASE_URL:-}"
AUTH_TOKEN="${AUTH_TOKEN:-}"
HANDLE_CLAIM_TOKEN="${HANDLE_CLAIM_TOKEN:-}"
HANDLE_TO_CLAIM="${HANDLE_TO_CLAIM:-}"

if [ -z "$BASE_URL" ]; then
  echo "BASE_URL is required, for example https://staging.hidden-adventures.example.com" >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

request() {
  name="$1"
  method="$2"
  path="$3"
  output_file="$4"
  expected_status="$5"
  shift 5

  status_code="$(
    curl -sS \
      -o "$output_file" \
      -w "%{http_code}" \
      -X "$method" \
      "$BASE_URL$path" \
      "$@"
  )"

  if [ "$status_code" != "$expected_status" ]; then
    echo "$name failed: expected HTTP $expected_status, got $status_code" >&2
    cat "$output_file" >&2
    exit 1
  fi

  echo "$name passed ($status_code)"
}

json_value() {
  file_path="$1"
  expression="$2"

  node -e '
    const fs = require("node:fs");
    const [filePath, expression] = process.argv.slice(1);
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const value = expression
      .split(".")
      .reduce((current, part) => {
        if (current == null || part.length === 0) {
          return undefined;
        }

        const arrayMatch = /^([^.[]+)\[(\d+)\]$/.exec(part);
        if (arrayMatch) {
          const [, key, index] = arrayMatch;
          const next = current[key];
          return Array.isArray(next) ? next[Number(index)] : undefined;
        }

        return current[part];
      }, data);

    if (value === undefined || value === null) {
      process.exit(1);
    }

    if (typeof value === "object") {
      process.stdout.write(JSON.stringify(value));
      return;
    }

    process.stdout.write(String(value));
  ' "$file_path" "$expression"
}

root_file="$tmp_dir/root.json"
health_file="$tmp_dir/health.json"
feed_file="$tmp_dir/feed.json"
auth_file="$tmp_dir/auth.json"
detail_file="$tmp_dir/detail.json"
profile_file="$tmp_dir/profile.json"
handle_file="$tmp_dir/handle.json"

request "root readiness" "GET" "/" "$root_file" "200"
json_value "$root_file" "status" >/dev/null

request "api health" "GET" "/api/health" "$health_file" "200"
json_value "$health_file" "ok" >/dev/null

request "feed" "GET" "/api/feed?limit=1&offset=0" "$feed_file" "200"
json_value "$feed_file" "paging.returned" >/dev/null

adventure_id=""
profile_handle=""

if adventure_id="$(json_value "$feed_file" "items[0].id" 2>/dev/null)"; then
  request "adventure detail" "GET" "/api/adventures/$adventure_id" "$detail_file" "200"
  json_value "$detail_file" "item.id" >/dev/null
else
  echo "feed returned no items; skipping adventure detail smoke"
fi

if profile_handle="$(json_value "$feed_file" "items[0].author.handle" 2>/dev/null)"; then
  request "profile detail" "GET" "/api/profiles/$profile_handle?limit=1&offset=0" "$profile_file" "200"
  json_value "$profile_file" "profile.handle" >/dev/null
else
  echo "feed returned no author handle; skipping profile smoke"
fi

if [ -n "$AUTH_TOKEN" ]; then
  request \
    "auth bootstrap" \
    "GET" \
    "/api/auth/bootstrap" \
    "$auth_file" \
    "200" \
    -H "Authorization: Bearer $AUTH_TOKEN"
  json_value "$auth_file" "accountState" >/dev/null
else
  echo "AUTH_TOKEN not set; skipping authenticated smoke"
fi

if [ -n "$HANDLE_CLAIM_TOKEN" ] && [ -n "$HANDLE_TO_CLAIM" ]; then
  request \
    "auth handle claim" \
    "POST" \
    "/api/auth/handle" \
    "$handle_file" \
    "200" \
    -H "Authorization: Bearer $HANDLE_CLAIM_TOKEN" \
    -H "Content-Type: application/json" \
    --data "{\"handle\":\"$HANDLE_TO_CLAIM\"}"
  json_value "$handle_file" "user.handle" >/dev/null
else
  echo "HANDLE_CLAIM_TOKEN or HANDLE_TO_CLAIM not set; skipping handle claim smoke"
fi

echo "staging smoke complete"
