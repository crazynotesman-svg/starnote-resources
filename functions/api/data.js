/**
 * GET /api/data
 * 即时数据层：读 Cloudflare KV 中最新一次发布的结果。
 * 未配置 KV 或尚未发布过 -> 404，前端自动回退到静态 data/resources.json。
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const kv = context.env.RESOURCES_KV;

  if (kv) {
    const raw = await kv.get('resources');
    if (raw) {
      return new Response(raw, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          ...CORS,
        },
      });
    }
  }

  return new Response(JSON.stringify({ error: 'no live data' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}
