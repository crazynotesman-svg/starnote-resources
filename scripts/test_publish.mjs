/**
 * /api/publish 冒烟测试（Node 22，零依赖）
 *   node scripts/test_publish.mjs
 *
 * 覆盖：口令校验、首次发布、合并更新、整类替换、emoji 字符级保真。
 */

import { onRequestPost } from '../functions/api/publish.js';

const ADMIN = 'test-admin-token';

let store = null;      // 模拟 GitHub 上的文件内容
let kvStore = null;    // 模拟 KV
let lastPut = null;

function b64(s) {
  return Buffer.from(s, 'utf8').toString('base64');
}

globalThis.fetch = async (url, init = {}) => {
  if (init.method === 'PUT') {
    lastPut = JSON.parse(init.body);
    store = Buffer.from(lastPut.content, 'base64').toString('utf8');
    return { ok: true, status: 200, json: async () => ({ commit: { html_url: 'https://gh/commit/1' } }) };
  }
  if (!store) return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
  return { ok: true, status: 200, json: async () => ({ content: b64(store), sha: 'sha-1' }) };
};

const env = {
  ADMIN_TOKEN: ADMIN,
  GITHUB_TOKEN: 't',
  GITHUB_REPO: 'o/r',
  GITHUB_BRANCH: 'main',
  RESOURCES_KV: {
    put: async (k, v) => { kvStore = v; },
    get: async () => kvStore,
  },
};

async function post(body) {
  const req = new Request('https://x/api/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await onRequestPost({ request: req, env });
  return { status: res.status, body: await res.json() };
}

const CODE_A = '😛会僝我s的极限L🐳由d我R自k🌈己Y划定f://R，下*1一C秒就能!7亲手打破再刷新。【复制后打开App使用】債仓😽';
const CODE_B = '😇丗傥我不是幸l运!儿的U剧L本🐳W，我是P://2靠🐳自M己加w冕~u的王者传记。k😣偱丷';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

console.log('\n[1] 口令校验');
{
  const r = await post({ token: 'wrong', group: '四六级', categories: [] });
  check('错误口令返回 401', r.status === 401 && r.body.ok === false, JSON.stringify(r.body));
  const r2 = await post({ group: '四六级', categories: [] });
  check('空口令返回 401', r2.status === 401, JSON.stringify(r2.body));
}

console.log('\n[2] 首次发布（GitHub 上无文件）');
{
  store = null; kvStore = null;
  const r = await post({
    token: ADMIN, group: '四六级', mode: 'merge',
    categories: [{ name: '四级', items: [{ name: '资料A', code: CODE_A }, { name: '资料B', code: CODE_B }] }],
  });
  check('返回 ok', r.body.ok === true, JSON.stringify(r.body));
  check('added = 2', r.body.added === 2, `got ${r.body.added}`);
  check('removed = 0', r.body.removed === 0, `got ${r.body.removed}`);
  check('KV 已写入', !!kvStore && JSON.parse(kvStore).categories.length === 1);

  const doc = JSON.parse(store);
  check('group 正确', doc.categories[0].group === '四六级');
  check('emoji 字符级保真', doc.categories[0].items[0].code === CODE_A);
  check('commit message 含条数', /共 2 条/.test(lastPut.message), lastPut.message);
}

console.log('\n[3] 合并更新（改 1 条 + 增 1 条，另一分类保留）');
{
  const r = await post({
    token: ADMIN, group: '四六级', mode: 'merge',
    categories: [
      { name: '四级', items: [{ name: '资料A', code: CODE_A + 'X' }, { name: '资料C', code: CODE_B }] },
    ],
  });
  check('updated = 1', r.body.updated === 1, `got ${r.body.updated}`);
  check('added = 1', r.body.added === 1, `got ${r.body.added}`);
  check('removed = 1（资料B 消失）', r.body.removed === 1, `got ${r.body.removed}`);

  // 六级由另一个文件发布，合并模式下不应被清掉
  await post({
    token: ADMIN, group: '四六级', mode: 'merge',
    categories: [{ name: '六级', items: [{ name: '资料D', code: CODE_B }] }],
  });
  const doc = JSON.parse(store);
  check('六级被保留', doc.categories.some((c) => c.id === '六级'));
  check('共 2 个分类', doc.categories.length === 2, `got ${doc.categories.length}`);
}

console.log('\n[4] 整类替换');
{
  const r = await post({
    token: ADMIN, group: '四六级', mode: 'replace',
    categories: [{ name: '四级', items: [{ name: '资料A', code: CODE_A }] }],
  });
  const doc = JSON.parse(store);
  check('六级被清除', !doc.categories.some((c) => c.id === '六级'));
  check('removed 计入被清分类', r.body.removed >= 1, `got ${r.body.removed}`);
  check('仅剩 1 个分类', doc.categories.length === 1, `got ${doc.categories.length}`);
}

console.log('\n[5] 新建类目（考公）');
{
  const r = await post({
    token: ADMIN, group: '考公', mode: 'merge',
    categories: [{ name: '行测', items: [{ name: '2026国考行测', code: CODE_A }] }],
  });
  const doc = JSON.parse(store);
  check('返回 ok', r.body.ok === true);
  check('考公与四六级并存', doc.categories.length === 2, `got ${doc.categories.length}`);
  check('考公 group 正确', doc.categories.find((c) => c.id === '行测').group === '考公');
}

console.log('\n[6] 参数校验');
{
  const r1 = await post({ token: ADMIN, categories: [{ name: 'x', items: [] }] });
  check('缺 group 返回 400', r1.status === 400, JSON.stringify(r1.body));
  const r2 = await post({ token: ADMIN, group: 'x', categories: [] });
  check('空分类返回 400', r2.status === 400, JSON.stringify(r2.body));
  const r3 = await post({ token: ADMIN, group: 'x', categories: [{ name: 'x', items: [{ name: '', code: 'y' }] }] });
  check('空资料名被过滤后返回 400', r3.status === 400, JSON.stringify(r3.body));
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
