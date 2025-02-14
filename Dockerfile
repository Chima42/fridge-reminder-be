FROM node:18

WORKDIR /app

COPY package*.json ./

RUN npm install

RUN npm ci --omit=dev

ENV PORT=a745f5606b6358db3bb3d62a47037afb

EXPOSE 8080

COPY . .

CMD ["node", "index.js"]