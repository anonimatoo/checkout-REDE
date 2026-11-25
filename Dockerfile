FROM node:24-alpine AS runtime
RUN --mount=type=bind,source=.,target=/source,ro \
    --mount=type=secret,id=npm_ca \
    set -eu; \
    if [ -s /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    export npm_config_cache=/tmp/csrede-npm; \
    mkdir /app; cd /app; \
    cp /source/package.json /source/package-lock.json .; \
    npm ci --no-audit --no-fund; \
    cp -R /source/frontend /source/shared /source/backend /source/connect .; \
    npm run build; \
    npm prune --omit=dev --no-audit --no-fund; \
    rm -rf /tmp/csrede-npm frontend/src frontend/public frontend/vite.config.js frontend/index.html; \
    chmod -R a+rX /app
ENV NODE_ENV=production
WORKDIR /app
USER node

FROM runtime AS connect
EXPOSE 3400
CMD ["node", "connect/src/server.js"]

FROM runtime AS checkout
EXPOSE 3000
CMD ["node", "backend/src/server.js"]
