FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app

# better-sqlite3 needs build tools
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev && apk del python3 make g++

COPY src/ ./src/
COPY --from=frontend-build /app/frontend/dist ./frontend/dist/

ENV NODE_ENV=production
EXPOSE 3420

CMD ["node", "src/index.js"]
