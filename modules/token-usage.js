const { t: tr } = require('./i18n');
function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : null;
}

function normalizeUsageBlock(value = {}) {
  const read = (...keys) => {
    for (const key of keys) {
      const number = numberOrNull(value?.[key]);
      if (number !== null) return number;
    }
    return null;
  };
  return {
    totalTokens: read('totalTokens', 'total_tokens'),
    inputTokens: read('inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens'),
    cachedInputTokens: read('cachedInputTokens', 'cached_input_tokens', 'prompt_cache_hit_tokens', 'cached_tokens'),
    cacheWriteInputTokens: read('cacheWriteInputTokens', 'cache_write_input_tokens', 'prompt_cache_miss_tokens'),
    outputTokens: read('outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens'),
    reasoningOutputTokens: read('reasoningOutputTokens', 'reasoning_output_tokens', 'reasoningTokens', 'reasoning_tokens'),
  };
}

function normalizeCodexUsage(value) {
  if (!value || typeof value !== 'object') return null;
  const total = normalizeUsageBlock(value.total || {});
  const last = normalizeUsageBlock(value.last || {});
  const modelContextWindow = numberOrNull(value.modelContextWindow ?? value.model_context_window);
  if (![...Object.values(total), ...Object.values(last)].some(item => item !== null) && modelContextWindow === null) return null;
  return { total, last, modelContextWindow };
}

function formatTokenCount(value) {
  return value === null || value === undefined ? tr("未提供") : Number(value).toLocaleString('en-US');
}

function formatUsageBlock(value, cacheMissLabel = tr("缓存写入")) {
  const usage = normalizeUsageBlock(value);
  return tr("输入 {0} · 缓存命中 {1} · {2} {3} · 输出 {4}（推理 {5}） · 总计 {6}", [formatTokenCount(usage.inputTokens), formatTokenCount(usage.cachedInputTokens), cacheMissLabel, formatTokenCount(usage.cacheWriteInputTokens), formatTokenCount(usage.outputTokens), formatTokenCount(usage.reasoningOutputTokens), formatTokenCount(usage.totalTokens)]);
}

function formatCodexUsage(value) {
  const usage = normalizeCodexUsage(value);
  if (!usage) return tr("Codex 本次没有返回 token 用量数据。");
  const sections = [tr("本次：{0}", [formatUsageBlock(usage.last)])];
  if (Object.values(usage.total).some(item => item !== null)) sections.push(tr("线程累计：{0}", [formatUsageBlock(usage.total)]));
  if (usage.modelContextWindow !== null) sections.push(tr("模型上下文窗口 {0} tokens", [formatTokenCount(usage.modelContextWindow)]));
  return tr("Codex 用量｜{0}", [sections.join('；')]);
}

function normalizeDeepSeekUsage(value) {
  if (!value || typeof value !== 'object') return null;
  const details = value.completion_tokens_details || value.completionTokensDetails || {};
  const promptDetails = value.prompt_tokens_details || value.promptTokensDetails || {};
  const usage = normalizeUsageBlock({
    ...value,
    inputTokens: value.inputTokens ?? value.prompt_tokens ?? value.promptTokens,
    cachedInputTokens: value.prompt_cache_hit_tokens ?? value.cachedInputTokens ?? promptDetails.cached_tokens,
    cacheWriteInputTokens: value.prompt_cache_miss_tokens ?? value.cacheWriteInputTokens,
    outputTokens: value.outputTokens ?? value.completion_tokens ?? value.completionTokens,
    reasoningOutputTokens: value.reasoningOutputTokens ?? details.reasoning_tokens ?? value.reasoning_tokens ?? value.reasoningTokens,
    totalTokens: value.totalTokens ?? value.total_tokens,
  });
  if(usage.inputTokens===null&&usage.cachedInputTokens!==null&&usage.cacheWriteInputTokens!==null)usage.inputTokens=usage.cachedInputTokens+usage.cacheWriteInputTokens;
  if(usage.cachedInputTokens===null&&usage.inputTokens!==null&&usage.cacheWriteInputTokens!==null&&usage.inputTokens>=usage.cacheWriteInputTokens)usage.cachedInputTokens=usage.inputTokens-usage.cacheWriteInputTokens;
  if(usage.cacheWriteInputTokens===null&&usage.inputTokens!==null&&usage.cachedInputTokens!==null&&usage.inputTokens>=usage.cachedInputTokens)usage.cacheWriteInputTokens=usage.inputTokens-usage.cachedInputTokens;
  if(usage.outputTokens===null&&usage.totalTokens!==null&&usage.inputTokens!==null&&usage.totalTokens>=usage.inputTokens)usage.outputTokens=usage.totalTokens-usage.inputTokens;
  if(usage.totalTokens===null&&usage.inputTokens!==null&&usage.outputTokens!==null)usage.totalTokens=usage.inputTokens+usage.outputTokens;
  return Object.values(usage).some(item => item !== null) ? usage : null;
}

function formatDeepSeekUsage(value) {
  const usage = normalizeDeepSeekUsage(value);
  if (!usage) return tr("DeepSeek 本次未返回 token 用量数据。");
  return tr("DeepSeek 用量｜{0}", [formatUsageBlock(usage, tr("缓存未命中"))]);
}

module.exports = { normalizeUsageBlock, normalizeCodexUsage, formatCodexUsage, normalizeDeepSeekUsage, formatDeepSeekUsage };
