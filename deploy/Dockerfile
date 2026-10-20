FROM node:24.18.0-alpine
WORKDIR /app
COPY runtime/package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server/ ./server/
COPY data/ ./data/
ENV NODE_ENV=production GAME_HOST=0.0.0.0 GAME_PORT=8787 GAME_DATA_DIR=/app/data
USER node
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/main.js"]
