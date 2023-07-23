FROM node:18

WORKDIR /app

COPY package*.json ./

RUN npm install

RUN npm ci --omit=dev

COPY . .

ENV MINDEE_API_KEY=a745f5606b6358db3bb3d62a47037afb

EXPOSE 8080

CMD ["node", "index.js" ]