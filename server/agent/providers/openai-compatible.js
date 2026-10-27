/* =====================================================================
 * openai-compatible.js · OpenAI 兼容 Chat Completions 适配器
 * ---------------------------------------------------------------------
 * 只依赖 Node 内置 fetch。支持 OpenAI / DeepSeek / 通义 / 本地 vLLM 等
 * 提供 /chat/completions 的服务。密钥只来自服务端环境变量。
 *
 * 约定：callLLM() 只负责「拿到模型文本」；JSON 解析、结构校验、
 * 数值重算全部由 agent/run.js 完成。
 * ===================================================================== */
'use strict';

const DEFAULT_TIMEOUT_MS = 18000;

function providerError(code, message, cause) {
  const err = new Error(message);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}

function trimBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

/**
 * @param {{
 *   baseUrl: string,
 *   apiKey: string,
 *   model: string,
 *   prompt: string,
 *   system?: string,
 *   timeoutMs?: number,
 *   fetchImpl?: Function
 * }} options
 * @returns {Promise<string>} 模型返回的文本（通常是 JSON 字符串）
 */
async function callLLM(options) {
  const opts = options || {};
  const baseUrl = trimBaseUrl(opts.baseUrl);
  const apiKey = typeof opts.apiKey === 'string' ? opts.apiKey.trim() : '';
  const model = typeof opts.model === 'string' ? opts.model.trim() : '';
  const prompt = opts.prompt;
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
    ? Math.floor(opts.timeoutMs)
    : DEFAULT_TIMEOUT_MS;

  if (!baseUrl || !apiKey || !model) {
    throw providerError(
      'REMOTE_NOT_CONFIGURED',
      '远程模型未配置（需要 LLM_BASE_URL、LLM_API_KEY、LLM_MODEL）'
    );
  }
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw providerError('INVALID_OUTPUT', '远程调用缺少 prompt');
  }

  const fetchImpl = typeof opts.fetchImpl === 'function' ? opts.fetchImpl : globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw providerError('UPSTREAM_ERROR', '当前 Node 运行环境没有可用的 fetch');
  }

  const messages = [];
  if (typeof opts.system === 'string' && opts.system.trim()) {
    messages.push({ role: 'system', content: opts.system });
  }
  messages.push({ role: 'user', content: prompt });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response;
    try {
      response = await fetchImpl(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
          response_format: { type: 'json_object' }
        }),
        signal: controller.signal
      });
    } catch (err) {
      if (controller.signal.aborted || (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR'))) {
        throw providerError('UPSTREAM_TIMEOUT', '远程模型请求超时', err);
      }
      throw providerError('UPSTREAM_ERROR', '远程模型网络请求失败', err);
    }

    if (!response || !response.ok) {
      const status = response && response.status ? response.status : 'unknown';
      throw providerError('UPSTREAM_ERROR', '远程模型返回 HTTP ' + status);
    }

    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      throw providerError('INVALID_OUTPUT', '远程模型响应不是合法 JSON', err);
    }

    const content = payload
      && payload.choices
      && payload.choices[0]
      && payload.choices[0].message
      && payload.choices[0].message.content;

    if (typeof content !== 'string' || !content.trim()) {
      throw providerError('INVALID_OUTPUT', '远程模型没有返回可用的 content');
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  id: 'openai-compatible',
  callLLM
};
