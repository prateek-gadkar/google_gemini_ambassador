FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY . .
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
# Mount this at /app/data or restarts forget every registration.
VOLUME ["/app/data"]
CMD ["node", "server.js"]
