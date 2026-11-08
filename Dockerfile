FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY game/package*.json ./game/
RUN npm --prefix game ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 ONLINE_DATA_DIR=/data
WORKDIR /app/game
COPY --from=build --chown=node:node /app/game/src ./src
COPY --from=build --chown=node:node /app/game/server ./server
COPY --from=build --chown=node:node /app/game/dist ./dist
COPY --from=build /app/game/package.json ./package.json
COPY --from=build /app/LICENSE /app/LICENSE
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3001
VOLUME ["/data"]
CMD ["node", "--experimental-strip-types", "server/online-server.ts"]
