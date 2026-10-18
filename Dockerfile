FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public/index.html ./public/index.html
ENV NODE_ENV=production PORT=8080 DATA_DIR=/app/data
VOLUME ["/app/data"]
EXPOSE 8080
USER node
CMD ["node", "src/server.js"]
