/**
 * POST /api/publish
 * 维护入口发布接口。
 *
 * 职责：
 *   1) 校验 ADMIN_TOKEN（绝不下发到前端）
 *   2) 与 GitHub 上的 resources.json 合并
 *   3) 写 Cloudflare KV（秒级生效）
 *   4) 提交 GitHub（触发 Pages 重建，同时留下版本历史）
 *
 * 所需环境变量（Cloudflare Pages → Settings → Environment variables）：
 *   ADMIN_TOKEN    管理口令
 *   GITHUB_TOKEN   fine-grained PAT，对仓库 Contents 读写权限
 *   GITHUB_REPO    owner/repo
 *   GITHUB_BRANCH  可选，默认 main
 *   GITHUB_PATH    可选，默认 public/data/resources.json
 *   RESOURCES_KV   KV namespace 绑定
 *
 * 硬约束：口令逐字符敏感，全程 UTF-8 原样透传，不做任何 trim / 过滤。
 */

const MAX_ITEMS = 5000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/* ------------------------------------------------------------ 工具 */

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
  });
}

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function safeEqual(a, b) {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

function slugify(text) {
  const s = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'cat';
}

async function makeId(category, name) {
  const data = new TextEncoder().encode(`${category}::${name}`);
  const buf = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 10);
}

/* ------------------------------------------------------------ GitHub */

async function ghGet(env, path) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}?ref=${env.GITHUB_BRANCH}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'starnote-resources',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub 读取失败：HTTP ${r.status}`);
  return r.json();
}

async function ghPut(env, path, contentStr, sha, message) {
  const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'starnote-resources',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      message,
      content: b64encode(contentStr),
      sha,
      branch: env.GITHUB_BRANCH,
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`GitHub 写入失败：HTTP ${r.status} ${t.slice(0, 200)}`);
  }
  return r.json();
}

/* ------------------------------------------------------------ 合并 */

async function mergeDocument(existing, group, incoming, mode) {
  let cats = Array.isArray(existing.categories) ? existing.categories.slice() : [];
  const stats = { added: 0, updated: 0, removed: 0 };

  const incomingIds = new Set(incoming.map((c) => slugify(c.name)));

  if (mode === 'replace') {
    cats.forEach((c) => {
      if ((c.group || '默认') === group && !incomingIds.has(c.id)) {
        stats.removed += (c.items || []).length;
      }
    });
    cats = cats.filter((c) => (c.group || '默认') !== group || incomingIds.has(c.id));
  }

  const byId = new Map(cats.map((c) => [c.id, c]));

  for (let i = 0; i < incoming.length; i++) {
    const inc = incoming[i];
    const cid = slugify(inc.name);
    const prev = byId.get(cid);
    const prevItems = new Map((prev && prev.items ? prev.items : []).map((it) => [it.name, it]));

    const items = [];
    for (const it of inc.items) {
      const old = prevItems.get(it.name);
      if (!old) stats.added++;
      else if (old.code !== it.code) stats.updated++;
      items.push({
        id: old ? old.id : await makeId(inc.name, it.name),
        name: it.name,
        code: it.code,
      });
      prevItems.delete(it.name);
    }
    stats.removed += prevItems.size;

    byId.set(cid, {
      id: cid,
      name: inc.name,
      group: (prev && prev.group) || group,
      order: prev && typeof prev.order === 'number' ? prev.order : i,
      items,
    });
  }

  const merged = Array.from(byId.values()).sort((a, b) => a.order - b.order);
  return { doc: { ...existing, categories: merged }, stats };
}

/* ------------------------------------------------------------ 入口 */

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const missing = [];
  if (!env.ADMIN_TOKEN) missing.push('ADMIN_TOKEN');
  if (!env.GITHUB_TOKEN) missing.push('GITHUB_TOKEN');
  if (!env.GITHUB_REPO) missing.push('GITHUB_REPO');
  if (missing.length) {
    return json(
      {
        ok: false,
        error: `缺少环境变量：${missing.join('、')}。请在 Cloudflare Pages → Settings → Environment variables 补齐后，到 Deployments 点 Retry deployment`,
        missing,
        hint: '改完环境变量必须重新部署才会生效',
      },
      500
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: '请求体不是合法 JSON' }, 400);
  }

  if (!payload || !safeEqual(String(payload.token || ''), env.ADMIN_TOKEN)) {
    return json({ ok: false, error: '管理口令不正确' }, 401);
  }

  const group = String(payload.group || '').trim();
  const mode = payload.mode === 'replace' ? 'replace' : 'merge';
  const incoming = Array.isArray(payload.categories) ? payload.categories : [];

  if (!group) return json({ ok: false, error: '缺少一级类目 group' }, 400);
  if (!incoming.length) return json({ ok: false, error: '没有可发布的分类' }, 400);

  const clean = [];
  let total = 0;
  for (const c of incoming) {
    if (!c || !Array.isArray(c.items)) continue;
    const name = String(c.name || '').trim();
    if (!name) continue;
    const items = c.items
      .filter((it) => it && typeof it.name === 'string' && typeof it.code === 'string' && it.name.trim() && it.code)
      .map((it) => ({ name: it.name, code: it.code }));
    if (items.length) {
      clean.push({ name, items });
      total += items.length;
    }
  }
  if (!clean.length) return json({ ok: false, error: '解析后的资料条目为空' }, 400);
  if (total > MAX_ITEMS) return json({ ok: false, error: `条目数 ${total} 超过上限 ${MAX_ITEMS}` }, 400);

  const path = env.GITHUB_PATH || 'public/data/resources.json';
  const branch = env.GITHUB_BRANCH || 'main';
  const env2 = { ...env, GITHUB_BRANCH: branch };

  try {
    const cur = await ghGet(env2, path);
    let existing = { categories: [] };
    if (cur && cur.content) {
      try {
        existing = JSON.parse(b64decode(cur.content));
      } catch {
        return json({ ok: false, error: '仓库中的 resources.json 不是合法 JSON，请手动修正后再发布' }, 500);
      }
    }

    const { doc, stats } = await mergeDocument(existing, group, clean, mode);
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    doc.updatedAt = now;
    doc.version = now;

    const content = JSON.stringify(doc, null, 2) + '\n';

    // 1) KV 即时生效（未绑定则降级：只靠 GitHub 重建，慢 1-2 分钟但不丢数据）
    let kvWritten = false;
    if (env.RESOURCES_KV) {
      await env.RESOURCES_KV.put('resources', content);
      kvWritten = true;
    }

    // 2) GitHub 提交（持久化 + 触发 Pages 重建）
    const names = clean.map((c) => c.name).join('、');
    const message = `chore(resources): 更新「${group}」${names} 共 ${total} 条`;
    const res = await ghPut(env2, path, content, cur ? cur.sha : undefined, message);

    return json({
      ok: true,
      ...stats,
      total,
      kv: kvWritten,
      kvWarning: kvWritten ? null : '未绑定 RESOURCES_KV，本次只写入 GitHub，展示页需等重建后更新（约 1-2 分钟）',
      commit: res && res.commit ? res.commit.html_url : null,
    });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 502);
  }
}
