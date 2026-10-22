# 社区叙事内容包与多 Agent 角色卡创作规范 v1 (Community Content Specification v1)

## 1. 适用范围

本文档面向第三方创作者、跑团 DM 与 Mod 开发者，定义如何在角色剧场（Roleplay Studio）生态中制作高质量、强兼容、具备多 Agent 协同能力的**角色卡、伴生世界书、题材内容包与 Prompt 预设**。

---

## 2. 角色卡规范 (Character Card Spec)

### 2.1 基础规范
- 格式兼容 **Character Card V2** 与 PNG 隐写卡（tEXt/iTXt chunk）。
- 必需字段：
  - `name`: 角色全名与常用称呼。
  - `description`: 角色外貌、核心身份、性格特质与行为模式。
  - `personality`: 核心心理驱动力、价值观冲突与禁忌线。
  - `scenario`: 初始入场场景或世界开局情境。
  - `first_mes`: 高沉浸度开局第一幕正文，建议包含旁白描写与破局对白。

### 2.2 角色剧场特有扩展字段 (`extensions`)
```json
{
  "extensions": {
    "genre": "xianxia",
    "companionWorldbooks": ["lingxu-sect-lore", "nine-heavens-alchemy"],
    "narrativeControl": {
      "speechStyle": "清冷克制，少用虚词，称呼主角为道友或剑主",
      "forbiddenThemes": ["脱离时代的现代科技网络梗", "无因破境"],
      "psychologicalTiers": [
        { "level": 1, "threshold": "陌生/防备", "clues": "言辞简短，保持剑鞘未松" },
        { "level": 2, "threshold": "并肩/信任", "clues": "主动吐露昔年旧案秘密" },
        { "level": 3, "threshold": "生死托付", "clues": "愿以本命飞剑相托" }
      ]
    },
    "visualPreset": {
      "defaultBackground": "xianxia-mist-mountain",
      "portraits": {
        "calm": "assets/portraits/calm.png",
        "combat": "assets/portraits/combat.png",
        "wounded": "assets/portraits/wounded.png"
      }
    }
  }
}
```

---

## 3. 世界书与条目标注规范 (Lorebook Specification)

### 3.1 词条结构
- `keys` (Primary Keys)：核心触发词，支持精确词与正则表达式（如 `/赤霄(剑|宗|令)/`）。
- `secondary_keys` (Filter Keys)：二级过滤词，支持 `AND_ANY`（与任一）、`NOT_ALL`（非全部）等逻辑。
- `selectiveLogic`：`0` (AND ANY), `1` (NOT ALL), `2` (NOT ANY), `3` (AND ALL)。
- `scan_depth`：扫描深度（以消息为单位，0 表示仅允许递归激活）。
- `insertion_order` 与 `priority`：控制进入 Prompt 上下文时的排序权重。

### 3.2 伴生世界书（Companion Worldbook）
- 角色卡附带的专属世界书建议包含：
  1. **宗门/家族背景**（Faction & Background）
  2. **专属功法/武器设定**（Spells & Artifacts）
  3. **核心人际关系网**（Relationships: 仇敌、师承、故旧）

---

## 4. 推荐行动（Recommended Actions）设计准则

优秀的推荐行动能够显著提升互动节奏与易用度：
- **数量推荐**：每轮提供 3-5 项高质量行动。
- **类型覆盖**：
  1. **推进型（Narrative Push）**：如“追问当年真相”、“拔剑斩破禁制”。
  2. **情感/心理型（Emotional Probe）**：如“递上一方锦帕，试探其神情”。
  3. **观察/环境型（Environment Exploration）**：如“环顾四周阵法残纹，寻找退路”。
- **语法规范**：以动词打头、短小精悍（10-18 字以内）。

---

## 5. 安全与沙箱守则

1. **禁止原生 DOM 劫持**：所有前端展示均在受控模板与安全转义容器中渲染。
2. **第三方脚本审计**：任何随卡携带的 JavaScript 必须通过内容哈希绑定，并在受限 Web Worker 沙箱中运行，严禁无限制联网与读取敏感配置。
