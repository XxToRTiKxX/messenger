FROM node:18-alpine

# Установка Caddy
RUN apk add --no-cache caddy

WORKDIR /app

# Root workspace deps (single node_modules at /app/node_modules)
COPY package.json package-lock.json ./
COPY backend/package.json /app/backend/package.json
COPY frontend/package.json /app/frontend/package.json
RUN npm install

# Frontend build (at image build time, not at runtime)
COPY frontend /app/frontend
RUN npm run build:frontend && cp -r /app/frontend/dist /app/frontend_dist

# App sources
COPY backend/src ./src
COPY backend/.env ./
COPY backend/Caddyfile /etc/caddy/Caddyfile
COPY backend/start.sh /app/start.sh

# Создаем пользователя
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001
RUN mkdir -p /etc/caddy \
 && chown -R nodejs:nodejs /app /etc/caddy \
 && chmod 755 /etc/caddy \
 && chmod 644 /etc/caddy/Caddyfile \
 && chmod +x /app/start.sh

USER nodejs

EXPOSE 3002

# Start backend + frontend build + Caddy
CMD ["/app/start.sh"]
