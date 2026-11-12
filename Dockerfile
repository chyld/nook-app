# The notes app (SPEC2 13). Built with this folder as its context; noteformat/ (used as it
# is) is in the image beside the packages. Three stages: build (installs and
# bundles), app (the server), and backup (the app's code for notes-admin, plus restic).

# --- build -----------------------------------------------------------------------------------
FROM node:26-slim AS build
WORKDIR /opt/notes
COPY noteformat/package.json noteformat/package-lock.json noteformat/
RUN cd noteformat && npm ci --omit=dev --no-audit --no-fund
COPY package.json package-lock.json ./
COPY packages/contract/package.json packages/contract/
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY e2e/package.json e2e/
RUN npm ci --no-audit --no-fund
COPY noteformat/src noteformat/src
COPY noteformat/theme noteformat/theme
COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY scripts scripts
RUN npm run build \
 && npm prune --omit=dev --no-audit --no-fund \
 && rm -rf packages/*/test packages/web/src packages/web/scripts packages/web/index.html packages/web/vite.config.ts e2e

# --- app -------------------------------------------------------------------------------------
FROM node:26-slim AS app
ENV NODE_ENV=production \
    NOTES_DATA=/srv/notes \
    NOTES_ADMIN_SOCKET=/run/notes/admin.sock \
    NOTES_PORT=3000
RUN groupadd --system --gid 10001 notes \
 && useradd --system --uid 10001 --gid notes --home-dir /srv/notes --shell /usr/sbin/nologin notes \
 && mkdir -p /srv/notes /run/notes \
 && chown notes:notes /srv/notes /run/notes \
 && chmod 0700 /srv/notes /run/notes
COPY --from=build /opt/notes /opt/notes
RUN chmod 0755 /opt/notes/packages/server/src/admin-cli.ts \
 && ln -s /opt/notes/packages/server/src/admin-cli.ts /usr/local/bin/notes-admin
USER notes
WORKDIR /opt/notes
EXPOSE 3000
CMD ["node", "/opt/notes/packages/server/src/main.ts"]

# --- backup ----------------------------------------------------------------------------------
FROM app AS backup
COPY --from=restic/restic:0.18.1 /usr/bin/restic /usr/local/bin/restic
USER root
RUN chmod 0755 /opt/notes/scripts/backup.sh /opt/notes/scripts/restore.sh \
 && ln -s /opt/notes/scripts/backup.sh /usr/local/bin/notes-backup \
 && ln -s /opt/notes/scripts/restore.sh /usr/local/bin/notes-restore
USER notes
ENV RESTIC_CACHE_DIR=/tmp/restic-cache
CMD ["notes-backup"]
