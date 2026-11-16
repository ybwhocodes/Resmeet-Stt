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

# Ensure all static files have global read permissions for nginx worker user
RUN chmod -R a+rX /usr/share/nginx/html

# Custom nginx config: React client-side routing, svg assets, cache headers
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN chmod a+r /etc/nginx/conf.d/default.conf

EXPOSE 5173

CMD ["nginx", "-g", "daemon off;"]
