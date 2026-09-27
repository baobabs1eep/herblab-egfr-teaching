# 中国香港轻量服务器部署配置

目标实例 `43.129.169.13`，Ubuntu 24.04，2 核 4 GB。应用运行在服务器本机 `127.0.0.1:8787`，Nginx 对外提供 HTTPS，整个演示站使用一组访问账号。不要把 `本地服务/.env` 加入公开压缩包、Git 仓库或网页目录。

`演示前端/ranking-data.js` 已纳入 2ITW 同协议三候选教学数据与预筛说明；参数门槛 45 仅用于展示三候选共同队列，非经验证的科学阈值。元器工作流还是已发布的单流程教学问答，并不读取浏览器导入的双排序数据。

部署时只需复制 `演示前端` 的运行文件、`本地服务/server.cjs`、本目录配置和私有 `.env`，原始对接资料可留在本地。以 `server.env.example` 为模板，在服务器 `/opt/herblab/本地服务/.env` 中填写私有元器密钥并设置为仅服务账号可读。Nginx 的 Basic 登录密码文件 `/etc/nginx/.htpasswd-herblab` 也必须单独在服务器生成，不得提交仓库。

IP 地址证书采用 Let's Encrypt 的短期证书及 Certbot 5.4+ 自动续期。参考 [Let's Encrypt 官方说明](https://letsencrypt.org/2026/03/11/shorter-certs-certbot/)。其有效期约 6 天，必须保持续期任务正常。实际步骤：开放 80/443；安装 Node、Nginx 和 Certbot；先启用 `nginx-http.conf` 供 ACME 验证；用 Certbot `--preferred-profile shortlived --webroot --webroot-path /var/www/letsencrypt --ip-address 43.129.169.13` 签发；换成 `nginx-https.conf` 并重新加载 Nginx；启用 `herblab.service` 和 `herblab-cert-renew.timer`。使用 Certbot 前应由服务器所有者阅读并接受其服务条款。具体运行状态和测试结果见[部署状态](当前服务器进度.md)。
