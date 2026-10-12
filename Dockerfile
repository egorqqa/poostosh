# Выделенный сервер «Пустошь»: сервер + веб-клиент
FROM node:20-alpine
WORKDIR /app
COPY server/package.json server/package.json
RUN cd server && npm install --omit=dev --no-audit --no-fund
COPY server/ server/
COPY game/ game/
ENV PORT=7777 DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 7777
CMD ["node", "server/server.js"]
