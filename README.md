# Narrative Roleplay Engine

**叙界**是一套面向个人创作的角色扮演与世界模拟引擎。它把剧本内容包、角色卡、世界书、Prompt 预设、分层记忆、世界状态与多模型调用组织成一条可审阅、可回退、可持续扩展的叙事流程。

它不只是聊天前端。你可以先选择或组装一个世界，塑造主角与开局命运，再进入持续演进的故事；系统会在后续对话中维护人物关系、事实、事件账本和长期记忆。

| 当前版本 | 运行方式 | 数据位置 | 兼容原则 |
| --- | --- | --- | --- |
| `v0.6.0-rc.1` 里程碑候选版 | Node.js 22.13+ 本地网页 | 角色卡、世界书、密钥与存档保存在本机 | 兼容酒馆资源格式和常见交互语义；第三方脚本须审核、隔离并审计 |

## 从世界设定到第一幕

1. **剧本书架**：选择内置剧本、继续已有故事，或创建独立的自定义世界。
2. **叙事资产中心**：管理角色卡、世界书、Prompt 预设与内容包，导入后先评定、再入库。
3. **开局向导**：确认世界规则，塑造主角，选择天命、风险和剧情钩子。
4. **沉浸叙事**：阅读流式正文，点击推荐行动或自由输入，通过 Edit、重生成与 Swipe 管理分支。
5. **长期演进**：事件账本、章节摘要、事实卡、世界状态和分层记忆共同维持长篇连续性。

## 核心能力

| 领域 | 能力 |
| --- | --- |
| 剧本与工程 | 内置/自定义剧本、独立故事存档、开局向导、主题与舞台背景联动 |
| 角色与世界 | Character Card V2、PNG 角色卡、SillyTavern Lorebook、角色随卡世界书、Prompt 预设 |
| 创作控制 | 消息编辑、重生成、Swipe、推荐行动、叙事约束、当前场景章纲与创作决策 |
| 记忆与状态 | 最近对话、滚动摘要、Scene/Chapter/Arc 分层记忆、事实卡、世界状态、SQLite 剧情知识图谱与事件账本 |
| 世界模拟 | 声明式动作协议、NPC 目标/知识/日程、幕后行动、世界时钟与状态裁定 |
| 模型接入 | OpenAI-compatible、DeepSeek、Anthropic、Gemini 与自定义模型 |
| 资源兼容 | 导入预览、依赖扫描、冲突检查、上下文体量评估、轻前端声明式适配、独立重前端隔离托管 |
| 本地治理 | Provider 测试连接、备份恢复、数据迁移、仓库内容边界检查 |

## 快速开始（3 步）

1. 启动本地服务：

   ```bash
   npm install
   npm test
   npm start
   ```

   浏览器访问 `http://127.0.0.1:5178`。

2. 配置 Provider：在空会话封面点击“去配置”，选择协议与厂家，填写 API Key 和模型，然后执行“测试连接”。

3. 选择剧本并入局：打开“剧本书架”，选择基础剧本或自定义剧本，完成主角塑造与天命选择后进入第一幕。

停止和重启服务：

```bash
npm stop
npm restart
```

也可以双击项目根目录的 `start-local.command` 和 `stop-local.command`。服务默认只监听 `127.0.0.1`，运行日志与 PID 保存在 `.runtime/`。

## 创建与导入

### 使用现有剧本

从剧本书架选择题材包后，系统会创建独立故事工程，并自动绑定对应世界规则、角色边界、叙事约束、主题和舞台背景。切换剧本不会修改其他存档。

### 创建自定义世界

自定义剧本按以下顺序组装：

```text
题材基线 -> 角色卡 -> 世界书 -> Prompt 预设 -> 兼容校验 -> 独立故事工程
```

素材中心中的馆藏可直接参与组装，不需要每次重新从本地文件导入。外部资源的原始内容保持只读；本地整理信息和派生版本不会覆盖原件。

### 兼容性结论

导入评定只使用三种正式结论：

- **完整映射**：登记样例的主要行为与原资源一致，自动化断言通过。
- **安全降级**：保留静态内容，禁用不安全部分，并明确列出差异。
- **阻断运行**：未审核或哈希已变化的脚本、请求联网/父页面权限的代码、无法隔离的 DOM/iframe 行为或超出预算的递归；允许保存审阅，但拒绝执行。

项目支持常见静态正则、Quick Reply、MVU 补丁、有限生命周期和原生侧栏转换。第三方 JavaScript 只在人工审核、内容哈希绑定、无父页面权限且默认禁止联网的沙箱中运行，并记录本地执行审计；项目仍不复刻 SillyTavern 的原生第三方扩展环境。格式兼容不等于运行时兼容，未经过真实脱敏样例验证的能力不会宣称覆盖率。

对于已经发展为独立网页的“重前端”，素材中心提供单独的托管入口：导入完整网页目录后生成不可变版本和静态风险清单，人工批准当前 SHA-256 哈希后，页面才会在 `*.heavy.localhost` 隔离域名中启动。第三方页面保留自己的 Prompt、玩法和浏览器存档，但模型请求被改接到服务端受控网关；真实 API Key、主工作台 DOM、角色卡、世界书和其他剧本存档均不会进入 iframe。详见 [`docs/heavy-frontend-runtime-v1.md`](docs/heavy-frontend-runtime-v1.md)。

## Provider 配置

当前支持：

- **OpenAI Compatible**：OpenAI、DeepSeek、OpenRouter、硅基流动、Ollama、LM Studio 及其他兼容接口。
- **Anthropic**：Claude Messages API。
- **Gemini**：Google Gemini `generateContent` 与流式接口。

界面会根据厂家提供常用模型候选，也允许填写自定义模型。不同 Provider 的额度、内容策略和模型能力由对应服务商决定。

Provider 配置保存在 `data/config/providers.local.json`，不会进入 Git。网页 `/api/state` 只返回遮罩后的 API Key。

## 数据、隐私与备份

个人角色卡、世界书、Prompt、立绘、故事工程、会话记录和 Provider 密钥只保存在本机。这个 GitHub 仓库发布的是技术框架、格式规范、测试与最小演示内容，不是社区资源镜像。

```bash
npm run backup
npm run backup:list
npm run restore -- <backup-id> --yes
```

提交或发布前执行：

```bash
npm run repository:check
npm run release:check
```

`release:check` 是签发门禁：要求发布文件均已纳入 Git，且暂存区、工作区和未跟踪文件全部为空。本机社区黄金样例还需单独执行 `npm run release:check:local`；样例原件只保存在本机，不进入仓库。

仓库内容边界详见 [`docs/repository-content-policy.md`](docs/repository-content-policy.md)。

## 技术结构

```text
浏览器工作台
  -> 剧本 / 素材 / Provider / 会话控制器
  -> Prompt 与世界书装配
  -> Provider Adapter
  -> 角色回复 + 声明式动作
  -> 状态裁定 / 事件账本 / 分层记忆
  -> 本地 JSON / SQLite 存储、素材库与故事工程
```

核心 Agent 不是单一提示词，而是：

```text
Agent = 角色与世界资产 + Prompt 装配 + 模型调用
      + 记忆管理 + 状态裁定 + 分支与存档
```

## 文档与发布

- 项目长期上下文与新任务交接：[`docs/project-context.md`](docs/project-context.md)
- 当前里程碑候选：[`v0.6.0-rc.1`](docs/release-v0.6.0-rc.1.md)
- 当前稳定版本：[`v0.5.0`](docs/release-v0.5.0.md)
- 版本更新记录：[GitHub Releases](https://github.com/myg821561935/local-roleplay-agent/releases)
- 酒馆机制兼容契约与黄金矩阵：[`docs/tavern-compatibility-contract-v2.md`](docs/tavern-compatibility-contract-v2.md)
- 历史兼容政策：[`docs/tavern-compatibility-policy-v1.md`](docs/tavern-compatibility-policy-v1.md)
- 轻前端运行时：[`docs/light-frontend-runtime-v1.md`](docs/light-frontend-runtime-v1.md)
- 重前端隔离运行时：[`docs/heavy-frontend-runtime-v1.md`](docs/heavy-frontend-runtime-v1.md)
- 内容包规范：[`docs/content-pack-spec-v1.md`](docs/content-pack-spec-v1.md)
- 插件清单规范：[`docs/plugin-manifest-spec-v1.md`](docs/plugin-manifest-spec-v1.md)
- 动作协议：[`docs/action-protocol-v1.md`](docs/action-protocol-v1.md)
- 分层记忆系统：[`docs/memory-system-v1.md`](docs/memory-system-v1.md)
- 剧情知识图谱：[`docs/knowledge-graph-v1.md`](docs/knowledge-graph-v1.md)
- 剧情图谱工程契约：[`docs/graph-engineering-contract-v1.md`](docs/graph-engineering-contract-v1.md)

`local-roleplay-agent` 继续作为仓库名、npm 包名和历史数据兼容标识；产品展示名称统一为 **Narrative Roleplay Engine / 叙界**。本地优先是部署与隐私特性，不再作为品牌名的一部分。
