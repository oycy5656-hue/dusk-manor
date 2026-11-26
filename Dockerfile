FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --include=dev
COPY . .
RUN npm run build
ENV PORT=7860
EXPOSE 7860
CMD ["node", "server/index.mjs"]
