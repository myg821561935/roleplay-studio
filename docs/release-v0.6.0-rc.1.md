# Roleplay Studio v0.6.0-rc.1

状态：**本地基线已提交，自动化签发通过；尚未推送或打标签**
目标：为长期迭代建立第一个覆盖酒馆兼容、Agent 记忆/图谱和重前端治理的可审阅里程碑候选。

## 候选范围

- 前端从超大单文件迁移为按领域控制器组合的工作台；
- 角色卡、世界书、Prompt 预设、正则和提示词模板的导入、评定、匹配、版本与剧本组装；
- 酒馆兼容契约 v2、黄金资源矩阵、世界书标签注册表和组装前审批；
- 轻前端声明式兼容、安全脚本审批与重前端隔离托管；
- 角色/世界优先的 Prompt 装配、正文协议、Provider 适配和 MCP function calling；
- 分层记忆、事实卡、SQLite 剧情知识图谱、关系图、NPC 日程和世界模拟；
- 本地备份恢复、资源引用修复、健康检查和仓库内容边界。

详细文件与能力分组见 [`release-v0.6.0-rc.1-scope.md`](release-v0.6.0-rc.1-scope.md)。

## 签发门禁

- [x] `package.json` 与服务版本统一为 `0.6.0-rc.1`；
- [x] Node 最低版本统一为 22.13.0；
- [x] 发布检查要求关键文件存在且已被 Git 跟踪；
- [x] 发布检查要求暂存区、工作区和未跟踪文件全部为空；
- [x] 发布门禁核心逻辑具有独立单元测试；
- [x] 干净 Git 基线已建立：`4399be9`；
- [x] 提交后 `npm run release:check` 完整通过；
- [x] 全量自动化测试通过：967/967；
- [x] 酒馆兼容专项测试通过：98/98；
- [x] 仓库内容边界检查通过：213 个已跟踪文件，0 个暂存新增/修改文件；
- [ ] 本机社区黄金样例全部达到登记的预期结论；
- [ ] 第一次使用、老用户续聊、多剧本、多 Provider、长对话、分支重生成和重启续聊人工回归通过；
- [ ] 执行一次从新备份恢复到隔离数据副本的演练；
- [ ] 第三方脚本、重前端网关与本地 API Key 边界完成专项安全复核；
- [ ] 公开发布所需许可证、SECURITY 与 CI 决策完成。

## 当前已知阻断项

1. 本机社区样例审计最近结果为 9 通过、1 失败、5 待补、4 不适用；失败项是 NSFW 重前端预设样例文件路径失效。
2. 自动化测试不能替代浏览器真实流程、真实 Provider、长对话连续性和恢复演练。
3. 许可证、SECURITY 安全响应边界和持续集成门禁尚未完成，因此本候选不能直接晋升公开稳定版。

## 2026-08-05 冻结验证记录

- `node --test tests/releaseCheck.test.js`：4/4 通过；
- `npm test`：967/967 通过；
- `npm run test:compatibility`：98/98 通过；
- `npm run repository:check`：通过；
- `git diff --check`：通过；
- 提交前 `node scripts/release-check.mjs`：按设计阻断，识别到 23 个里程碑关键文件尚未被 Git 跟踪；
- 基线提交 `4399be9` 后 `npm run release:check`：通过，包含 967/967 全量测试、仓库边界、干净工作区、版本、数据迁移和备份可读性检查；
- `npm run samples:audit`：9 通过、1 失败、5 待补、4 不适用。

发布控制文件加入后的最终暂存范围为 283 个文件；提交后工作区干净。冻结前原始范围仍以 scope 文档中的 273 项快照为准。

## 执行方式

```bash
npm test
npm run test:compatibility
npm run repository:check
npm run release:check
npm run release:check:local
```

`release:check` 是干净 Git 基线的签发命令，不是开发中的普通测试命令。`release:check:local` 额外读取本机样例 manifest；社区资源本体不得因此进入 Git。

只有上述门禁形成可复查证据后，才允许创建 `v0.6.0-rc.1` 标签；只有 RC 关键路径稳定后，才晋升 `v0.6.0`。
