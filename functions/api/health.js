/**
 * GET /api/health
 * 部署自检：报告必需的环境变量与 KV 绑定是否就位，并试探 GitHub 连通性。
 *
 * 只回布尔值与仓库名，不下发任何密钥内容，可放心公开调用。
 * 用途：配完 Cloudflare 环境变量后访问一次，确认没有漏配 / PAT 权限不足。
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const env = context.env;

  const branch = env.GITHUB_BRANCH || 'main';
  const path = env.GITHUB_PATH || 'public/data/resources.json';

  const checks = {
    ADMIN_TOKEN: !!env.ADMIN_TOKEN,
    GITHUB_TOKEN: !!env.GITHUB_TOKEN,
    GITHUB_REPO: env.GITHUB_REPO || null,
    GITHUB_BRANCH: branch,
    GITHUB_PATH: path,
    RESOURCES_KV: !!env.RESOURCES_KV,
  };

  const missing = ['ADMIN_TOKEN', 'GITHUB_TOKEN', 'GITHUB_REPO'].filter((k) => !checks[k]);

  let github = null;
  if (checks.GITHUB_TOKEN && checks.GITHUB_REPO) {
    try {
      const r = await fetch(`https://api.github.com/repos/${checks.GITHUB_REPO}/contents/${path}?ref=${branch}`, {
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'starnote-resources',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      github = { reachable: true, status: r.status };
      if (r.status === 401 || r.status === 403) {
        github.problem = 'GitHub 拒绝了请求：PAT 无效、已过期，或 Contents 权限不足 / 未授权该仓库';
      } else if (r.status === 404) {
        github.problem = '仓库或文件路径不存在：检查 GITHUB_REPO 是否为 owner/repo，GITHUB_BRANCH 是否正确';
      } else if (!r.ok) {
        github.problem = `GitHub 返回 HTTP ${r.status}`;
      }
    } catch (err) {
      github = { reachable: false, problem: err.message || String(err) };
    }
  }

  const ok = missing.length === 0 && (!github || github.status === 200);

  return json({
    ok,
    missing,
    checks,
    github,
    ready: ok ? '配置完整，可以发布' : '尚不可发布，按 missing / github.problem 修正后 Retry deployment',
  });
}
