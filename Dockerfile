# Cloud.ru Evolution Container Apps / Workflow Studio.
# The same Node.js server serves the frontend and the WebSocket backend.
FROM node:22-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /opt/opp-quiz
COPY --chown=node:node live/ ./live/
COPY --chown=node:node lan-server/server.js ./lan-server/server.js
EXPOSE 8080
USER node
CMD ["node", "lan-server/server.js"]
