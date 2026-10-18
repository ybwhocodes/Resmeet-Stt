# ==============================================================================
# Resmeet-STT Frontend Dockerfile
# Runtime: Node.js (Vite Build) + Nginx (Production Static Server)
# ==============================================================================
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Production server using Nginx
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

# Custom nginx config to support React client-side routing & docs
RUN echo 'server { \
    listen 5173; \
    server_name localhost; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html index.htm; \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 5173

CMD ["nginx", "-g", "daemon off;"]
