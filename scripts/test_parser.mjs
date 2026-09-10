/**
 * Excel 版式解析冒烟测试（Node 22，零依赖）
 *   node scripts/test_parser.mjs
 *
 * 用真实 Excel 导出的网格 fixture，校验浏览器端 parser.js 的解析结果与
 * Python 导入器产出的 resources.json 完全一致（含 emoji 字符级比对）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

// UMD 模块：注入假 module 后取出导出
const code = fs.readFileSync(path.join(root, 'public/assets/parser.js'), 'utf8');
const mod = { exports: {} };
new Function('module', 'exports', code)(mod, mod.exports);
const P = mod.exports;

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

console.log('\n[1] 并排双栏版式（四六级真实表）');
{
  const grid = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/cet-grid.json'), 'utf8'));
  const cats = P.parse(grid);
  check('识别到 2 个分类', cats.length === 2, `got ${cats.length}`);
  check('分类名 四级 / 六级',
    cats[0].name === '四级' && cats[1].name === '六级',
    JSON.stringify(cats.map((c) => c.name)));
  check('四级 12 条', cats[0].items.length === 12, `got ${cats[0].items.length}`);
  check('六级 11 条', cats[1].items.length === 11, `got ${cats[1].items.length}`);

  // 与 Python 导入器的产出逐字符比对
  const doc = JSON.parse(fs.readFileSync(path.join(root, 'public/data/resources.json'), 'utf8'));
  const pyCats = new Map(doc.categories.map((c) => [c.name, c.items]));
  let same = true;
  cats.forEach((c) => {
    const py = pyCats.get(c.name) || [];
    if (py.length !== c.items.length) same = false;
    c.items.forEach((it, i) => {
      if (!py[i] || py[i].name !== it.name || py[i].code !== it.code) same = false;
    });
  });
  check('与 Python 导入结果字符级一致', same);

  // 口令完整性：必须含 x:// 锚点、不得被 trim 掉首尾字符
  const all = cats.flatMap((c) => c.items);
  check('所有口令长度 >= 24', all.every((i) => i.code.length >= 24));
  check('所有口令含 x:// 锚点', all.every((i) => /[A-Za-z0-9]:\/\//.test(i.code)));
  check('口令未被截断（无省略号）', all.every((i) => !i.code.includes('…')));
}

console.log('\n[2] 标准三列版式');
{
  const rows = [
    ['分类', '资料名称', '提取口令'],
    ['四级', '2026年6月四级真题', 'ABCD1234://口令示例一的小伙伴们大家好呀'],
    ['六级', '2026年6月六级真题', 'EFGH5678://口令示例二的小伙伴们大家好呀'],
  ];
  const cats = P.parse(rows);
  check('识别到 2 个分类', cats.length === 2, JSON.stringify(cats.map((c) => c.name)));
  check('按分类列分组正确', cats[0].name === '四级' && cats[1].name === '六级');
  check('口令原样保留', cats[0].items[0].code === 'ABCD1234://口令示例一的小伙伴们大家好呀');
}

console.log('\n[3] 两列版式（无分类列）');
{
  const rows = [
    ['资料名称', '提取口令'],
    ['考研英语真题', 'IJKL9012://考研口令示例内容填充占位文字'],
  ];
  const cats = P.parse(rows);
  check('落到未分类', cats.length === 1 && cats[0].name === '未分类', JSON.stringify(cats));
  check('条目正确', cats[0].items.length === 1);
}

console.log('\n[4] 异常输入');
{
  check('空数组不报错', P.parse([]).length === 0);
  check('null 不报错', P.parse(null).length === 0);
  const cats = P.parse([['标题'], ['说明文字'], ['', '']]);
  check('无口令表不产生条目', cats.every((c) => c.items.length === 0));
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
