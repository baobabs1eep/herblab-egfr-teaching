FROM node:24-alpine
WORKDIR /app
COPY 演示前端 ./演示前端
COPY 本地服务/server.cjs ./本地服务/server.cjs
ENV HOST=0.0.0.0 PORT=8787
EXPOSE 8787
CMD ["node", "本地服务/server.cjs"]
