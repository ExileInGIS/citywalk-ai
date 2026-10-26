/* =====================================================================
 * config.js · 环境配置加载
 * ---------------------------------------------------------------------
 * 规则：
 *  1. 读取仓库根目录 .env（简单 KEY=VALUE，不引第三方库）；
 *  2. 已经存在的环境变量优先于 .env；
 *  3. 缺少配置时给出安全默认值，默认 mock 模式，零密钥也能跑；
 *  4. 密钥只留在服务端进程内，绝不进入 /api/config 或日志。
 * ===================================================================== */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

let PACKAGE_VERSION = '1.0.0';
try {
  const pkg = require(path.join(ROOT, 'package.json'));
  if (pkg && typeof pkg.version === 'string' && pkg.version) PACKAGE_VERSION = pkg.version;
} catch (_) {
  /* 读取失败时保留默认版本号 */
}

const DEFAULTS = Object.freeze({
  port: 3000,
  nodeEnv: 'development',
  agentMode: 'mock',
  agentTimeoutMs: 18000,
  agentFallback: 'mock',
  rateLimitPerMin: 30,
  corsOrigins: [],
  telemetryEnabled: true,
  logLevel: 'info',
  llm: { baseUrl: '', apiKey: '', model: '' },
  coze: { apiToken: '', botId: '', baseUrl: '' },
  version: PACKAGE_VERSION,
  staticRoot: ROOT,
  promptDir: path.join(ROOT, 'server', 'agent', 'prompts'),
  remoteProvider: null,
  remoteConfigured: false
});

const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'];
const PROVIDER_IDS = ['openai-compatible', 'coze'];

/** 解析 .env 文本；支持 # 注释、export 前缀、单/双引号。 */
function parseEnvFile(text) {
  const out = {};
  String(text == null ? '' : text)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const m = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) return;
      const key = m[1];
      let value = m[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      } else {
        value = value.replace(/\s+#.*$/, '').trim();
      }
      out[key] = value;
    });
  return out;
}

function readEnvFile(file) {
  try {
    if (!fs.existsSync(file)) return {};
    return parseEnvFile(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return {};
  }
}

function firstDefined() {
  for (let i = 0; i < arguments.length; i += 1) {
    const value = arguments[i];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function toBool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return fallback;
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].indexOf(v) >= 0) return true;
  if (['0', 'false', 'no', 'off'].indexOf(v) >= 0) return false;
  return fallback;
}

function toInt(value, fallback, min, max) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.floor(n);
  if (rounded < min || rounded > max) return fallback;
  return rounded;
}

function toStringValue(value, fallback) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function normalizeOrigins(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => (typeof item === 'string' ? item.trim() : ''))
      .filter(item => item && !/[\r\n]/.test(item));
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(item => item.trim())
      .filter(item => item && !/[\r\n]/.test(item));
  }
  return [];
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function llmComplete(llm) {
  return !!(llm && llm.baseUrl && llm.apiKey && llm.model);
}

function cozeComplete(coze) {
  return !!(coze && coze.apiToken && coze.botId);
}

/**
 * 把「部分配置」补全成运行时配置。可重复调用（幂等）。
 * 既接受 loadConfig() 的输出，也接受测试里手写的 { agentMode, llm: {...} }。
 */
function resolveConfig(input) {
  const src = isObject(input) ? input : {};
  const srcLlm = isObject(src.llm) ? src.llm : {};
  const srcCoze = isObject(src.coze) ? src.coze : {};

  const llm = {
    baseUrl: toStringValue(
      firstDefined(srcLlm.baseUrl, srcLlm.baseURL, src.llmBaseUrl, src.LLM_BASE_URL),
      DEFAULTS.llm.baseUrl
    ),
    apiKey: toStringValue(
      firstDefined(srcLlm.apiKey, srcLlm.api_key, src.llmApiKey, src.LLM_API_KEY),
      DEFAULTS.llm.apiKey
    ),
    model: toStringValue(
      firstDefined(srcLlm.model, src.llmModel, src.LLM_MODEL),
      DEFAULTS.llm.model
    )
  };

  const coze = {
    apiToken: toStringValue(
      firstDefined(srcCoze.apiToken, srcCoze.token, src.cozeApiToken, src.COZE_API_TOKEN),
      DEFAULTS.coze.apiToken
    ),
    botId: toStringValue(
      firstDefined(srcCoze.botId, srcCoze.bot_id, src.cozeBotId, src.COZE_BOT_ID),
      DEFAULTS.coze.botId
    ),
    baseUrl: toStringValue(
      firstDefined(srcCoze.baseUrl, srcCoze.baseURL, src.cozeBaseUrl, src.COZE_BASE_URL),
      DEFAULTS.coze.baseUrl
    )
  };

  const modeRaw = toStringValue(
    firstDefined(src.agentMode, src.mode, src.AGENT_MODE),
    DEFAULTS.agentMode
  ).toLowerCase();
  const agentMode = modeRaw === 'remote' ? 'remote' : 'mock';

  const fallbackRaw = toStringValue(
    firstDefined(src.agentFallback, src.fallback, src.AGENT_FALLBACK),
    DEFAULTS.agentFallback
  ).toLowerCase();
  const agentFallback = fallbackRaw === 'error' ? 'error' : 'mock';

  const logLevelRaw = toStringValue(
    firstDefined(src.logLevel, src.LOG_LEVEL),
    DEFAULTS.logLevel
  ).toLowerCase();
  const logLevel = LOG_LEVELS.indexOf(logLevelRaw) >= 0 ? logLevelRaw : DEFAULTS.logLevel;

  const explicitProvider = toStringValue(
    firstDefined(src.remoteProvider, src.provider),
    ''
  );
  const providerValid = PROVIDER_IDS.indexOf(explicitProvider) >= 0;

  let remoteProvider;
  if (providerValid) {
    remoteProvider = explicitProvider;
  } else if (llmComplete(llm)) {
    remoteProvider = 'openai-compatible';
  } else if (cozeComplete(coze)) {
    remoteProvider = 'coze';
  } else {
    remoteProvider = null;
  }

  const remoteConfigured = remoteProvider === 'openai-compatible'
    ? llmComplete(llm)
    : remoteProvider === 'coze'
      ? cozeComplete(coze)
      : false;

  return {
    port: toInt(firstDefined(src.port, src.PORT), DEFAULTS.port, 0, 65535),
    nodeEnv: toStringValue(firstDefined(src.nodeEnv, src.NODE_ENV), DEFAULTS.nodeEnv),
    agentMode,
    agentTimeoutMs: toInt(
      firstDefined(src.agentTimeoutMs, src.timeoutMs, src.AGENT_TIMEOUT_MS),
      DEFAULTS.agentTimeoutMs,
      1,
      120000
    ),
    agentFallback,
    rateLimitPerMin: toInt(
      firstDefined(src.rateLimitPerMin, src.rateLimit, src.RATE_LIMIT_PER_MIN),
      DEFAULTS.rateLimitPerMin,
      0,
      100000
    ),
    corsOrigins: normalizeOrigins(
      firstDefined(src.corsOrigins, src.cors, src.CORS_ORIGINS)
    ),
    telemetryEnabled: toBool(
      firstDefined(src.telemetryEnabled, src.telemetry, src.TELEMETRY_ENABLED),
      DEFAULTS.telemetryEnabled
    ),
    logLevel,
    llm,
    coze,
    version: toStringValue(src.version, DEFAULTS.version),
    staticRoot: toStringValue(src.staticRoot, DEFAULTS.staticRoot),
    promptDir: toStringValue(src.promptDir, DEFAULTS.promptDir),
    remoteProvider,
    remoteConfigured
  };
}

/**
 * 从环境变量 + 仓库根目录 .env 读取配置。
 * @param {Record<string, string|undefined>} [env] 显式环境（测试用）；默认 process.env
 */
function loadConfig(env) {
  const envMap = isObject(env) ? env : process.env;
  const fileVars = readEnvFile(path.join(ROOT, '.env'));
  const merged = Object.assign({}, fileVars);

  [
    'PORT', 'NODE_ENV', 'AGENT_MODE', 'AGENT_TIMEOUT_MS', 'AGENT_FALLBACK',
    'RATE_LIMIT_PER_MIN', 'CORS_ORIGINS', 'TELEMETRY_ENABLED', 'LOG_LEVEL',
    'LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL',
    'COZE_API_TOKEN', 'COZE_BOT_ID', 'COZE_BASE_URL'
  ].forEach(key => {
    if (envMap && envMap[key] !== undefined) merged[key] = envMap[key];
  });

  return resolveConfig({
    port: merged.PORT,
    nodeEnv: merged.NODE_ENV,
    agentMode: merged.AGENT_MODE,
    agentTimeoutMs: merged.AGENT_TIMEOUT_MS,
    agentFallback: merged.AGENT_FALLBACK,
    rateLimitPerMin: merged.RATE_LIMIT_PER_MIN,
    corsOrigins: merged.CORS_ORIGINS,
    telemetryEnabled: merged.TELEMETRY_ENABLED,
    logLevel: merged.LOG_LEVEL,
    llm: {
      baseUrl: merged.LLM_BASE_URL,
      apiKey: merged.LLM_API_KEY,
      model: merged.LLM_MODEL
    },
    coze: {
      apiToken: merged.COZE_API_TOKEN,
      botId: merged.COZE_BOT_ID,
      baseUrl: merged.COZE_BASE_URL
    },
    version: PACKAGE_VERSION
  });
}

/** 可以返回给浏览器的非敏感配置。绝不包含 baseUrl / key / token。 */
function publicConfig(config) {
  return {
    mode: config.agentMode,
    remoteConfigured: !!config.remoteConfigured,
    mapProvider: 'mock',
    telemetryEnabled: !!config.telemetryEnabled,
    version: config.version
  };
}

module.exports = {
  ROOT,
  PACKAGE_VERSION,
  DEFAULTS,
  parseEnvFile,
  loadConfig,
  resolveConfig,
  publicConfig
};
