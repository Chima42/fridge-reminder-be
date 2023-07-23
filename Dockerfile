FROM node:18

WORKDIR /app

COPY package*.json ./

RUN npm install

RUN npm ci --omit=dev

ENV MINDEE_API_KEY=a745f5606b6358db3bb3d62a47037afb

COPY . .


EXPOSE 8080

CMD ["node", "index.js" ]