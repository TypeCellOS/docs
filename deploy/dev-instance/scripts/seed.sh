#!/usr/bin/env bash
# Replays a recorded document history into the dev instance, as the dev users
# (see seed/seed.mjs). Idempotent: an existing document is kept.
#
#   ./scripts/seed.sh [path to versions JSON]   (default: seed-data/meetingVersions.json)
#   SEED_FORCE=1 ./scripts/seed.sh              writes a new copy
set -euo pipefail
cd "$(dirname "$0")/.."

data="$(realpath "${1:-seed-data/meetingVersions.json}")"
if [ ! -f "${data}" ]; then
  echo "No seed data at ${data}: copy the versions JSON to the server first." >&2
  exit 1
fi

set -a; . ./.env; set +a
users="alice:${SEED_PASSWORD_ALICE},bob:${SEED_PASSWORD_BOB},carol:${SEED_PASSWORD_CAROL},dave:${SEED_PASSWORD_DAVE}"

docker run --rm \
  -v "$(pwd)/seed:/seed:ro" \
  -v "${data}:/data/versions.json:ro" \
  -v docs-seed-modules:/work/node_modules \
  -e DOCS_URL="https://${DOCS_HOST}" \
  -e SEED_USERS="${users}" \
  -e SEED_DATA=/data/versions.json \
  -e SEED_FORCE="${SEED_FORCE:-}" \
  -e SEED_TITLE="${SEED_TITLE:-}" \
  -e SEED_VERSION_GAP_S="${SEED_VERSION_GAP_S:-}" \
  -e SEED_STEP_GAP_MS="${SEED_STEP_GAP_MS:-}" \
  node:24-alpine sh -c '
    cp /seed/package.json /seed/package-lock.json /seed/*.mjs /work/ &&
    cd /work && npm ci --no-audit --no-fund --loglevel=error && node seed.mjs'
