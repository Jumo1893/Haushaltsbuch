FROM docker.io/library/node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY import ./import
COPY import-profiles ./import-profiles
USER node
EXPOSE 3000
CMD ["node", "server.js"]
