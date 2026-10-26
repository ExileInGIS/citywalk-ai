/* =====================================================================
 * agent-custom.example.js · 智能体自定义请求【参考实现 · 默认不加载】
 * ---------------------------------------------------------------------
 * 当你的智能体平台（如 Coze Agent、各家大模型 Agent）与默认的
 * 「POST JSON → 返回标准 Route」协议不一致时，在 config.js 里挂一个
 * 自定义 request 函数做协议转换即可，业务代码无需改动。
 *
 * 启用方式（js/config.js）：
 *   agent: {
 *     mode: 'remote',
 *     request: window.CW_AGENT_ADAPTER   // 或直接在此函数体内写逻辑
 *   }
 *
 * 也可以直接在 config.js 内联实现 request。本文件给出与「Coze 风格
 * 会话型 Agent」对接的骨架（伪代码，需替换成真实 SDK / 接口字段）。
 *
 * ⚠️ 不要把 PAT / API Key 写进前端代码提交到公开仓库。请通过你自己的
 *    后端 / Serverless 代理转发（见 server/agent-proxy.example.js）。
 * ===================================================================== */
(function () {
  window.CW_AGENT_ADAPTER = async function (task, payload) {
    // task = 'plan' | 'refine'
    // payload:
    //   plan   → { conditions }
    //   refine → { text, route }

    /* ---- 方式 A：直接调你自己的后端代理（推荐） ----
     * 后端负责持有密钥、调用智能体，并把返回整理成前端标准结构。 */
    const res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, payload })
    });
    if (!res.ok) throw new Error('智能体服务异常：HTTP ' + res.status);
    const json = await res.json();
    return json.data;   // 需满足 docs/API-INTEGRATION.md 定义的 Route 协议

    /* ---- 方式 B：平台 JS SDK（示意，字段以官方文档为准） ----
    const client = new CozeWebSDK.WebChatClient({ /* ... */ });
    // 1) 把 conditions / text 组装成自然语言或结构化入参
    // 2) 发起对话，拿到流式/一次性回复
    // 3) 约定智能体输出 JSON（function calling / JSON mode），在此解析
    // 4) 映射成前端 Route：
    const route = {
      id, name, city, source: 'ai',
      places: ['p_xxx', ...],          // 需与 data.js 中地点 id 对应，
                                        // 或返回完整地点对象并在 data 层注册
      durationMin, actualMin, stayTotal, walkTotal, distanceKm,
      budget: [lo, hi], budgetMax, style: [], conditions: {},
      segments: [{ placeId, stay, walkFromPrev }],
      notes: [], conflict: null, orderDirty: false, createdAt: new Date().toISOString()
    };
    return task === 'plan' ? route : { changed: true, reply, bullets, changes, route };
    */
  };
})();
