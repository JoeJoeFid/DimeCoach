# Builds PracticePlan for a hosting provider. The data file lives in /data, which must be a
# persistent volume or everything is lost when the container restarts.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 PP_DATA_DIR=/data PP_TRUST_PROXY=1 PP_COOKIE_SECURE=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY --from=build /app/dist ./dist
VOLUME /data
EXPOSE 8080
# Set PP_SETUP_TOKEN when you deploy: the first-run setup page asks for it, so a stranger
# who finds the site first cannot make themselves the administrator.
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
