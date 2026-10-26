/* =====================================================================
 * coze.js · Coze v3 Chat API 适配器（最小实现）
 * ---------------------------------------------------------------------
 * 【未联调，需按官方文档核对】
 * 本文件按 Coze v3 Chat API 的公开形态编写：
 *   POST   /v3/chat
 *   GET    /v3/chat/retrieve?conversation_id=...&chat_id=...
 *   GET    /v3/chat/message/list?conversation_id=...&chat_id=...
 * 因为本机没有 Coze 凭据、也没有可用的网络环境，这条链路没有做过真实
 * 调用验证；接入前请对照 Coze 最新官方文档核对字段名、鉴权与错误码。
 *
 * 环境变量：COZE_API_TOKEN、COZE_BOT_ID、COZE_BASE_URL（默认 https://api.coze.cn）。
 * ===================================================================== */
'use strict';

const DEFAULT_BASE_URL = 'https://api.coze.cn';
const DEFAULT_TIMEOUT_MS = 18000;
const POLL_INTERVAL_MS = 600;
const MAX_POLLS = 20;

function providerError(code, message, cause) {
  const err = new Error(message);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}

function trimBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '') || DEFAULT_BASE_URL;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(providerError('UPSTREAM_TIMEOUT', 'Coze 请求已超时'));
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(providerError('UPSTREAM_TIMEOUT', 'Coze 请求已超时'));
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function readJson(response, what) {
  try {
    return await response.json();
  } catch (err) {
    throw providerError('INVALID_OUTPUT', 'Coze ' + what + '响应不是合法 JSON', err);
  }
}

function assertOk(response, payload, what) {
  if (!response || !response.ok) {
    const status = response && response.status ? response.status : 'unknown';
    throw providerError('UPSTREAM_ERROR', 'Coze ' + what + '返回 HTTP ' + status);
  }
  if (payload && payload.code !== undefined && payload.code !== 0) {
    // Coze 的错误消息里不含密钥；只保留 code，不把上游原文直接透出给用户。
    throw providerError('UPSTREAM_ERROR', 'Coze ' + what + '返回业务错误码 ' + payload.code);
  }
}

function findAnswer(messages) {
  if (!Array.isArray(messages)) return null;
  const answer = messages.find(item => item && item.role === 'assistant' && item.type === 'answer')
    || messages.find(item => item && item.role === 'assistant');
  return answer && typeof answer.content === 'string' ? answer.content : null;
}

/**
 * @param {{
 *   apiToken: string,
 *   botId: string,
 *   baseUrl?: string,
 *   userId?: string,
 *   prompt: string,
 *   timeoutMs?: number,
 *   fetchImpl?: Function
 * }} options
 * @returns {Promise<string>} 模型返回的文本
 */
async function callLLM(options) {
  const opts = options || {};
  const apiToken = typeof opts.apiToken === 'string' ? opts.apiToken.trim() : '';
  const botId = typeof opts.botId === 'string' ? opts.botId.trim() : '';
  const prompt = opts.prompt;
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
    ? Math.floor(opts.timeoutMs)
    : DEFAULT_TIMEOUT_MS;

  if (!apiToken || !botId) {
    throw providerError(
      'REMOTE_NOT_CONFIGURED',
      'Coze 未配置（需要 COZE_API_TOKEN、COZE_BOT_ID）'
    );
  }
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw providerError('INVALID_OUTPUT', 'Coze 调用缺少 prompt');
  }

  const fetchImpl = typeof opts.fetchImpl === 'function' ? opts.fetchImpl : globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw providerError('UPSTREAM_ERROR', '当前 Node 运行环境没有可用的 fetch');
  }

  const baseUrl = trimBaseUrl(opts.baseUrl);
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + apiToken
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = controller.signal;

  try {
    let response;
    try {
      response = await fetchImpl(baseUrl + '/v3/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          bot_id: botId,
          user_id: opts.userId || 'citywalk-anonymous',
          stream: false,
          additional_messages: [
            { role: 'user', content: prompt, content_type: 'text' }
          ]
        }),
        signal
      });
    } catch (err) {
      if (signal.aborted || (err && err.name === 'AbortError')) {
        throw providerError('UPSTREAM_TIMEOUT', 'Coze 请求超时', err);
      }
      throw providerError('UPSTREAM_ERROR', 'Coze 网络请求失败', err);
    }

    const chatPayload = await readJson(response, 'chat');
    assertOk(response, chatPayload, 'chat');

    const chat = (chatPayload && chatPayload.data) || {};
    const conversationId = chat.conversation_id || chat.conversationId;
    const chatId = chat.id || chat.chat_id || chat.chatId;
    let messages = Array.isArray(chat.messages) ? chat.messages : null;
    let status = chat.status;

    // 非流式 POST 仍可能返回 in_progress；按官方建议轮询 retrieve。
    for (let i = 0; !messages && conversationId && chatId && i < MAX_POLLS; i += 1) {
      if (status && ['completed', 'failed', 'canceled', 'requires_action'].indexOf(status) >= 0) break;
      await sleep(POLL_INTERVAL_MS, signal);
      const url = baseUrl + '/v3/chat/retrieve?conversation_id='
        + encodeURIComponent(conversationId) + '&chat_id=' + encodeURIComponent(chatId);
      let retrieveResponse;
      try {
        retrieveResponse = await fetchImpl(url, { method: 'GET', headers, signal });
      } catch (err) {
        if (signal.aborted || (err && err.name === 'AbortError')) {
          throw providerError('UPSTREAM_TIMEOUT', 'Coze 轮询超时', err);
        }
        throw providerError('UPSTREAM_ERROR', 'Coze 轮询请求失败', err);
      }
      const retrievePayload = await readJson(retrieveResponse, 'retrieve');
      assertOk(retrieveResponse, retrievePayload, 'retrieve');
      const data = (retrievePayload && retrievePayload.data) || {};
      status = data.status || status;
      if (Array.isArray(data.messages)) messages = data.messages;
    }

    if (!messages && conversationId && chatId) {
      if (status && status !== 'completed') {
        throw providerError('UPSTREAM_ERROR', 'Coze 会话未完成（status=' + status + '）');
      }
      const url = baseUrl + '/v3/chat/message/list?conversation_id='
        + encodeURIComponent(conversationId) + '&chat_id=' + encodeURIComponent(chatId);
      let listResponse;
      try {
        listResponse = await fetchImpl(url, { method: 'GET', headers, signal });
      } catch (err) {
        if (signal.aborted || (err && err.name === 'AbortError')) {
          throw providerError('UPSTREAM_TIMEOUT', 'Coze 消息拉取超时', err);
        }
        throw providerError('UPSTREAM_ERROR', 'Coze 消息拉取失败', err);
      }
      const listPayload = await readJson(listResponse, 'message/list');
      assertOk(listResponse, listPayload, 'message/list');
      messages = (listPayload && listPayload.data) || [];
    }

    const content = findAnswer(messages);
    if (!content || !content.trim()) {
      throw providerError('INVALID_OUTPUT', 'Coze 没有返回可用的 assistant content');
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  id: 'coze',
  callLLM
};
