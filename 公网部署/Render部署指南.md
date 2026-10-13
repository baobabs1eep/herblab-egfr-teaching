# Render 独立部署指南

本方案用于由项目成员自己的 Render 账号部署一套独立公网网站，不依赖原腾讯云服务器。部署成功后，陌生人可以直接打开 Render 提供的 HTTPS 地址，无需输入演示账号。

## 一、部署前准备

需要准备：

- 可以访问项目仓库的 GitHub 账号；
- 自己注册的 Render 账号；
- 已发布腾讯元器的应用 ID；
- 对应的腾讯元器 API Key。

不要把 API Key 写入代码、Markdown、聊天记录或 GitHub。密钥只填写在 Render 的加密环境变量页面。

## 二、项目提供的部署保护

- `Dockerfile` 会打包网页及全部后端模块，但不会打包 `.env`；
- `render.yaml` 声明 Docker Web Service 和健康检查；
- `PUBLIC_ACCESS=true` 允许陌生人免登录访问；
- 接口仍保留来源检查、请求体大小限制和调用频率限制；
- `TRUST_PROXY=true` 用于在 Render 代理后识别访客 IP；
- `YUANQI_APP_KEY` 由 Render 在创建服务时单独询问，不会进入仓库。

## 三、在 Render 创建网站

1. 登录 Render 控制台。
2. 选择 `New`，再选择 `Blueprint`。
3. 连接 GitHub，并授权访问私人仓库 `lingyi-17/qizhen-herblab-private`。
4. 选择该仓库；Render 会自动读取根目录的 `render.yaml`。
5. 创建过程中填写：
   - `YUANQI_APP_ID`：已发布元器的应用 ID；
   - `YUANQI_APP_KEY`：元器 API Key。
6. 确认创建服务，等待构建和部署完成。

`render.yaml` 默认使用 Free 方案，避免未经确认产生费用。正式比赛展示前应根据 Render 当时的套餐说明判断是否升级，以减少休眠或资源限制带来的影响。

## 四、取得并验证公网地址

部署成功后，Render 会提供类似以下地址：

```text
https://qizhen-herblab-agent.onrender.com
```

实际地址以 Render 控制台显示为准。依次验证：

1. 打开网站首页，确认无需账号密码；
2. 打开 `/api/health`，应返回 `configured: true`；
3. 输入一种中文疾病进行文献检索；
4. 输入另一种疾病，确认不是固定案例；
5. 测试 AI 问答；
6. 用手机流量或另一台电脑打开，确认陌生设备可访问。

## 五、以后更新网站

Render连接GitHub后，可以跟随所选分支更新。建议流程为：

1. 本地完成修改和测试；
2. 提交并推送到 GitHub `main`；
3. 在 Render 的 Deploys 页面观察构建；
4. 构建通过后用无痕窗口验证公网功能；
5. 如果新版异常，在 Render 中回滚到上一个成功部署。

## 六、常见错误

### 健康检查失败

检查部署日志中是否缺少元器变量，或应用是否成功监听 Render 提供的 `PORT`。

### 显示智能体未配置

检查 `YUANQI_APP_ID` 和 `YUANQI_APP_KEY` 是否在 Render Environment 页面填写，并确认元器已经重新发布。

### 首页可以打开但检索失败

查看 Render 日志，确认外部文献数据库是否超时。外部数据库不可用与网页部署失败是两个不同问题。

### 访问地址不正确

如果后来绑定自定义域名，需要把 `PUBLIC_ORIGIN` 设置为完整 HTTPS 地址，例如 `https://research.example.com`，然后重新部署。
