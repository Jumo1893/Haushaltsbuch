FROM docker.io/library/node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM docker.io/library/nginx:alpine
# Das Image macht beim Start aus der Vorlage /etc/nginx/conf.d/default.conf
# und trägt dabei die DNS-Server des Containers ein (NGINX_LOCAL_RESOLVERS)
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
