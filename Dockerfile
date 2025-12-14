FROM node:18-bullseye

RUN apt-get update && apt-get install -y ffmpeg fonts-dejavu-core

WORKDIR /app
COPY . .
RUN npm install

EXPOSE 10000
CMD ["npm","start"]
