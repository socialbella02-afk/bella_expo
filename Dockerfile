# Multi-stage build for Expo Coupon System

# Stage 1: Build Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS production
WORKDIR /app

# Install dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Copy backend
COPY backend/package*.json ./
RUN npm ci --only=production

COPY backend/ ./

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./public

# Create data directory
RUN mkdir -p data

# Environment
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server.production.js"]
