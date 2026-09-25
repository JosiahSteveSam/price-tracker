# Playwright image ships Chromium + all system deps. Tag MUST match the pinned npm `playwright` version.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# Drop root (the image provides the `pwuser` account).
USER pwuser
EXPOSE 10000
CMD ["node", "dist/index.js"]
