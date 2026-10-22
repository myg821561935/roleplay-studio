# Pi 运行时接入实验

实验默认关闭。安装可选依赖后，以 `ROLEPLAY_AGENT_RUNTIME=pi node server/index.js` 启动实验实例；不设置该变量，或设为 `native`，使用原有实现。变量只在进程启动时读取，不会修改会话设置。构造 AgentService 时也可以显式传入 `agentRuntime`，用于隔离对照。未知值会在启动时报错。

锁定 `@earendil-works/pi-agent-core` 0.85.1。原有 native 路径不加载 Pi；启用 Pi 但依赖不可用时明确报错，不静默回退。安装使用 `npm ci --ignore-scripts`，无需执行第三方安装脚本。

## 接入边界

- Pi 负责单次生成内的模型／工具循环、工具参数校验和事件生命周期。每次生成创建独立 Agent，工具串行运行，最多调用模型五次。
- 原有 Provider 客户端负责请求、采样参数、路由、回退、流式输出及取消。Pi 接收到完整回合事件；页面仍通过原有传输层实时接收正文。
- 初始提示词逐条保留内容和顺序，包括中途或末尾的 system 消息。后续工具调用转换回既有接口格式。
- 原有提示词组装、角色卡／预设／世界书兼容、剧情校验、状态提交和后台维护继续由项目处理。Pi 没有独立持久化，也没有装载 coding-agent 的系统提示词、文件／命令工具或自动压缩。
- 这是复用 Pi Core 的运行机制实验，尚未替换 Provider SDK，也未新增按人物认知检索的工具。它本身不承诺改善文风。

## 验证

`node --test tests/piRuntime.test.js tests/agentRuntimeComparison.test.js`

测试直接加载已安装的 Pi，不用替身冒充运行时。覆盖消息顺序、工具配对、参数校验、调用上限、元数据、流式输出、回退和取消。

真实对照入口：

```sh
node scripts/compare-agent-runtimes.mjs REQUEST_JSON PROVIDER_ID NEW_OUTPUT_DIR --dry-run
node scripts/compare-agent-runtimes.mjs REQUEST_JSON PROVIDER_ID NEW_OUTPUT_DIR --run
```

请求文件应包含 `messages`；凭据由本地配置读取，不写入对照文件。输出目录必须不存在。默认 native、Pi 各三轮，共六次模型调用。两组使用完全相同的初始提示词、Provider 设置与后续用户输入，第一轮后各自沿用自己的历史。结果、提示词和原始响应属于私有内容，应放在忽略的 `work/` 目录下。

此对照不写入原会话，不运行完整的剧情状态提交／后台维护；用于判断生成运行机制是否兼容以及收集多轮文本，不代表完整产品端到端验证。启发式检查只提供待核查线索，不自动判定文风优劣。正式质量结论仍需更多角色卡、多次重复和人工盲评。
