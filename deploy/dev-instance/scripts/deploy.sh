#!/usr/bin/env bash
# Deploys the images of one commit: ./scripts/deploy.sh <image tag>
# Every step is idempotent, so a failed deploy can be run again.
set -euo pipefail
cd "$(dirname "$0")/.."

tag="${1:?usage: deploy.sh <image tag>}"
./scripts/init-env.sh
sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${tag}/" .env

docker compose pull --quiet
docker compose up -d --wait postgresql redis yhub-valkey minio
docker compose run --rm createbuckets
# Schemas: the collaboration server's, then the backend's
docker compose run --rm --no-deps yhub yarn init-db
docker compose run --rm --no-deps backend python manage.py migrate --noinput
docker compose up -d --remove-orphans --wait --wait-timeout 600

set -a; . ./.env; set +a
docker compose exec -T backend python manage.py createsuperuser \
  --email admin@example.com --password "${SEED_PASSWORD_ADMIN}"

docker image prune -f >/dev/null
docker compose ps --format 'table {{.Service}}\t{{.Image}}\t{{.Status}}'
