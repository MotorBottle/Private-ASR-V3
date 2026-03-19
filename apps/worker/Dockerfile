FROM private-asr-v3-api

WORKDIR /app

COPY apps/worker/package.json /app/apps/worker/package.json
RUN cd /app/apps/worker && npm install --omit=dev

COPY . /app

WORKDIR /app/apps/worker

CMD ["npm", "start"]
