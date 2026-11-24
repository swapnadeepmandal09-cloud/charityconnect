# For hosts with persistent disks (Render, Railway, Fly.io, any VPS). Not used by Vercel.
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server ./server
COPY public ./public
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/charityconnect.sqlite
EXPOSE 3000
# Mount a persistent volume at /data. Set ADMIN_EMAIL and ADMIN_PASSWORD (required for the first production start).
CMD ["node", "server/index.js"]
