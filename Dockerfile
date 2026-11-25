FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY frontend ./frontend
COPY shared ./shared
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/frontend/dist ./frontend/dist
COPY package*.json ./
COPY shared ./shared
COPY backend ./backend
RUN chmod -R a+rX /app
USER node
EXPOSE 3000
CMD ["node", "backend/src/server.js"]
