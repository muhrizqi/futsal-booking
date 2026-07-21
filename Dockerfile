FROM node:20-alpine

# postgresql-client dibutuhkan untuk fitur backup/restore (pg_dump & pg_restore)
RUN apk add --no-cache postgresql-client

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /app/backups

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/server.js"]
