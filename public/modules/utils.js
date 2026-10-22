// 纯工具函数：不依赖 state/els/document 等任何运行时上下文。
// 从 app.js 抽取，便于复用与测试。

export function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

export function escapeHtmlText(value) {
  return String(value == null ? '' : value).replace(/[<>&"']/g, (character) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

export function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

export function normalizeTokenNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.ceil(number);
}

export function normalizeProviderReasoningMode(value) {
  const mode = String(value || 'auto').trim().toLowerCase();
  return ['auto', 'enabled', 'disabled'].includes(mode) ? mode : 'auto';
}

export function formatTokenCount(value) {
  return new Intl.NumberFormat('zh-CN').format(normalizeTokenNumber(value));
}

export function humanizeApiError(error) {
  if (error.code === 'PROMPT_BUDGET_INSUFFICIENT') return error.message && error.message !== error.code ? error.message : '上下文预算不足，请在会话设置提高预算，或减少启用的预设与世界书；本轮尚未调用 Provider。';
  if (error.code === 'NO_ACTIVE_PROVIDER') return '未配置可用 Provider';
  if (error.code === 'CANNOT_DELETE_MAIN_SESSION') return '默认会话不可删除';
  if (error.code === 'FORK_MESSAGE_NOT_FOUND') return '找不到要分支的消息';
  if (error.code === 'BRANCH_NOT_FOUND') return '分支不存在';
  if (error.code === 'CANNOT_DELETE_ROOT_BRANCH') return '主线分支不可删除';
  if (error.code === 'CANNOT_DELETE_ACTIVE_BRANCH') return '不能删除当前活跃分支，请先切换到其他分支';
  if (error.code === 'BRANCH_HAS_CHILDREN') return '该分支下还有子分支，请先删除子分支';
  if (error.code === 'MISSING_MESSAGE_ID') return '缺少消息标识';
  if (error.code === 'MISSING_BRANCH_LABEL') return '分支名不能为空';
  if (error.code === 'INVALID_BRANCH_ID') return '无效的分支标识';
  if (error.code === 'SESSION_NOT_FOUND') return '会话不存在';
  if (error.code === 'EMPTY_REWRITE_TEXT') return '请先输入要润色的内容';
  if (error.code === 'PROVIDER_ERROR') return 'Provider 调用失败';
  if (error.code === 'PROVIDER_QUOTA_EXHAUSTED') return 'Provider 额度不足，请充值或切换 Provider';
  if (error.code === 'PROVIDER_REASONING_ONLY_RESPONSE') return '模型只返回了推理过程，没有生成剧情正文；若为 DeepSeek，请在 Provider 将思考模式设为“关闭”，或停用预设中的显式思维链模块并提高 Max Tokens';
  if (error.code === 'PROVIDER_EMPTY_RESPONSE') return '模型没有返回可显示的剧情正文，请重试或切换模型';
  if (error.code === 'PROVIDER_TEST_FAILED') return error.message || 'Provider 连接测试失败';
  if (error.code === 'BACKUP_NOT_FOUND') return '备份不存在';
  if (error.code === 'BACKUP_CHECKSUM_MISMATCH') return '备份校验失败，文件可能已损坏';
  if (error.code === 'BACKUP_OPERATION_IN_PROGRESS') return '已有备份或恢复操作正在执行';
  if (error.code === 'BACKUP_TOO_LARGE') return '备份范围过大，请先在“数据与发布”中导出或清理旧素材后重试';
  if (error.code === 'BACKUP_SCOPED_SCHEMA_MISMATCH') return '该范围备份来自旧版数据结构，请升级后使用完整备份恢复';
  if (typeof error.code === 'string' && error.code.startsWith('BACKUP_')) return `备份操作失败：${error.code}`;
  if (error.code === 'UNSUPPORTED_MEDIA_TYPE') return '请求格式错误';
  if (error.code === 'INVALID_IMPORT_PAYLOAD') return '无法识别导入文件，请确认是 Character Card V2/V3 PNG/JSON、YAML 角色卡、世界书 JSON/文本、SillyTavern Prompt/Regex 预设或叙界内容包';
  if (error.code === 'IMPORT_SOURCE_NOT_FOUND') return '未知素材源';
  if (error.code === 'IMPORT_SOURCE_SEARCH_FAILED') return '素材源搜索失败';
  if (error.code === 'IMPORT_SOURCE_DOWNLOAD_FAILED') return '素材下载失败';
  if (error.code === 'IMPORT_SOURCE_DOWNLOAD_UNAVAILABLE') return '该素材没有可用下载地址';
  if (error.code === 'IMPORT_SOURCE_URL_NOT_ALLOWED') return '下载地址不在该素材源白名单内';
  if (error.code === 'IMPORT_SOURCE_PREVIEW_FAILED') return '下载成功，但无法识别为支持的角色卡、世界书或预设';
  if (error.code === 'IMPORT_SOURCE_FILE_TOO_LARGE') return '素材文件过大';
  if (error.code === 'IMPORT_UPLOAD_EMPTY') return '所选文件为空';
  if (error.code === 'IMPORT_UPLOAD_EXPIRED') return '导入暂存已过期，请重新选择文件';
  if (error.code === 'CHARACTER_IMAGE_TOO_LARGE') return '角色立绘体积过大；请压缩图片后重新导入';
  if (error.code === 'IMPORT_SOURCE_TIMEOUT') return '素材源响应超时';
  if (error.code === 'IMPORT_SOURCE_NETWORK_FAILED') return '素材源网络访问失败';
  return error.message;
}
