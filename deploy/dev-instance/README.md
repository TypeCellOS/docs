# Dev instance

A dev instance of Docs on one server, with the BlockNote version history work.
`.github/workflows/dev-instance.yml` deploys it.

- Docs: https://167-233-225-101.sslip.io
- Keycloak: https://id.167-233-225-101.sslip.io

## Demo users

The password of each demo user is the user name.

| User | Password |
| --- | --- |
| alice | alice |
| bob | bob |
| carol | carol |
| dave | dave |

Every deploy makes sure that the sample document "07/10 meeting agenda (sample)"
exists. alice owns it, and bob, carol and dave can edit it. Its history has 15
named versions by the four users (`scripts/seed.sh`).

## Admin accounts

The admin accounts have random passwords. They are only on the server, in
`/opt/docs/.env`:

```bash
ssh deploy@167.233.225.101 'grep -E "^(SEED_PASSWORD_ADMIN|KEYCLOAK_ADMIN_PASSWORD)=" /opt/docs/.env'
```

| Account | User | Password variable |
| --- | --- | --- |
| Django admin (`/admin`) | admin@example.com | `SEED_PASSWORD_ADMIN` |
| "admin" user of the "docs" realm | admin | `SEED_PASSWORD_ADMIN` |
| Keycloak administration console | admin | `KEYCLOAK_ADMIN_PASSWORD` |

## Deploy a change

1. Open a pull request against `dev`.
2. Merge it. The workflow builds the frontend, yhub and y-provider images and
   deploys them.

To deploy a branch that is not merged, run the "Dev instance" workflow from the
Actions tab and set `ref`. There is only one server: the last deploy wins.

## Server

- The stack is in `/opt/docs` (`compose.yaml`). The `deploy` user owns it.
- The first deploy writes `/opt/docs/.env` with random secrets. It never
  changes them after that.
- The data of the sample document is `/opt/docs/seed-data/meetingVersions.json`.
  It is not in the repository. Without it, the deploy skips the sample
  document.
- There are no backups.
