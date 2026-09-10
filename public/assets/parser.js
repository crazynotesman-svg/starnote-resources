/**
 * Excel 版式解析器（浏览器 + Node 通用）
 *
 * 支持两种版式：
 *   A. 并排双栏：A列=资料名 B列=口令 | D列=资料名 E列=口令，表头行给出分类名
 *   B. 标准三列：分类 / 资料名称 / 提取口令（表头含关键字）
 *
 * 硬约束：口令逐字符敏感，解析结果不做 trim 之外的任何处理。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ResourceParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NAME_KEYS = ['资料', '名称', '标题', 'name', 'title', 'resource'];
  var CODE_KEYS = ['口令', '提取码', '码', 'code', 'key', 'link'];
  var GROUP_KEYS = ['分类', '类目', '类别', 'category', 'group'];
  var CODE_ANCHOR = /[A-Za-z0-9]:\/\//;

  function cellOf(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
    if (v.text != null) return String(v.text);
    return String(v);
  }

  /** 口令特征：长度足够，或含 StarNote 的 x:// 锚点 */
  function isCode(t) {
    if (!t) return false;
    return t.length >= 24 || CODE_ANCHOR.test(t);
  }

  function looksLikeName(t) {
    if (!t) return false;
    if (isCode(t)) return false;
    var L = t.trim().length;
    return L >= 2 && L <= 60;
  }

  function parseWide(rows) {
    var counts = {}, startRow = {};
    rows.forEach(function (r, ri) {
      for (var i = 0; i < r.length - 1; i++) {
        var a = String(r[i] == null ? '' : r[i]).trim();
        var b = String(r[i + 1] == null ? '' : r[i + 1]).trim();
        if (looksLikeName(a) && isCode(b)) {
          counts[i] = (counts[i] || 0) + 1;
          if (startRow[i] == null) startRow[i] = ri;
        }
      }
    });

    var cols = Object.keys(counts)
      .filter(function (i) { return counts[i] >= 2; })
      .map(Number)
      .sort(function (a, b) { return a - b; });
    if (!cols.length) return [];

    return cols.map(function (i) {
      var start = startRow[i] || 0;
      var title = '';
      for (var ri = start - 1; ri >= 0; ri--) {
        var c = String(rows[ri][i] == null ? '' : rows[ri][i]).trim();
        if (c && !isCode(c) && c.length <= 20) { title = c; break; }
      }
      var items = [];
      for (var k = start; k < rows.length; k++) {
        var name = String(rows[k][i] == null ? '' : rows[k][i]).trim();
        var code = String(rows[k][i + 1] == null ? '' : rows[k][i + 1]).trim();
        if (!name || !code) continue;
        if (!looksLikeName(name) || !isCode(code)) continue;
        items.push({ name: name, code: code });
      }
      return { name: title || '未分类', items: items };
    }).filter(function (c) { return c.items.length; });
  }

  function parseLong(rows) {
    var header = -1, nameCol = -1, codeCol = -1, groupCol = -1;
    for (var ri = 0; ri < rows.length; ri++) {
      var low = rows[ri].map(function (c) { return String(c == null ? '' : c).trim().toLowerCase(); });
      var ni = -1, ci = -1;
      for (var i = 0; i < low.length; i++) {
        if (ni < 0 && NAME_KEYS.some(function (k) { return low[i].indexOf(k) !== -1; })) ni = i;
        if (ci < 0 && CODE_KEYS.some(function (k) { return low[i].indexOf(k) !== -1; })) ci = i;
      }
      if (ni >= 0 && ci >= 0 && ni !== ci) {
        header = ri; nameCol = ni; codeCol = ci;
        for (var j = 0; j < low.length; j++) {
          if (j !== ni && j !== ci &&
            GROUP_KEYS.some(function (k) { return low[j].indexOf(k) !== -1; })) {
            groupCol = j; break;
          }
        }
        break;
      }
    }
    if (header < 0) return [];

    var buckets = {}, order = [];
    for (var k = header + 1; k < rows.length; k++) {
      var name = String(rows[k][nameCol] == null ? '' : rows[k][nameCol]).trim();
      var code = String(rows[k][codeCol] == null ? '' : rows[k][codeCol]).trim();
      if (!name || !code) continue;
      var g = (groupCol >= 0 ? String(rows[k][groupCol] == null ? '' : rows[k][groupCol]).trim() : '') || '未分类';
      if (!buckets[g]) { buckets[g] = []; order.push(g); }
      buckets[g].push({ name: name, code: code });
    }
    return order.map(function (g) { return { name: g, items: buckets[g] }; });
  }

  /** 优先三列版式，回退并排双栏 */
  function parse(rows) {
    if (!Array.isArray(rows)) return [];
    var long = parseLong(rows);
    return long.length ? long : parseWide(rows);
  }

  return {
    parse: parse,
    parseWide: parseWide,
    parseLong: parseLong,
    isCode: isCode,
    looksLikeName: looksLikeName,
    cellOf: cellOf
  };
});
