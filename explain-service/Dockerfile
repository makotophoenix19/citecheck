# citecheck explain-service — the Layer-2 narrative endpoint.
# Build context is the REPOSITORY ROOT (it builds the whole citecheck package
# and runs the explain-server entry point). See explain-service/README.md.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 8088
# ANTHROPIC_API_KEY (required) and CITECHECK_EXPLAIN_TOKEN (optional) are passed
# in at runtime — never baked into the image.
CMD ["node", "dist/explain-server.js"]
