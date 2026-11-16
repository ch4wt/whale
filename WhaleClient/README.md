# WhaleClient

鲸鱼娘客户端。三端共用一套 H5 界面：

```
WhaleClient/
├── web/        界面（React + TypeScript + rspack）
├── android/    安卓壳（待建，复用 deepseek-app 那套 WebView 壳）
└── ios/        iOS 壳（待建，WKWebView）
```

## 当前进度

- `web/` 可构建，已实现：登录、2FA、PAT 换取、API Key 自动创建、模型列表、流式聊天。
- `android/`、`ios/` 只有目录，未开始。

## 运行

```sh
cd web
npx rspack build -c rspack.config.ts     # 产物 dist/
npx rspack serve -c rspack.config.ts     # 开发服务器 :8090
```

依赖复用同级 `deepseek-app/web/node_modules`（开发期软链接）。

## 接口约定

登录（与仓库 `ios/` 客户端一致）：

```
GET  /api/user/login/encryption-key        取密码加密公钥（可能 enabled=false）
POST /api/user/login                       {username, password | password_encrypted, encryption_key_id}
POST /api/user/login/verify                2FA：{flow_token, method:"2fa", code}
GET  /api/verify/methods?scope=access_token.generate
POST /api/verify                           安全证明 {method, scope, context:{scopes, expires_at}}
POST /api/user/access_tokens               建 PAT（需 X-Security-Proof 头）
POST /api/user/auth/logout                 注销临时会话
```

聊天：

```
GET  /api/token/                           列出 API Key
POST /api/token/                           创建 API Key（name=WhaleClient Web）
POST /api/token/{id}/key                   取明文 Key（PAT 需 api_key:reveal）
GET  /v1/models                            可用模型
POST /v1/chat/completions                  stream=true，SSE
```

PAT 权限：`api_key:read`、`api_key:reveal`、`api_key:write`、`profile:read`，有效期 90 天。

## 服务端账号体系（对照）

- 用户表含：用户名、密码散列、角色（common/admin/root）、状态、额度、分组、第三方绑定、邀请、`auth_version`。
- 面板会话：15 分钟 JWT + HttpOnly Refresh Cookie（30 天），服务端记录设备/IP/撤销状态。
- API Key：每用户多条，可限额度、限模型、限 IP、设过期。
- PAT：长期令牌，按 scope 授权，90 天，建时需密码或 2FA 的安全证明。
- 登录方式：密码、TOTP 2FA、Passkey、OAuth（GitHub/Discord/OIDC/LinuxDO）、微信、Telegram。
- 计费：用户额度 + Key 额度，按分组倍率。

客户端只用 PAT，不碰面板会话。

## 注意

- 临时测试服是明文 HTTP，且 `encryption-key` 返回 `enabled=false`，密码明文传输。只能内测。
- 浏览器里 PAT 存 `localStorage`；安卓/iOS 版要换成 Keystore / Keychain。
