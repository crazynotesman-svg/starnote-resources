/**
 * 浏览器冒烟测试（playwright-core + 系统已装 chromium）
 *   NODE_PATH=<workspace>/node_modules node scripts/smoke.mjs
 *
 * 校验：页面无 JS 报错、列表渲染正确、tab 切换、搜索、一键复制。
 */

import { createRequire } from 'node:module';

// ESM 不认 NODE_PATH，用 createRequire 让本地 workspace 里的 playwright-core 可解析
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const BASE = process.env.BASE || 'http://127.0.0.1:8799';
const EXE = process.env.CHROME_PATH ||
  'C:/Users/admin/AppData/Local/ms-playwright/chromium-1237/chrome-win64/chrome.exe';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

const browser = await chromium.launch({ executablePath: EXE });
const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

console.log('\n[1] 展示页渲染');
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForSelector('.row', { timeout: 8000 });

const rowCount = await page.locator('.row').count();
check('渲染 12 行（四级）', rowCount === 12, `got ${rowCount}`);

const groups = await page.locator('#groups button').allTextContents();
check('一级类目为 四六级', groups.length === 1 && groups[0].includes('四六级'), JSON.stringify(groups));

const cats = await page.locator('#cats button').allTextContents();
check('二级分类 四级 / 六级', cats.length === 2 && cats[0].includes('四级') && cats[1].includes('六级'), JSON.stringify(cats));

const firstName = await page.locator('.row .name').first().textContent();
check('首条资料名正确', firstName.includes('2026年6月四级真题'), firstName);

console.log('\n[2] 切换到六级');
await page.locator('#cats button', { hasText: '六级' }).click();
await page.waitForTimeout(200);
const c2 = await page.locator('.row').count();
check('六级 11 行', c2 === 11, `got ${c2}`);
check('六级分组计数为 23', (await page.locator('#groups button').first().textContent()).includes('23'));

console.log('\n[3] 展开与复制');
await page.locator('.row').first().locator('button[data-act="toggle"]').click();
await page.waitForTimeout(150);
const codeText = await page.locator('.row').first().locator('.code').textContent();
check('口令含 x:// 锚点', /[A-Za-z0-9]:\/\//.test(codeText), codeText.slice(0, 40));

await page.locator('.row').first().locator('button[data-act="copy"]').click();
await page.waitForTimeout(300);
const clip = await page.evaluate(() => navigator.clipboard.readText());
check('剪贴板内容与口令完全一致', clip === codeText, `clip=${clip.length} dom=${codeText.length}`);
check('复制按钮进入已复制态', (await page.locator('.row').first().locator('button[data-act="copy"]').textContent()).includes('已复制'));

console.log('\n[4] 搜索');
await page.fill('#q', '2025');
await page.waitForTimeout(300);
const s1 = await page.locator('.row').count();
check('搜索「2025」有结果', s1 > 0, `got ${s1}`);
check('搜索时隐藏 tab', await page.locator('#groups').isHidden());
await page.fill('#q', '不存在的资料xyz');
await page.waitForTimeout(300);
check('无结果时显示空态', (await page.locator('.empty').count()) === 1);
await page.click('#clear');
await page.waitForTimeout(250);
check('清空后恢复列表', (await page.locator('.row').count()) > 0);

console.log('\n[5] 维护页');
await page.goto(BASE + '/admin.html', { waitUntil: 'networkidle' });
check('SheetJS 已加载', await page.evaluate(() => typeof XLSX !== 'undefined'));
check('解析器已加载', await page.evaluate(() => typeof ResourceParser !== 'undefined'));
const opts = await page.$$eval('#group-list option', (els) => els.map((e) => e.value));
check('datalist 含已有类目 四六级', opts.includes('四六级'), JSON.stringify(opts));

console.log('\n[6] 上传 Excel 并预览');
const XLSX_PATH = process.env.XLSX_PATH || 'C:/Users/admin/Desktop/四六级资料口令.xlsx';
await page.setInputFiles('#file', XLSX_PATH);
await page.waitForSelector('.cat-block', { timeout: 8000 });
const blocks = await page.locator('.cat-block').count();
check('预览 2 个分类', blocks === 2, `got ${blocks}`);
const names = await page.$$eval('.cat-head input', (els) => els.map((e) => e.value));
check('分类名 四级 / 六级', names.join(',') === '四级,六级', JSON.stringify(names));
const badges = await page.$$eval('.cat-head .badge', (els) => els.map((e) => e.textContent.trim()));
check('条数徽标 12 / 11', badges[0] === '12 条' && badges[1] === '11 条', JSON.stringify(badges));
const firstCode = await page.locator('.preview-table td.code').first().textContent();
check('预览口令完整（含 x://）', /[A-Za-z0-9]:\/\//.test(firstCode), firstCode.slice(0, 40));
check('发布按钮可用', (await page.locator('#publish').textContent()).includes('确认发布'));

console.log('\n[7] 运行时错误');
// 本地静态预览没有 Pages Functions，/api/data 的 404 属预期，前端会回退到静态 JSON
const IGNORABLE = /404|Failed to load resource/;
const real = errors.filter((e) => !IGNORABLE.test(e));
check('无 JS 报错（忽略本地缺少 /api/data 的 404）', real.length === 0, real.join(' | '));

await browser.close();
console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
