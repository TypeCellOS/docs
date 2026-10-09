#!/usr/bin/env bash
# Puts the sample document on the instance: "07/10 meeting agenda (sample)",
# owned by alice, with 15 named versions by alice, bob, carol and dave.
# deploy.sh runs it on every deploy. It only adds what is missing, so it
# changes nothing when the document is complete, and it takes well under a
# minute: the history is built offline with its past timestamps, then stored
# in yhub.
#
#   ./scripts/seed.sh [path to versions JSON]   (default: seed-data/meetingVersions.json)
set -euo pipefail
cd "$(dirname "$0")/.."

data="${1:-seed-data/meetingVersions.json}"
if [ ! -f "${data}" ]; then
  echo "seed: no ${data} on the server, so no sample document" >&2
  exit 0
fi
data="$(realpath "${data}")"
out="$(pwd)/seed-data/out"
rm -rf "${out}" && mkdir -p "${out}" && chmod 777 "${out}"

host="$(grep '^DOCS_HOST=' .env | cut -d= -f2)"

# 1. Sign in as the demo users, create the document, build its history
docker run --rm \
  -v "$(pwd)/seed:/seed:ro" \
  -v "${data}:/data/versions.json:ro" \
  -v "${out}:/out" \
  -v docs-seed-npm:/root/.npm \
  -e DOCS_URL="https://${host}" \
  -e SEED_USERS="alice:alice,bob:bob,carol:carol,dave:dave" \
  -e SEED_DATA=/data/versions.json \
  -e OUT=/out/history.bin \
  node:24-alpine sh -c '
    mkdir -p /work && cp /seed/package.json /seed/package-lock.json /seed/*.mjs /work/ &&
    cd /work && npm ci --prefer-offline --no-audit --no-fund --loglevel=error && node seed.mjs'

docid="$(sed -E 's/.*"docid":"([^"]+)".*/\1/' "${out}/history.bin.json")"
from_ms="$(sed -E 's/.*"accessesFrom":([0-9]+).*/\1/' "${out}/history.bin.json")"

# 2. Users only see the history after the date of their access: date the
#    accesses before the recorded meeting.
docker compose exec -T backend python manage.py shell -c "
import datetime
from core.models import DocumentAccess
DocumentAccess.objects.filter(document_id='${docid}').update(
    created_at=datetime.datetime.fromtimestamp(${from_ms} / 1000, datetime.timezone.utc))
"

# 3. Store the history in yhub
docker compose run --rm --no-deps \
  -v "$(pwd)/seed:/seed:ro" -v "${out}:/out:ro" \
  yhub node /seed/import.mjs /out/history.bin

echo "seed: sample document at $(sed -E 's/.*"url":"([^"]+)".*/\1/' "${out}/history.bin.json")"
