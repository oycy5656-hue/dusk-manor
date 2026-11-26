FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --include=dev
COPY . .
RUN npm run build
ENV PORT=8788
EXPOSE 8788
CMD ["node", "server/index.mjs"]
