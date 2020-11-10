FROM node:12.18.3

COPY ./package.json ./app/
WORKDIR /app/
ENV NODE_ENV production
RUN npm install --no-progress --production

COPY . /app
EXPOSE 3000
ENTRYPOINT ["bash", "/app/docker-entrypoint.sh"]
CMD ["node", "index.js"]