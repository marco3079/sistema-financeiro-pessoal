# Calculadora oficial da Reforma Tributária do Consumo (Receita Federal, licença MIT):
# https://github.com/ReceitaFederal/calculadora-rtc-regime-regular
# Baixa o código num commit fixo, gera o banco de tabelas (SQLite, via Flyway) e compila o JAR.
# Para atualizar a versão, troque COMMIT e reconstrua (docker compose build calculadora).

FROM maven:3.9-eclipse-temurin-21 AS build
ARG COMMIT=150cccbe414d4a5edea703e4f7a424af5aa222c7
WORKDIR /src
ADD https://github.com/ReceitaFederal/calculadora-rtc-regime-regular/archive/${COMMIT}.tar.gz /tmp/codigo.tar.gz
RUN tar -xzf /tmp/codigo.tar.gz --strip-components=1 \
 && mkdir -p calculadora/db \
 && mvn -q -B flyway:migrate -Dflyway.configFiles=./flyway/flyway-pro.conf \
 && mvn -q -B -DskipTests package \
 && cp target/api-regime-geral.jar /src/app.jar

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/app.jar /app/app.jar
COPY --from=build /src/calculadora/db /app/calculadora/db
ENV JAVA_TOOL_OPTIONS="-Xms64m -Xmx512m -XX:+UseSerialGC"
EXPOSE 8080
CMD ["java", "-Dspring.profiles.active=offline", "-jar", "/app/app.jar"]
