FROM node:16-alpine

COPY package.json .

RUN npm install


CMD ["pm2-docker", "index.js" ]