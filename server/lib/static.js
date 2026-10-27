/* =====================================================================
 * static.js · 白名单静态资源服务
 * ---------------------------------------------------------------------
 * 只允许 /、/index.html、/css/*、/js/*、/shared/*、/assets/*。
 * 其余目录（server、docs、tests、node_modules…）一律 404。
 * 显式拒绝 ..、点文件、反斜杠、空字节与编码后的路径穿越。
 * ===================================================================== */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sendText } = require('./http');

const ALLOWED_PREFIXES = ['/css/', '/js/', '/shared/', '/assets/'];

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
});

/**
 * 把 URL pathname 解析成磁盘路径；不允许时返回 null。
 * @param {string} pathname
 * @param {string} root 仓库根目录
 */
function resolveStatic(pathname, root) {
  if (typeof pathname !== 'string' || !pathname) return null;
  if (pathname.indexOf('\0') >= 0 || pathname.indexOf('\\') >= 0) return null;

  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (_) {
    return null;
  }
  if (!decoded || decoded.indexOf('\0') >= 0 || decoded.indexOf('\\') >= 0) return null;
  if (decoded.charAt(0) !== '/') return null;

  if (decoded === '/' || decoded === '/index.html') {
    return path.join(root, 'index.html');
  }
  if (!ALLOWED_PREFIXES.some(prefix => decoded.startsWith(prefix))) return null;

  const relative = decoded.slice(1);
  const segments = relative.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') return null;
    if (segment.startsWith('.')) return null;
  }

  const absolute = path.resolve(root, relative);
  const rel = path.relative(root, absolute);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return absolute;
}

function contentTypeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

/**
 * 发送静态文件。GET/HEAD 之外返回 405；不允许的路径返回 404。
 * @returns {Promise<{status: number, served: boolean}>}
 */
async function serveStatic(req, res, options) {
  const opts = options || {};
  const root = opts.root || path.resolve(__dirname, '..', '..');
  const pathname = opts.pathname || '/';

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method Not Allowed');
    return { status: 405, served: false };
  }

  const file = resolveStatic(pathname, root);
  if (!file) {
    sendText(res, 404, 'Not Found');
    return { status: 404, served: false };
  }

  let stat;
  try {
    stat = await fs.promises.stat(file);
  } catch (_) {
    sendText(res, 404, 'Not Found');
    return { status: 404, served: false };
  }
  if (!stat.isFile()) {
    sendText(res, 404, 'Not Found');
    return { status: 404, served: false };
  }

  // 防符号链接逃逸：真实路径必须仍在仓库根目录内。
  try {
    const realRoot = await fs.promises.realpath(root);
    const realFile = await fs.promises.realpath(file);
    const relativeReal = path.relative(realRoot, realFile);
    if (!relativeReal || relativeReal.startsWith('..') || path.isAbsolute(relativeReal)) {
      sendText(res, 404, 'Not Found');
      return { status: 404, served: false };
    }
  } catch (_) {
    sendText(res, 404, 'Not Found');
    return { status: 404, served: false };
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', contentTypeFor(file));
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'no-cache');
  if (req.method === 'HEAD') {
    res.end();
    return { status: 200, served: true };
  }

  return new Promise(resolve => {
    let settled = false;
    const stream = fs.createReadStream(file);

    function done(status) {
      if (settled) return;
      settled = true;
      resolve({ status, served: status === 200 });
    }

    stream.on('error', () => {
      if (!res.headersSent) sendText(res, 404, 'Not Found');
      else res.destroy();
      done(404);
    });
    res.on('close', () => {
      stream.destroy();
      done(res.statusCode || 200);
    });
    res.on('finish', () => done(200));
    stream.pipe(res);
  });
}

module.exports = {
  ALLOWED_PREFIXES,
  MIME,
  resolveStatic,
  contentTypeFor,
  serveStatic
};
