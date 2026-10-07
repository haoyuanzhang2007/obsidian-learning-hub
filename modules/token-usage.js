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

// One renderer for streaming progress, results, conversations and notices.
// Token consumption is reported usage, not the account's remaining allowance.
function renderTokenUsage(host, value, {provider='Codex', billing=null, historicalEstimate=false, translate=tr, showEmpty=false}={}) {
  if(!host)return null;
  const normalized=provider==='Codex'?normalizeCodexUsage(value):normalizeDeepSeekUsage(value);
  const signature=JSON.stringify([value,provider,billing,historicalEstimate,showEmpty,translate('本次用量')]);
  if(host._lhUsageSignature===signature)return host._lhUsageRendered;
  host._lhUsageSignature=signature;
  const wasOpen=!!host.querySelector?.('.lh-token-usage')?.open;
  host._lhUsageRendered=null;
  host.empty();
  host.hidden=!normalized&&!showEmpty;
  if(!normalized){if(showEmpty)host.createSpan({text:translate(provider==='Codex'?'Codex 本次没有返回 token 用量数据。':'DeepSeek 本次未返回 token 用量数据。'),cls:'lh-token-empty'});return null;}
  const block=provider==='Codex'?normalized.last:normalized;
  const count=n=>n===null||n===undefined?'—':Number(n).toLocaleString('en-US');
  const total=block.totalTokens??(block.inputTokens!==null&&block.outputTokens!==null?block.inputTokens+block.outputTokens:null);
  const box=host.createEl('details',{cls:'lh-token-usage'});box.open=wasOpen;
  const summary=box.createEl('summary',{attr:{'aria-label':translate('查看用量')}});
  summary.createSpan({text:provider,cls:'lh-token-provider'});
  const metric=(label,value,primary=false)=>{const cell=summary.createSpan({cls:'lh-token-metric'+(primary?' is-primary':'')});cell.createSpan({text:label,cls:'lh-token-label'});cell.createEl('strong',{text:value});};
  metric(translate('本次用量'),count(total)+' tokens',true);
  if(block.inputTokens!==null)metric(translate('输入'),count(block.inputTokens));
  if(block.outputTokens!==null)metric(translate('输出'),count(block.outputTokens));
  if(billing&&Number.isFinite(billing.amount))metric(translate(historicalEstimate?'按现价估算':'估算费用'),'¥'+billing.amount.toFixed(billing.amount<.0001?6:4));
  summary.createSpan({cls:'lh-token-chevron',attr:{'aria-hidden':'true'}});
  const body=box.createDiv({cls:'lh-token-body'});
  const section=(title,usage)=>{const group=body.createDiv({cls:'lh-token-section'});group.createDiv({text:translate(title),cls:'lh-token-section-title'});const grid=group.createDiv({cls:'lh-token-grid'});for(const [label,key] of [['总计','totalTokens'],['输入','inputTokens'],['输出','outputTokens'],['缓存命中','cachedInputTokens'],[provider==='Codex'?'缓存写入':'缓存未命中','cacheWriteInputTokens'],['推理','reasoningOutputTokens']]){if(usage[key]===null)continue;const cell=grid.createDiv({cls:'lh-token-detail'});cell.createSpan({text:translate(label)});cell.createEl('strong',{text:count(usage[key])});}};
  section('本次用量',block);
  if(provider==='Codex'){
    if(Object.values(normalized.total).some(n=>n!==null))section('线程累计用量',normalized.total);
    if(normalized.modelContextWindow!==null){const line=body.createDiv({cls:'lh-token-note'});line.createSpan({text:translate('模型上下文窗口')});line.createEl('strong',{text:count(normalized.modelContextWindow)+' tokens'});}
  }
  return host._lhUsageRendered={box,body,usage:normalized};
}

module.exports = { renderTokenUsage, normalizeUsageBlock, normalizeCodexUsage, formatCodexUsage, normalizeDeepSeekUsage, formatDeepSeekUsage };
