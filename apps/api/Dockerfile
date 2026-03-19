FROM node:20-bookworm

WORKDIR /app

COPY apps/api/package.json /app/apps/api/package.json
RUN cd /app/apps/api && npm install --omit=dev

COPY . /app

WORKDIR /app/apps/api

EXPOSE 3000

CMD ["npm", "start"]
