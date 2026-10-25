/* =====================================================================
 * agent-proxy.example.js · 智能体服务端代理【参考实现 · 不在前端运行】
 * ---------------------------------------------------------------------
 * 为什么需要它：浏览器代码对用户可见，密钥不能放进前端。把对智能体
 * 平台的调用放到服务端/Serverless，前端只请求你自己的 /api/agent。
 *
 * 下面是一个与运行环境无关的最小骨架（Vercel/Netlify Functions/
 * 自建 Node 服务稍作适配即可）。把 PLAN_SYSTEM_PROMPT 与解析逻辑
 * 换成你实际使用的模型 / Agent 平台调用。
 *
 * 环境变量（在服务端配置，勿写进仓库）：
 *   AGENT_API_BASE   智能体平台地址
 *   AGENT_API_KEY    你的服务端密钥
 * ===================================================================== */

// 前端「路线」对象必须满足的字段（与 js/data.js 的 Route 结构对齐）
// 详见 docs/API-INTEGRATION.md
const PLAN_SYSTEM_PROMPT = `你是城市漫步路线规划助手。
根据用户条件输出严格 JSON，字段：
{
  "name": string,                 // 路线名称
  "places": string[],             // 地点 id（需与前端地点库一致）或完整地点对象
  "durationMin": number,          // 用户时间预算
  "actualMin": number,            // 预计实际耗时（停留+交通）
  "stayTotal": number, "walkTotal": number, "distanceKm": number,
  "budget": [number, number],     // 预计消费区间
  "style": string[],              // 风格标签
  "segments": [{ "placeId": string, "stay": number, "walkFromPrev": number }],
  "conflict": null | { "type": "time"|"budget", "title": string, "detail": string,
                       "options": [{ "id": string, "label": string }] },
  "notes": string[]
}
营业时间等无法确认的信息不要编造。`;

async function callAgent(task, payload) {
  const messages = [
    { role: 'system', content: PLAN_SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify({ task, payload }) }
  ];

  const res = await fetch(process.env.AGENT_API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + process.env.AGENT_API_KEY
    },
    body: JSON.stringify({ messages, response_format: { type: 'json_object' } })
  });
  if (!res.ok) throw new Error('upstream http ' + res.status);
  const data = await res.json();

  // 解析模型输出（按你的平台返回结构调整）
  const content = data.choices?.[0]?.message?.content ?? '{}';
  return JSON.parse(content);
}

// 通用入口（以 Node http 风格示意）
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
  try {
    const { task, payload } = JSON.parse(req.body || '{}');
    if (task !== 'plan' && task !== 'refine') {
      res.statusCode = 400; return res.end(JSON.stringify({ error: 'unknown task' }));
    }
    const data = await callAgent(task, payload);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ code: 0, data }));      // 前端从 json.data 取结果
  } catch (err) {
    res.statusCode = 502;
    res.end(JSON.stringify({ code: 1, error: err.message }));
  }
};
