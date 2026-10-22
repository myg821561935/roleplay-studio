# 重前端隔离运行时 v1

## 目标

重前端是已经脱离普通角色卡展示层、可以独立运行的 HTML/CSS/JavaScript 应用。它通常拥有自己的 Prompt Builder、状态机、输出解析、长期摘要、浏览器存档甚至向量召回。

角色剧场 v1 不重写这些应用，也不把它们塞回原生聊天调用链，而是提供一个本地应用托管边界：

```text
第三方重前端
  -> 独立包版本与静态扫描 / 本地观察
  -> *.heavy.localhost 隔离来源
  -> 短期 HttpOnly 运行能力
  -> 受控 OpenAI-compatible 本地网关
  -> 服务端 Provider 与真实密钥
```

职责划分：

| 归属 | 负责内容 |
| --- | --- |
| 重前端应用 | 自己的玩法、Prompt、输出协议、页面状态和原生浏览器存档 |
| 角色剧场 | 包版本、静态扫描、本地观察与人工结论、来源隔离、API 密钥、模型路由、预算、审计与可选托管快照 |

## 为什么不能复用 `/api/chat`

`/api/chat` 会把角色剧场当前会话的角色卡、世界书、预设、记忆和导演状态重新组装成 Prompt。独立重前端已经完成了同类工作，直接复用会形成双重系统提示、重复世界书和互相冲突的输出格式。

因此 v1 使用独立原始网关：它只接收重前端构造好的 `messages`，不注入主工作台的角色卡、世界书、记忆或故事状态。服务端仍会强制所选 Provider、模型和预算，第三方请求中的 `model` 与超额 `max_tokens` 不生效。

## 包与版本

包格式为 `lra.heavy-frontend-pack/v1`。浏览器以目录方式导入，服务端执行：

1. 相对路径规范化与穿越拦截。
2. 文件数量、单文件大小、总大小和扩展名白名单校验。
3. 每个文件 SHA-256 与确定性整包哈希。
4. 入口 HTML 识别，优先 `start-screen-noST.html`、`index.html`。
5. 静态风险扫描。
6. 写入不可变本地版本。

相同来源目录和入口归入同一包。内容不变时复用已有版本；任意文件变化都会生成新版本，并把当前状态重置为“本地观察”。旧版本和旧审核记录不会被覆盖。

原始包文件位于：

```text
private-content/heavy-frontends/<package-id>/<revision-id>/
```

包清单、审核、调用审计和托管快照位于 `data/heavy-frontends/`。两处均由 `.gitignore` 排除。普通备份只包含体积可控的清单、审计和快照，不复制大型原始网页目录；原始包需要保留本地副本或重新导入。

## 静态扫描与人工审核

内置扫描会标记：

- 浏览器端 API Key、Authorization 或凭据持久化。
- 外部 CORS 代理和 `?target=` 转发。
- `eval`、`new Function` 与字符串定时器。
- 外部 URL、fetch、XHR、WebSocket、EventSource。
- Service Worker、Worker。
- 页面跳转、弹窗和下载。
- 摄像头、麦克风、定位和剪贴板。
- localStorage、IndexedDB、嵌套 iframe/object/embed。

扫描只用于整理证据，不会自动认定代码安全。本地开发阶段可直接在独立来源和受控模型网关中观察运行，导入、启动、调用、错误、更新和完整性失败均写入本地审计。审核人可随时批准当前完整内容哈希形成长期结论，或明确拒绝以立即阻断该版本；后续可依据真实审计结果收敛为严格审批。

## 浏览器隔离

每次启动创建短期运行实例和独立来源：

```text
http://hf-<instance>.heavy.localhost:<port>/heavy-runtime/instances/<id>/cap/<capability>/files/<entry>
```

iframe sandbox 只授予：

```text
allow-scripts allow-same-origin
```

`allow-same-origin` 用于保留应用自己的 localStorage 与 IndexedDB。由于重前端来源和主工作台来源不同，它不能读取父页面 DOM、主站 localStorage 或主站 Cookie。iframe 不授予 popup、顶层导航、下载、表单、摄像头、麦克风或剪贴板权限。

响应 CSP 的核心边界：

```text
default-src 'none'
script-src 'self' 'unsafe-inline' blob:
style-src 'self' 'unsafe-inline'
img-src 'self' data: blob:
font-src 'self' data:
media-src 'self' data: blob:
connect-src 'self'
worker-src 'none'
frame-src 'none'
object-src 'none'
form-action 'none'
```

v1 为兼容历史独立页面保留内联脚本与样式，但不允许 `unsafe-eval`。外部 Google Fonts、CDN、图片、代理和接口默认被阻断。

## 运行能力与模型网关

入口 URL 使用随机短期能力路径，并同时尝试设置限定实例路径的 HttpOnly、SameSite=Strict Cookie。能力不是 Provider Key，只能访问一个已审核包的单个运行实例，并同时受 12 小时时限、调用预算、随机子域和 CSP 约束。

默认主站使用 `127.0.0.1`，隔离页使用 `*.localhost`；部分浏览器会把两者视为跨站并阻止 iframe Cookie。因此 v1 保留能力路径作为必要兼容回退，重前端脚本可以看到这段短期路径，但仍看不到真实 API Key，也不能借此访问其他包、主站 API 或超出本实例预算。审计不记录能力值。

注入的最小兼容配置把常见 `jxz_apiConfig` 指向同源本地网关：

```text
/heavy-runtime/instances/<id>/cap/<capability>/v1/models
/heavy-runtime/instances/<id>/cap/<capability>/v1/chat/completions
/heavy-runtime/instances/<id>/cap/<capability>/proxy?target=<同一实例网关>
```

`apiKey` 只是固定占位文本 `managed-by-narrative-engine`。真实 Provider Key 始终留在 `data/config/providers.local.json`，不进入 HTML、iframe、localStorage、API 响应或审计。

每个实例默认限制：

- 12 小时有效期。
- 40 次模型调用，最多 100 次可配置。
- 200 万累计输入字符。
- 100 万累计输出字符。
- 单次 256–32768 Max Tokens。
- 同一实例只允许一个并发模型请求。
- 不允许 tools、MCP、embedding 或 rerank。

网关支持 OpenAI-compatible 的非流式和 SSE 流式返回；底层仍可使用角色剧场的 OpenAI-compatible、Anthropic 或 Gemini Provider Adapter。

## 审计与隐私

模型调用审计只保存：

- 包、版本、内容哈希、运行实例和请求 ID。
- Provider ID、模型名、消息数量。
- 输入/输出字符数、请求 Max Tokens、耗时。
- 成功/失败状态和截断后的错误码。

审计明确不保存 `messages`、Prompt、剧情正文、API Key、Authorization 或 Provider 原始响应。

## 存档

重前端原有 localStorage/IndexedDB 存档继续存放在独立包来源下。若应用公开：

```javascript
storageService.buildSavePayload(name, includeVectors)
```

运行工具栏可以请求托管快照。v1 固定传入 `includeVectors=false`，单快照上限 16 MB，再由主工作台通过受控 API 写入 `data/heavy-frontends/snapshots/`。快照操作使用精确的父窗口、来源和随机 nonce 校验。

没有公开该接口的应用仍可运行，只是只能使用它自己的导入/导出与浏览器存档。

## “瀚海归义录”样例结论

对 `start-screen-noST.html` 公开版本的结构核验表明，它具备独立 Prompt Builder、游戏状态、输出解析、摘要、向量召回、embedding/rerank 和 IndexedDB 存档。原版还会把模型 Key 写入 localStorage，并通过外部 CORS Worker 发送请求。

v1 兼容策略：

- 完整网页目录作为独立包导入，不拆成 100 多个普通 Prompt 模块。
- 接管 `jxz_apiConfig`，改用本地同源网关和占位 Key。
- 禁用独立 embedding/rerank Key；v1 不向重前端暴露这些外部能力。
- 阻断外部 Worker、字体和其他网络资源。
- 保留它自己的游戏 Prompt、页面状态与 IndexedDB。
- 若其 `storageService` 接口存在，可保存不含向量的托管快照。

这属于“受控独立运行”，不是与酒馆扩展环境等价，也不表示该项目所有版本都自动通过审核。每次更新仍需重新扫描和批准哈希。

## v1 不支持

- APK、Electron 主进程或原生 WebView Bridge。
- Service Worker、跨来源 iframe、任意互联网请求。
- 页面自行选择 Provider、模型或覆盖服务端预算。
- 向量 embedding、rerank、MCP、tool calling。
- 自动信任 GitHub 更新或跨版本继承批准。
- 把重前端内部状态自动合并到角色剧场原生角色卡、世界书、图谱或记忆系统。

后续若扩展能力，必须以单独 capability、单独审批和可撤销审计实现，不能通过放宽全局 CSP 或下发 API Key 达成。
