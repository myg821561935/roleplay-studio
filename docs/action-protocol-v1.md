# LRA Action Protocol v1

`lra.action/v1` 是模型叙事与本地世界状态之间的声明式动作协议。正文仍由模型自由创作，状态变化必须放在隐藏动作块中，由服务端校验和裁定后才能生效。

## 输出格式

模型可以在回复末尾追加以下区块。网页只显示区块外的叙事正文。

````text
```lra-actions
{
  "protocol": "lra.action/v1",
  "actorId": "xianxia-suyuebai",
  "summary": "苏月白决定隐瞒伤者身份",
  "baseRevision": 7,
  "actions": [
    {
      "id": "hide-patient",
      "type": "actor.status",
      "actorId": "xianxia-suyuebai",
      "value": "秘密转移伤者",
      "visibility": "private",
      "reason": "避免戒律堂提前介入"
    }
  ]
}
```
````

也兼容 `<lra-actions>...</lra-actions>`。动作块不是脚本，不允许声明函数、命令、网络请求或任意可执行路径。

## 动作类型

| 类型 | 用途 |
|---|---|
| `state.set` | 设置允许范围内的世界状态字段 |
| `state.increment` | 增减数值状态 |
| `state.append` | 向数组追加唯一值 |
| `state.remove` | 从数组移除值 |
| `actor.move` | 更新角色位置 |
| `actor.status` | 更新角色当前状态 |
| `actor.knowledge.add` | 增加公开或私有知识 |
| `actor.relationship.adjust` | 调整角色关系中的信任与紧张 |
| `quest.update` | 更新任务状态 |
| `clock.advance` | 推进世界时钟并触发跨过的 NPC 日程 |

## 裁定规则

- `baseRevision` 必须与当前世界修订一致；旧分支动作会以 `REVISION_CONFLICT` 拒绝。
- 动作路径必须命中允许列表，原型链、可执行配置和未知动作类型会被拒绝。
- 每个动作可携带前置条件。条件失败只拒绝对应动作，并在事件账本记录原因。
- 裁定结果记录精确的 `before`、`after`、可见性与原因，供回放和审计使用。
- 重新生成、切换 Swipe 或编辑旧消息时，世界状态从基线按当前分支重新播放，避免旧回复留下残余状态。

## 可见性

- `public`：可进入公开视图和正文上下文。
- `private`：仅供对应角色动机和信息边界使用。
- `director`：仅在幕后创作视图中显示。

公开 API 投影会移除私有知识、非公开日程、幕后议程和对应事件效果。私有数据仍保存在本地会话中。

## 本地 API

| 路径 | 方法 | 说明 |
|---|---|---|
| `/api/sessions/:id/simulation` | `GET` | 获取世界时钟与 NPC 快照，支持 `view=director|public` |
| `/api/sessions/:id/events` | `GET` | 获取事件账本，支持视图和 `limit` |
| `/api/sessions/:id/actions/preview` | `POST` | 试算动作，不写入会话 |
| `/api/sessions/:id/actions/commit` | `POST` | 裁定并提交创作者动作 |
| `/api/sessions/:id/simulation/actors` | `PUT` | 保存 NPC 注册表 |
| `/api/sessions/:id/simulation/advance` | `POST` | 推进世界时钟并执行日程 |

所有修改接口继续使用本项目的本地来源校验与 JSON 请求约束。

## v1.1 候选版：有证据的承诺与物品

新增 `commitment.update`、`item.register`、`item.move` 和 `item.transfer`，仍使用 `lra.action/v1`。这些动作要求 `evidence: { source: "user" | "assistant", quote: "本轮逐字原文" }`。原文存在并不等于行动发生：对白里的请求、计划、否定或假设不能作为物品已移动的证明。

承诺字段为 `commitmentId`、`title`、`terms`、`counterparty`、`status`。状态依次为 `proposed`、`committed`、`executed`，拒绝使用 `rejected`。原条件不可原地改写；新方案另建提议。玩家明确同意与履行动作分别校验。

物品移动使用当前记录的 `itemId`，以及 `quantity`、`actor`、`holder`、`location`。`holder: ""` 表示放置中；`container` 可表示物品仍在某容器内。移动保留原所有者、必要时拆分批次；只有明确赠送的 `item.transfer` 加上 `owner` 才能改变所有权。不能用 `register` 重复创建已登记物品来补背包。

原文中的物品代称需由现有记录和上下文明确定位。多个非等价对象均符合时不猜测。保管时所有权仍在原主人，整匣移到桌面也不等于物品已经出匣。`protagonist.inventory`、资源账和承诺视图由同一记录投影；启用后的记录不可用自由状态写入覆盖。
