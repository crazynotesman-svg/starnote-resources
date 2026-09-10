/* StarNote 资料口令库 — 展示页逻辑
 *
 * 数据来源优先级：
 *   1) /api/data  —— Cloudflare KV 即时层（后台上传 Excel 后秒级生效）
 *   2) ./data/resources.json —— 随站点打包的静态兜底（离线 / 本地双击也能用）
 *
 * 硬约束：口令逐字符敏感，任何地方都不得 trim / 过滤 / 转义 code 字段。
 */
(function () {
  'use strict';

  var el = function (id) { return document.getElementById(id); };
  var groupsEl = el('groups');
  var catsEl = el('cats');
  var listEl = el('list');
  var qEl = el('q');
  var searchbox = el('searchbox');

  var state = {
    data: null,
    group: null,
    cat: null,
    query: ''
  };

  /* ------------------------------------------------------------ 数据加载 */

  function loadData() {
    renderSkeleton();
    return fetch('/api/data', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (d) {
        if (!d || !Array.isArray(d.categories)) return Promise.reject();
        return d;
      })
      .catch(function () {
        return fetch('./data/resources.json').then(function (r) { return r.json(); });
      })
      .then(function (d) {
        state.data = normalize(d);
        state.group = state.data.groups[0] || null;   // groups 是字符串数组
        state.cat = null;
        render();
      })
      .catch(function (err) {
        listEl.innerHTML = '<div class="empty">资料加载失败，请刷新重试。</div>';
        console.error(err);
      });
  }

  function normalize(raw) {
    var cats = (raw.categories || []).map(function (c) {
      return {
        id: c.id || c.name,
        name: c.name || '未分类',
        group: c.group || '默认',
        order: typeof c.order === 'number' ? c.order : 99,
        items: (c.items || []).map(function (i) {
          return { id: i.id || i.name, name: i.name, code: i.code };
        })
      };
    }).sort(function (a, b) { return a.order - b.order; });

    var groups = [];
    cats.forEach(function (c) {
      if (groups.indexOf(c.group) === -1) groups.push(c.group);
    });

    return {
      updatedAt: raw.updatedAt || raw.version || '',
      categories: cats,
      groups: groups
    };
  }

  /* ------------------------------------------------------------ 渲染 */

  function renderSkeleton() {
    var html = '';
    for (var i = 0; i < 5; i++) {
      html += '<div class="skeleton"><i></i><i></i></div>';
    }
    listEl.innerHTML = html;
  }

  function catsOfGroup(group) {
    return state.data.categories.filter(function (c) { return c.group === group; });
  }

  function matches(cat, query) {
    if (!query) return cat.items;
    var q = query.toLowerCase();
    return cat.items.filter(function (i) {
      return i.name.toLowerCase().indexOf(q) !== -1;
    });
  }

  function render() {
    renderUpdated();
    renderGroupTabs();

    if (state.query) {
      groupsEl.style.display = 'none';
      catsEl.style.display = 'none';
      renderSearchResults();
      return;
    }
    groupsEl.style.display = '';
    catsEl.style.display = '';
    renderCatTabs();
    renderList();
  }

  function renderUpdated() {
    if (!state.data.updatedAt) return;
    var d = new Date(state.data.updatedAt);
    if (isNaN(d)) return;
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    el('updated').textContent = '更新于 ' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function renderGroupTabs() {
    var html = '';
    state.data.groups.forEach(function (g) {
      var n = catsOfGroup(g).reduce(function (s, c) { return s + c.items.length; }, 0);
      html += '<button type="button" role="tab" data-group="' + esc(g) + '" aria-selected="' +
        (g === state.group) + '">' + esc(g) + '<span class="count">' + n + '</span></button>';
    });
    groupsEl.innerHTML = html;
  }

  function renderCatTabs() {
    var cats = catsOfGroup(state.group);
    if (!state.cat || !cats.some(function (c) { return c.id === state.cat; })) {
      state.cat = cats[0] ? cats[0].id : null;
    }
    var html = '';
    cats.forEach(function (c) {
      html += '<button type="button" role="tab" data-cat="' + esc(c.id) + '" aria-selected="' +
        (c.id === state.cat) + '">' + esc(c.name) +
        '<span class="count">' + c.items.length + '</span></button>';
    });
    catsEl.innerHTML = html;
  }

  function renderList() {
    var cat = state.data.categories.filter(function (c) { return c.id === state.cat; })[0];
    if (!cat) { listEl.innerHTML = '<div class="empty">暂无资料</div>'; return; }
    listEl.innerHTML = cat.items.map(function (i) { return rowHtml(i, null); }).join('') ||
      '<div class="empty">该分类暂无资料</div>';
    renderStat();
  }

  function renderSearchResults() {
    var out = [];
    state.data.categories.forEach(function (c) {
      matches(c, state.query).forEach(function (i) { out.push({ item: i, cat: c }); });
    });
    if (!out.length) {
      listEl.innerHTML = '<div class="empty">没有匹配「' + esc(state.query) + '」的资料</div>';
      renderStat();
      return;
    }
    listEl.innerHTML = out.map(function (o) { return rowHtml(o.item, o.cat); }).join('');
    renderStat(out.length);
  }

  function renderStat(n) {
    var total = state.data.categories.reduce(function (s, c) { return s + c.items.length; }, 0);
    el('stat').textContent = n == null
      ? '共 ' + state.data.categories.length + ' 个分类 · ' + total + ' 条资料'
      : '匹配 ' + n + ' 条 · 全站 ' + total + ' 条';
  }

  function rowHtml(item, cat) {
    var tag = cat
      ? '<div class="code" data-code>' + esc(item.code) + '</div>'
      : '';
    return '' +
      '<div class="row" data-id="' + esc(item.id) + '">' +
        '<div class="meta">' +
          '<div class="name">' + esc(item.name) +
            (cat ? ' <span class="count">' + esc(cat.group) + ' · ' + esc(cat.name) + '</span>' : '') +
          '</div>' +
          (cat ? tag : '<div class="code" data-code>' + esc(item.code) + '</div>') +
        '</div>' +
        '<div class="actions">' +
          '<button class="btn ghost" type="button" data-act="toggle" aria-expanded="false">展开</button>' +
          '<button class="btn primary" type="button" data-act="copy">复制口令</button>' +
        '</div>' +
      '</div>';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ------------------------------------------------------------ 交互 */

  groupsEl.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-group]');
    if (!b) return;
    state.group = b.getAttribute('data-group');
    state.cat = null;
    render();
  });

  catsEl.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-cat]');
    if (!b) return;
    state.cat = b.getAttribute('data-cat');
    render();
  });

  listEl.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var row = b.closest('.row');
    var act = b.getAttribute('data-act');

    if (act === 'toggle') {
      var open = row.classList.toggle('open');
      b.textContent = open ? '收起' : '展开';
      b.setAttribute('aria-expanded', String(open));
      return;
    }

    if (act === 'copy') {
      var id = row.getAttribute('data-id');
      var item = findItem(id);
      if (!item) return;
      copyText(item.code).then(function (ok) {
        if (!ok) { toast('复制失败，请手动长按选择口令'); return; }
        b.classList.add('copied');
        b.textContent = '已复制 ✓';
        toast('口令已复制，打开 StarNote 最新版即可使用');
        setTimeout(function () {
          b.classList.remove('copied');
          b.textContent = '复制口令';
        }, 1800);
      });
    }
  });

  function findItem(id) {
    for (var i = 0; i < state.data.categories.length; i++) {
      var items = state.data.categories[i].items;
      for (var j = 0; j < items.length; j++) {
        if (items[j].id === id) return items[j];
      }
    }
    return null;
  }

  /* ------------------------------------------------------------ 复制
   * 不做任何字符处理，原样写入剪贴板。
   */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text)
        .then(function () { return true; })
        .catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  var toastTimer;
  function toast(msg) {
    var t = el('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  /* ------------------------------------------------------------ 搜索 */

  var qTimer;
  qEl.addEventListener('input', function () {
    searchbox.classList.toggle('has', !!qEl.value);
    clearTimeout(qTimer);
    qTimer = setTimeout(function () {
      state.query = qEl.value.trim();
      render();
    }, 120);
  });

  el('clear').addEventListener('click', function () {
    qEl.value = '';
    searchbox.classList.remove('has');
    state.query = '';
    render();
    qEl.focus();
  });

  /* ------------------------------------------------------------ 启动 */

  loadData();
})();
