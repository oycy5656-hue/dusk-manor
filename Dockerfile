FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --prod=false || npm install
COPY . .
RUN npm run build || npx vite build
ENV PORT=8788
EXPOSE 8788
CMD ["node", "server/index.mjs"]
