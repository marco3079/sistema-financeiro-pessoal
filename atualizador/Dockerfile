FROM docker:28-cli
RUN apk add --no-cache git nodejs tzdata
WORKDIR /app
COPY vigia.js ./
# A imagem docker:cli trata o comando como subcomando do docker; por isso o ENTRYPOINT próprio.
ENTRYPOINT ["node", "vigia.js"]
