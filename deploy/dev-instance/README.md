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

## Update BlockNote

The frontend and y-provider use preview packages of BlockNote from
[pkg.pr.new](https://pkg.pr.new). They come from the BlockNote branch
`fix/version-diff-cascade-attribution`, draft pull request
[TypeCellOS/BlockNote#3204](https://github.com/TypeCellOS/BlockNote/pull/3204):
BlockNote `main` plus the experimental version diff fixes. Do not merge that
pull request.

1. In BlockNote, merge `main` into `fix/version-diff-cascade-attribution` and
   push. Resolve conflicts in favour of `main`, except in the experimental code
   (`packages/core/src/y/extensions/snapshotPreview.ts`, the experimental tests,
   and the gallery flags). Then update the gallery snapshot:
   `pnpm run e2e:updateSnaps src/end-to-end/y-prosemirror/versioning.test.tsx`.
2. Wait until the `build` workflow of #3204 passes. Its "Soft release" step
   publishes the packages under the first 10 characters of the commit SHA.
   pkg.pr.new publishes only for an open pull request, so keep #3204 open.
   Check a package:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" \
     https://pkg.pr.new/TypeCellOS/BlockNote/@blocknote/core@<new sha>
   ```

3. In this repository, replace the old SHA with the new one and update
   `yarn.lock`:

   ```bash
   git switch -c chore/blocknote-<new sha> origin/dev
   sed -i '' 's/<old sha>/<new sha>/g' CHANGELOG.md \
     src/frontend/package.json \
     src/frontend/apps/impress/package.json \
     src/frontend/servers/y-provider/package.json
   cd src/frontend && yarn install --ignore-engines
   ```

   `yarn.lock` must change only the `@blocknote/*` entries. A new BlockNote
   version can change its API, and the deploy fails in the frontend build.
   So type-check before you open the pull request:

   ```bash
   cd src/frontend/apps/impress && npx tsc --noEmit -p .
   ```

4. Commit as `⬆️(frontend) update BlockNote preview packages to <new sha>`
   (signed off), open a pull request against `dev`, and merge it. The merge
   deploys.

The `test-e2e-chromium` job fails on every run of this fork. Compare its
failures with the previous update pull request instead of waiting for green.

## Server

- The stack is in `/opt/docs` (`compose.yaml`). The `deploy` user owns it.
- The first deploy writes `/opt/docs/.env` with random secrets. It never
  changes them after that.
- The data of the sample document is `/opt/docs/seed-data/meetingVersions.json`.
  It is not in the repository. Without it, the deploy skips the sample
  document.
- There are no backups.
