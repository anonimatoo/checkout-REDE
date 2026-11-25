FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM dependencies AS build
COPY frontend ./frontend
COPY shared ./shared
RUN npm run build

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY package*.json ./

FROM runtime AS connect
COPY connect ./connect
RUN chmod -R a+rX /app
USER node
EXPOSE 3400
CMD ["node", "connect/src/server.js"]

FROM runtime AS checkout
COPY --from=build /app/frontend/dist ./frontend/dist
COPY shared ./shared
COPY connect/src/network.js ./connect/src/network.js
COPY backend ./backend
RUN chmod -R a+rX /app
USER node
EXPOSE 3000
CMD ["node", "backend/src/server.js"]
