# 分层记忆体系与检索标准协议 v1 (Memory Hierarchy Standard v1)

## 1. 概述与设计原则

在长篇角色扮演与世界模拟中，单纯依赖固定上下文滑动窗口（Sliding Window）或纯向量相似度检索（Dense Vector Retrieval）存在以下局限：
- **语义漂移（Semantic Drift）**：向量检索缺乏拓扑约束，易召回表面相似但逻辑矛盾的无效记忆。
- **长程遗忘与时序断层**：滑动窗口无法跨章节保留宏观剧情进展、势力格局与因果债务。
- **幻觉事实污染**：在玩家编辑、重生成或回滚剧情后，废弃分支的记忆碎片若未清理，会形成永久逻辑矛盾。

本协议定义了**“三级时间颗粒度分层（Scene / Chapter / Arc）+ 属性图引导检索（Graph-Guided Retrieval）+ 叙事修复（Narrative Repair）”**的记忆标准架构。

---

## 2. 三级时间颗粒度分层架构

```text
┌────────────────────────────────────────────────────────┐
│                   Arc 纪元 / 卷轴记忆                   │
│      宏观主线转折 · 势力兴衰 · 最终因果定论 · 角色终局命运     │
└───────────────────────────▲────────────────────────────┘
                            │ 周期性升华压缩 (每 5-10 章)
┌───────────────────────────┴────────────────────────────┐
│                  Chapter 章节 / 幕次记忆                 │
│      阶段性冲突与解决 · 关系阶段性转变 · 关键物证与承诺获得    │
└───────────────────────────▲────────────────────────────┘
                            │ 滚动摘要沉淀 (每 10-20 轮)
┌───────────────────────────┴────────────────────────────┐
│                   Scene 场景 / 对话记忆                 │
│      当前在场人物 · 短程对话上下文 · 动作微反应 · 局部线索    │
└────────────────────────────────────────────────────────┘
```

### 2.1 Scene 记忆（场景级）
- **时间范围**：最近 6-12 轮交互。
- **存储内容**：原始消息、角色说话人、即时动作与心理面板（`roleplayPanels`）。
- **淘汰机制**：FIFO 滑动窗口，超出预算后移交滚动摘要器抽取。

### 2.2 Chapter 记忆（章节级）
- **时间范围**：当前幕/当前章节（通常对应 15-30 轮对话）。
- **存储内容**：结构化事实卡片（FactCards）、已发生的关键事件条目（Event Ledgers）、人物好感与阵营变迁。
- **沉淀触发**：由 `SummaryScheduler` 监测对话轮次与 Token 预算，自动调用轻量模型或确定性规则生成。

### 2.3 Arc 记忆（卷轴/纪元级）
- **时间范围**：全篇或跨卷历史。
- **存储内容**：高压缩度编年史（Chronicle）、终局性因果关系、世界状态不可逆标记（World State Flags）。

---

## 3. 图引导检索协议 (Graph-Guided Retrieval Protocol)

为消除纯向量检索的语义漂移，系统在组装上下文时必须按以下三步执行图引导检索：

1. **实体与关系邻域激活 (Subgraph Neighborhood Activation)**：
   - 提取用户输入与当前场景中的命名实体（Entities）。
   - 在 SQLite/属性图网络中以深度 $k \le 2$ 扩展子图，获取直接关联的人物、门派、誓约与事件。
2. **拓扑加权与相似度融合 (Hybrid Scoring Formula)**：
   $$\text{Score}(node) = \alpha \cdot \text{Sim}_{\text{vector}}(q, node) + \beta \cdot \text{Weight}_{\text{graph}}(node) + \gamma \cdot \text{Recency}(node)$$
   - 其中 $\text{Weight}_{\text{graph}}$ 根据实体与主角的亲密度、当前在场状态赋予先验加权。
3. **权威仲裁与预算裁剪 (Authority Arbitration & Budget Pruning)**：
   - 角色卡原生设定 > 世界书条目 > 已确认事件 > 推测事实。
   - 依据 `PromptBudget` 分配的硬性 Token 边界进行保真裁剪。

---

## 4. 叙事修复与一致性保证 (Narrative Repair & Branch Consistency)

当发生消息编辑（Edit）、重生成（Regenerate）或分支滑块切换（Swipe）时：
- **事实作废（Fact Invalidation）**：所有由被废弃消息节点产生的事实卡与图变更提案自动标记为 `invalidated`。
- **回滚重放（Replay Baseline）**：记忆状态重置为回退节点的基线快照，保证后续检索绝不包含平行分支的幻觉内容。

---

## 5. 数据交换 Schema 规范

```typescript
interface MemoryRecord {
  id: string;
  scope: 'scene' | 'chapter' | 'arc';
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  sourceTurn: number;
  sourceSessionId: string;
  invalidated?: boolean;
  timestamp: string;
}

interface FactCard {
  id: string;
  category: 'character' | 'world' | 'relationship' | 'quest';
  title: string;
  facts: string[];
  lastUpdatedTurn: number;
}
```
