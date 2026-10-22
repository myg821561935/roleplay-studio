import { PLUGIN_SPEC } from './pluginManifest.js';

const ENGINE_RANGE = '>=0.2.2 <2.0.0';

export const BUILTIN_PLUGIN_MANIFESTS = [
  {
    spec: PLUGIN_SPEC,
    id: 'core.character-card-v2',
    version: '1.1.0',
    name: 'Character Card V2/V3 适配',
    description: '兼容 SillyTavern 等客户端使用的 V2/V3 PNG 内嵌或 JSON 角色卡。',
    engine: ENGINE_RANGE,
    adapters: [{
      id: 'character-card-v2',
      version: '1.1.0',
      label: 'Character Card V2/V3',
      kinds: ['character'],
      formats: ['png', 'json'],
      priority: 100,
      capabilities: ['inspect', 'normalize'],
      match: { previewKinds: ['character-card'], sourceSpecIncludes: ['chara_card_v2', 'chara_card_v3'] }
    }]
  },
  {
    spec: PLUGIN_SPEC,
    id: 'core.sillytavern-lorebook',
    version: '1.0.0',
    name: 'SillyTavern 世界书适配',
    description: '保留关键词、正则、逻辑、优先级和插入深度。',
    engine: ENGINE_RANGE,
    adapters: [{
      id: 'sillytavern-lorebook',
      version: '1.0.0',
      label: 'SillyTavern 世界书',
      kinds: ['worldbook'],
      formats: ['json'],
      priority: 80,
      capabilities: ['inspect', 'normalize'],
      match: { previewKinds: ['world-book'] }
    }]
  },
  {
    spec: PLUGIN_SPEC,
    id: 'core.sillytavern-preset',
    version: '1.0.0',
    name: 'SillyTavern Prompt 预设适配',
    description: '保留提示词顺序、角色、插入位置与生成参数；安全映射配套 Regex，酒馆助手脚本保持禁用。',
    engine: ENGINE_RANGE,
    adapters: [{
      id: 'sillytavern-prompt-preset',
      version: '1.0.0',
      label: 'SillyTavern Prompt 预设',
      kinds: ['prompt'],
      formats: ['json'],
      priority: 180,
      capabilities: ['inspect', 'normalize', 'prompt-order', 'generation-settings', 'dependency-report'],
      match: { previewKinds: ['prompt-preset'] }
    }, {
      id: 'sillytavern-regex-preset',
      version: '1.0.0',
      label: 'SillyTavern Regex 配套规则',
      kinds: ['prompt'],
      formats: ['json'],
      priority: 185,
      capabilities: ['inspect', 'normalize', 'safe-regex-runtime', 'dependency-report'],
      match: { previewKinds: ['regex-preset'] }
    }]
  },
  {
    spec: PLUGIN_SPEC,
    id: 'core.text-resource',
    version: '1.0.0',
    name: '文本与 YAML 素材适配',
    description: '为常见纯文本、YAML 和通用 JSON 素材提供回退识别。',
    engine: ENGINE_RANGE,
    adapters: [{
      id: 'text-yaml-resource',
      version: '1.0.0',
      label: '文本 / YAML 素材',
      kinds: ['character', 'worldbook', 'prompt'],
      formats: ['txt', 'yaml', 'yml', 'json'],
      priority: 1,
      capabilities: ['inspect', 'normalize'],
      match: { previewKinds: ['character-card', 'world-book', 'prompt-module', 'prompt-preset', 'regex-preset'], fallback: true }
    }]
  },
  {
    spec: PLUGIN_SPEC,
    id: 'community.liunao',
    version: '1.0.0',
    name: '类脑社区通用适配',
    description: '将类脑社区资源归一化为内部角色、世界书与 Prompt 格式。',
    engine: ENGINE_RANGE,
    adapters: [{
      id: 'liunao-community-generic',
      version: '1.0.0',
      label: '类脑社区通用适配',
      kinds: ['character', 'worldbook', 'prompt'],
      formats: ['png', 'json', 'txt', 'yaml', 'yml'],
      priority: 120,
      capabilities: ['inspect', 'normalize', 'provenance'],
      match: {
        previewKinds: ['character-card', 'world-book', 'prompt-module', 'prompt-preset', 'regex-preset'],
        sourceIncludes: ['类脑', 'liunao']
      }
    }]
  },
  {
    spec: PLUGIN_SPEC,
    id: 'core.content-pack-v1',
    version: '1.0.0',
    name: 'LRA 内容包适配',
    description: '识别、校验并安装 lra.content-pack/v1 自包含剧本包。',
    engine: ENGINE_RANGE,
    adapters: [{
      id: 'lra-content-pack-v1',
      version: '1.0.0',
      label: 'LRA Content Pack v1',
      kinds: ['content-pack'],
      formats: ['json'],
      priority: 200,
      capabilities: ['inspect', 'dependencies', 'install', 'export'],
      match: { previewKinds: ['content-pack'] }
    }]
  },
  {
    spec: PLUGIN_SPEC,
    id: 'core.plugin-manifest-v1',
    version: '1.0.0',
    name: 'LRA 插件清单适配',
    description: '识别并安装不含可执行代码的 lra.plugin/v1 声明式插件。',
    engine: ENGINE_RANGE,
    adapters: [{
      id: 'lra-plugin-manifest-v1',
      version: '1.0.0',
      label: 'LRA Plugin Manifest v1',
      kinds: ['plugin'],
      formats: ['json'],
      priority: 200,
      capabilities: ['inspect', 'dependencies', 'install'],
      match: { previewKinds: ['plugin-manifest'] }
    }]
  }
];
