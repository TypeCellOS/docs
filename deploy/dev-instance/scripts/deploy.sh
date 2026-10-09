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

# Demo users: the password is the user name. The realm import sets it on the
# first start only, so set it again for a Keycloak volume that already exists.
for attempt in $(seq 1 30); do
  if docker compose exec -T -e KC_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD}" keycloak sh -c '
      /opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080 \
        --realm master --user admin --password "$KC_ADMIN_PASSWORD" >/dev/null &&
      for user in alice bob carol dave; do
        /opt/keycloak/bin/kcadm.sh set-password -r docs --username "$user" --new-password "$user"
      done'; then
    break
  fi
  [ "${attempt}" = 30 ] && { echo "Keycloak is not ready" >&2; exit 1; }
  sleep 4
done

./scripts/seed.sh

docker image prune -f >/dev/null
docker compose ps --format 'table {{.Service}}\t{{.Image}}\t{{.Status}}'
