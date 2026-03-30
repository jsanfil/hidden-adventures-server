FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY docker/dev-start.sh /usr/local/bin/docker-dev-start
RUN chmod +x /usr/local/bin/docker-dev-start

EXPOSE 3000

CMD ["docker-dev-start"]
