const { t: tr } = require('./i18n');
// A small, read-only Codex App Server client. The plugin owns all vault writes;
// model output is data to review, never a command to apply automatically.
const { spawn } = require('child_process');
const path = require('path');

const DEFAULT_EXECUTABLE = 'codex';
function abortError() { const error = new Error(tr('已停止生成。')); error.name = 'AbortError'; return error; }

class CodexClient {
  constructor(options = {}) {
    this.executable = options.executable || DEFAULT_EXECUTABLE;
    this.cwd = options.cwd;
    this.spawn = options.spawn || spawn;
    this.requestTimeoutMs = options.requestTimeoutMs || 30000;
    this.turnTimeoutMs = options.turnTimeoutMs || 180000;
    this.process = null;
    this.connecting = null;
    this.pending = new Map();
    this.nextId = 1;
    this.stdoutBuffer = '';
    this.stderrTail = '';
    this.activeTurns = new Map();
    this.maxConcurrentTurns = this.normalizeConcurrency(options.maxConcurrentTurns);
    this.runningTurns = 0;
    this.turnWaiters = [];
    this.closed = false;
  }

  normalizeConcurrency(value) {
    const count = Number(value);
    return Number.isInteger(count) ? Math.max(1, Math.min(4, count)) : 2;
  }

  setMaxConcurrentTurns(value) {
    this.maxConcurrentTurns = this.normalizeConcurrency(value);
    this._dispatchTurnWaiters();
  }

  _dispatchTurnWaiters() {
    while (!this.closed && this.runningTurns < this.maxConcurrentTurns && this.turnWaiters.length) {
      const waiter = this.turnWaiters.shift();
      waiter.cleanup?.();
      this.runningTurns++;
      waiter.resolve();
    }
  }

  _acquireTurnSlot(onStatus, signal) {
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.closed) return Promise.reject(new Error(tr("Codex 连接已关闭。")));
    if (this.runningTurns < this.maxConcurrentTurns) {
      this.runningTurns++;
      return Promise.resolve();
    }
    try { onStatus?.('queued'); } catch (_) { /* Status callbacks are optional. */ }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      const abort = () => { this.turnWaiters = this.turnWaiters.filter(item => item !== waiter); waiter.cleanup(); reject(abortError()); };
      waiter.cleanup = () => signal?.removeEventListener('abort', abort);
      this.turnWaiters.push(waiter);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }

  _releaseTurnSlot() {
    this.runningTurns = Math.max(0, this.runningTurns - 1);
    this._dispatchTurnWaiters();
  }

  async connect() {
    if (this.closed) throw new Error(tr("Codex 连接已关闭。"));
    if (this.connecting) return this.connecting;
    this.connecting = this._connect();
    try {
      await this.connecting;
    } catch (error) {
      this.connecting = null;
      throw error;
    }
  }

  async _connect() {
    if (!path.isAbsolute(this.cwd || '')) {
      throw new Error(tr("Codex 工作目录必须是本地 vault 的绝对路径。"));
    }
    const child = this.spawn(this.executable, ['app-server'], {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    this.process = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => this._readStdout(chunk));
    child.stderr.on('data', chunk => {
      // Keep a bounded diagnostic tail; stderr may contain user paths or text.
      this.stderrTail = (this.stderrTail + chunk).slice(-4096);
    });
    child.on('error', error => this._failAll(new Error(tr("无法启动 Codex：{0}", [error.message]))));
    child.on('exit', (code, signal) => {
      const reason = signal ? `信号 ${signal}` : `退出码 ${code}`;
      this._failAll(new Error(tr("Codex 连接中断（{0}）。", [reason])));
    });
    try {
      await this._request('initialize', {
        clientInfo: { name: 'obsidian-learning-hub', version: '0.6.1' },
        capabilities: { experimentalApi: false },
      });
      this._write({ method: 'initialized' });
    } catch (error) {
      child.kill();
      throw error;
    }
  }

  async listModels() {
    await this.connect();
    const models = [];
    let cursor;
    do {
      const result = await this._request('model/list', cursor ? { cursor } : {});
      if (!result || !Array.isArray(result.data)) throw new Error(tr("Codex 返回了无效的模型列表。"));
      models.push(...result.data);
      cursor = result.nextCursor || null;
    } while (cursor);
    return models.filter(model => !model.hidden).map(model => ({
      id: model.model,
      name: model.displayName || model.model,
      isDefault: !!model.isDefault,
      defaultEffort: model.defaultReasoningEffort,
      efforts: (model.supportedReasoningEfforts || []).map(option => option.reasoningEffort || option.effort).filter(Boolean),
    }));
  }

  // Each thread has its own notification route; a small semaphore bounds local
  // resource use while allowing independent Codex turns to run simultaneously.
  async runStructured(options = {}) {
    await this._acquireTurnSlot(options.onStatus, options.signal);
    try { return await this._runStructured(options); }
    finally { this._releaseTurnSlot(); }
  }

  async _runStructured({ prompt, schema, model, effort, timeoutMs, onProgress, onStatus, onReasoningSummary, onTokenUsage, signal } = {}) {
    if (signal?.aborted) throw abortError();
    if (!prompt || typeof prompt !== 'string') throw new Error(tr("Codex 请求缺少提示内容。"));
    if (!schema || typeof schema !== 'object') throw new Error(tr("Codex 请求缺少 JSON 输出结构。"));
    onStatus?.('connecting');
    await this.connect();
    if (signal?.aborted) throw abortError();
    onStatus?.('starting');
    const threadParams = {
      cwd: this.cwd,
      sandbox: 'read-only',
      approvalPolicy: 'never',
      ephemeral: true,
    };
    if (model) threadParams.model = model;
    const started = await this._request('thread/start', threadParams);
    if (signal?.aborted) throw abortError();
    const threadId = started && started.thread && started.thread.id;
    if (!threadId) throw new Error(tr("Codex 未返回会话 ID。"));

    let resolveTurn;
    let rejectTurn;
    const completed = new Promise((resolve, reject) => {
      resolveTurn = resolve;
      rejectTurn = reject;
    });
    // A process failure may reject this before turn/start responds. Mark it as
    // observed now; the original promise is still awaited below.
    completed.catch(() => {});
    const active = {
      threadId,
      turnId: null,
      messages: [],
      onProgress,
      onStatus,
      onReasoningSummary,
      onTokenUsage,
      resolve: resolveTurn,
      reject: rejectTurn,
      timer: null,
    };
    this.activeTurns.set(threadId, active);
    const turnParams = {
      threadId,
      input: [{ type: 'text', text: prompt }],
      cwd: this.cwd,
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      outputSchema: schema,
    };
    if (model) turnParams.model = model;
    if (effort) turnParams.effort = effort;
    // Reasoning summaries are an explicit App Server opt-in. Request one only
    // when the caller can display it; never subscribe the UI to raw reasoning.
    if (onReasoningSummary) turnParams.summary = 'concise';
    const deadline = timeoutMs || this.turnTimeoutMs;
    let cancelled = false, cancellationError;
    const interrupt = () => { if (active.turnId) this._request('turn/interrupt', { threadId, turnId: active.turnId }, 5000).catch(() => {}); };
    const abort = () => { cancelled = true; cancellationError = abortError(); interrupt(); active.reject(cancellationError); };
    signal?.addEventListener('abort', abort, { once: true });
    active.timer = setTimeout(() => {
      cancelled = true;
      if (active.turnId) {
        this._request('turn/interrupt', { threadId, turnId: active.turnId }, 5000).catch(() => {});
      }
      cancellationError = new Error(tr("Codex 生成超过 {0} 分钟，请重试。", [Math.ceil(deadline / 60000)]));
      active.reject(cancellationError);
    }, deadline);
    try {
      const turn = await this._request('turn/start', turnParams);
      active.turnId = turn && turn.turn && turn.turn.id;
      if (cancelled || signal?.aborted) { interrupt(); throw cancellationError || abortError(); }
      onStatus?.('generating');
      const message = await completed;
      try {
        return JSON.parse(message);
      } catch (_) {
        throw new Error(tr("Codex 未返回符合 JSON 格式的草案。"));
      }
    } finally {
      signal?.removeEventListener('abort', abort);
      clearTimeout(active.timer);
      if (this.activeTurns.get(threadId) === active) this.activeTurns.delete(threadId);
    }
  }

  _request(method, params, timeoutMs = this.requestTimeoutMs) {
    if (!this.process) return Promise.reject(new Error(tr("Codex 尚未启动。")));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(tr("Codex 请求超时：{0}", [method])));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this._write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  _write(message) {
    if (!this.process || !this.process.stdin || this.process.stdin.destroyed) {
      throw new Error(tr("Codex 输入管道已关闭。"));
    }
    this.process.stdin.write(JSON.stringify(message) + '\n');
  }

  _readStdout(chunk) {
    this.stdoutBuffer += chunk;
    let end;
    while ((end = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, end).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(end + 1);
      if (!line) continue;
      try {
        this._handleMessage(JSON.parse(line));
      } catch (error) {
        // A malformed line must not crash Obsidian or be treated as model output.
        this._failAll(new Error(tr("Codex 协议消息无效：{0}", [error.message])));
        this.process && this.process.kill();
        return;
      }
    }
  }

  _handleMessage(message) {
    if (Object.prototype.hasOwnProperty.call(message, 'id') && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || tr("Codex 请求失败。")));
      else pending.resolve(message.result);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(message, 'id') && message.method) {
      // Read-only, approval-free turns should not need a client action. Reply so
      // unexpected server requests cannot leave the turn hanging indefinitely.
      this._write({ id: message.id, error: { code: -32601, message: 'Unsupported client request' } });
      return;
    }
    const active = message.params?.threadId ? this.activeTurns.get(message.params.threadId) : null;
    if (!active) return;
    if (active.turnId && message.params.turnId && message.params.turnId !== active.turnId) return;
    if (message.method === 'thread/tokenUsage/updated') {
      const usage = message.params.tokenUsage;
      active.tokenUsage = usage;
      try { active.onTokenUsage?.(usage); } catch (_) { /* UI callback is optional. */ }
    } else if (message.method === 'item/reasoning/summaryTextDelta') {
      try { active.onStatus?.('thinking'); } catch (_) { /* UI callback is optional. */ }
      if (typeof active.onReasoningSummary === 'function' && typeof message.params.delta === 'string') {
        try { active.onReasoningSummary(message.params.delta, message.params.summaryIndex, {itemId:message.params.itemId,turnId:message.params.turnId}); } catch (_) { /* UI callback is optional. */ }
      }
    } else if (message.method === 'item/agentMessage/delta') {
      try { active.onStatus?.('receiving'); } catch (_) { /* UI callback is optional. */ }
      if (typeof active.onProgress === 'function') {
        try { active.onProgress(message.params.delta || ''); } catch (_) { /* UI callback is optional. */ }
      }
    } else if (message.method === 'item/completed') {
      const item = message.params.item;
      if (item && item.type === 'agentMessage' && typeof item.text === 'string') active.messages.push(item.text);
    } else if (message.method === 'turn/completed') {
      const turn = message.params.turn || {};
      if (turn.status !== 'completed') {
        active.reject(new Error(turn.error && turn.error.message || tr("Codex 生成未完成（{0}）。", [turn.status || 'unknown'])));
        return;
      }
      const fromTurn = (turn.items || []).filter(item => item.type === 'agentMessage').map(item => item.text);
      const text = (fromTurn.length ? fromTurn : active.messages).filter(Boolean).at(-1);
      if (text) active.resolve(text);
      else active.reject(new Error(tr("Codex 未返回草案内容。")));
    }
  }

  _failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const active of this.activeTurns.values()) active.reject(error);
    this.activeTurns.clear();
    this.process = null;
    this.connecting = null;
  }

  close() {
    this.closed = true;
    for (const waiter of this.turnWaiters.splice(0)) { waiter.cleanup?.(); waiter.reject(new Error(tr("Codex 连接已关闭。"))); }
    if (this.process) this.process.kill();
    this._failAll(new Error(tr("Codex 连接已关闭。")));
  }
}

module.exports = { CodexClient, DEFAULT_EXECUTABLE };
