# Serviço da Suno (servico.mjs): entra na conta da Suno sem janela (Chromium headless) e lê as carteiras.
FROM node:20-alpine
RUN apk add --no-cache chromium nss freetype harfbuzz ttf-freefont font-noto tzdata
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY leitor.mjs servico.mjs ./
EXPOSE 4100
CMD ["node", "servico.mjs"]
