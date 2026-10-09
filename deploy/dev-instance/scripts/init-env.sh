#!/usr/bin/env bash
# Creates the server configuration on the first deploy: the .env file with the
# host names and random secrets, and the two RS256 keys. It never changes
# existing values, so it is safe to run on every deploy.
#
# The host names derive from DEV_DOMAIN (default: <server ip>.sslip.io). To use
# a real domain later, edit DOCS_HOST, KEYCLOAK_HOST and S3_HOST in .env and
# update the OIDC client of the "docs" realm in Keycloak.
set -euo pipefail
cd "$(dirname "$0")/.."

random() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "${1:-40}"; }

if [ ! -f .env ]; then
  domain="${DEV_DOMAIN:-$(curl -fsS4 https://ifconfig.me | tr . -).sslip.io}"
  umask 077
  cat > .env <<ENV
# Server configuration of the dev instance. Secrets: never commit this file.
DOCS_HOST=${domain}
KEYCLOAK_HOST=id.${domain}
S3_HOST=s3.${domain}
BUCKET_NAME=docs-media-storage

# Set by deploy.sh
IMAGE_TAG=dev

DJANGO_SECRET_KEY=$(random 64)
DB_PASSWORD=$(random)
Y_PROVIDER_API_KEY=$(random)
OIDC_CLIENT_SECRET=$(random)
S3_ACCESS_KEY=docs
S3_SECRET_KEY=$(random)
KEYCLOAK_ADMIN_PASSWORD=$(random 24)

# Dev users of the "docs" realm, imported on the first start of Keycloak.
SEED_PASSWORD_ADMIN=$(random 16)
SEED_PASSWORD_ALICE=$(random 16)
SEED_PASSWORD_BOB=$(random 16)
SEED_PASSWORD_CAROL=$(random 16)
SEED_PASSWORD_DAVE=$(random 16)
ENV
  echo "Created .env for ${domain}"
fi

mkdir -p keys
for key in private yhub-private; do
  if [ ! -f "keys/${key}.pem" ]; then
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "keys/${key}.pem" 2>/dev/null
    echo "Created keys/${key}.pem"
  fi
done
# Read by the containers that run as uid 1000 (the deploy user)
chmod 600 keys/*.pem
