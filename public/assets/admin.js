/* StarNote 资料口令库 — 维护入口
 *
 * 流程：选择 Excel → 浏览器端 SheetJS 解析 → 可视化预览并可改分类名 → 提交 /api/publish
 * 口令逐字符敏感：解析结果不做 trim 之外的任何处理，原样提交。
 */
(function () {
  'use strict';

  var P = window.ResourceParser;   // assets/parser.js，与 Node 测试共用同一份实现
  var el = function (id) { return document.getElementById(id); };
  var dropEl = el('drop');
  var fileEl = el('file');
  var previewCard = el('previewCard');
  var previewEl = el('preview');
  var resultEl = el('result');
  var publishBtn = el('publish');

  var TOKEN_KEY = 'sr_admin_token';   // sessionStorage：仅当前标签页，关闭即失效

  var parsed = null;   // [{ name, items: [{name, code}] }]

  /* ------------------------------------------------------------ 工具 */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var toastTimer;
  function toast(msg) {
    var t = el('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  /* ------------------------------------------------------------ 读取文件 */

  function readWorkbook(file, cb) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        var rows = [];
        wb.SheetNames.forEach(function (sn) {
          var ws = wb.Sheets[sn];
          if (!ws) return;
          var aoa = XLSX.utils.sheet_to_json(ws, {
            header: 1, defval: '', blankrows: false, raw: false
          });
          aoa.forEach(function (r) { rows.push(r.map(P.cellOf)); });
        });
        cb(null, rows);
      } catch (err) {
        cb(err);
      }
    };
    reader.onerror = function () { cb(new Error('文件读取失败')); };
    reader.readAsArrayBuffer(file);
  }

  /* ------------------------------------------------------------ 预览 */

  function renderPreview(cats, fileName) {
    el('fileName').textContent = fileName || '';
    var total = cats.reduce(function (s, c) { return s + c.items.length; }, 0);

    var html = '';
    if (!cats.length || !total) {
      html = '<div class="warn-box">未能从该文件中识别出资料条目。请检查版式：' +
        '并排双栏需要「资料名 + 口令」相邻成对；三列版式需要含「资料名称 / 提取口令」的表头。</div>';
    }

    cats.forEach(function (c, ci) {
      html += '<div class="cat-block" data-ci="' + ci + '">' +
        '<div class="cat-head">' +
          '<input type="text" value="' + esc(c.name) + '" data-name="' + ci + '" aria-label="分类名称">' +
          '<span class="badge">' + c.items.length + ' 条</span>' +
        '</div>' +
        '<table class="preview-table"><thead><tr><th>资料名称</th><th>提取口令</th></tr></thead><tbody>';
      c.items.slice(0, 5).forEach(function (it) {
        html += '<tr><td>' + esc(it.name) + '</td><td class="code">' + esc(it.code) + '</td></tr>';
      });
      html += '</tbody></table>';
      if (c.items.length > 5) {
        html += '<div class="more">… 另有 ' + (c.items.length - 5) + ' 条，共 ' + c.items.length + ' 条</div>';
      }
      html += '</div>';
    });

    if (total) {
      html = '<div class="hint" style="margin:0 0 12px">共识别 ' +
        cats.length + ' 个分类、' + total + ' 条资料。分类名称可直接修改。</div>' + html;
    }

    previewEl.innerHTML = html;
    previewCard.hidden = false;
    resultEl.hidden = true;
    previewCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function collectFromPreview() {
    var inputs = previewEl.querySelectorAll('input[data-name]');
    var out = [];
    Array.prototype.forEach.call(inputs, function (inp) {
      var ci = Number(inp.getAttribute('data-name'));
      out.push({
        name: inp.value.trim() || parsed[ci].name,
        items: parsed[ci].items
      });
    });
    return out;
  }

  /* ------------------------------------------------------------ 发布 */

  function publish() {
    var token = el('token').value.trim();
    var group = el('group').value.trim();
    var modeEl = document.querySelector('input[name="mode"]:checked');
    var mode = modeEl ? modeEl.value : 'merge';

    if (!token) { toast('请填写管理口令'); el('token').focus(); return; }
    if (!group) { toast('请填写一级类目'); el('group').focus(); return; }
    if (!parsed) { toast('请先上传 Excel 文件'); return; }

    var cats = collectFromPreview();
    if (!cats.length) { toast('没有可发布的资料'); return; }

    publishBtn.disabled = true;
    publishBtn.textContent = '发布中…';
    resultEl.hidden = true;

    fetch('/api/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, group: group, mode: mode, categories: cats })
    })
      .then(function (r) {
        return r.json().catch(function () {
          return { ok: false, error: '接口返回异常（HTTP ' + r.status + '）' };
        }).then(function (d) { return { status: r.status, body: d }; });
      })
      .then(function (res) {
        publishBtn.disabled = false;
        publishBtn.textContent = '确认发布';
        showResult(res.status, res.body, token);
      })
      .catch(function (err) {
        publishBtn.disabled = false;
        publishBtn.textContent = '确认发布';
        resultEl.hidden = false;
        resultEl.className = 'result err';
        resultEl.innerHTML = '<strong>发布失败</strong><br>' +
          esc(err.message || String(err)) +
          '<br><span class="dim">若你在本地预览（未部署到 Cloudflare Pages），' +
          '<code>/api/publish</code> 不存在属正常现象。</span>';
      });
  }

  function showResult(status, d, token) {
    resultEl.hidden = false;
    if (!d || !d.ok) {
      resultEl.className = 'result err';
      resultEl.innerHTML = '<strong>发布失败</strong><br>' + esc((d && d.error) || ('HTTP ' + status));
      return;
    }
    // 仅在发布成功后记住，避免把打错的口令存下来；sessionStorage 关闭标签页即清除
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) { /* 隐私模式下忽略 */ }
    resultEl.className = 'result ok';
    var html = '<strong>发布成功</strong><br>' +
      '新增 ' + d.added + ' 条 · 更新 ' + d.updated + ' 条' +
      (d.removed ? ' · 移除 ' + d.removed + ' 条' : '') +
      '<br>KV 已即时更新，Pages 重建约 1-2 分钟后全量生效。';
    if (d.commit) {
      html += '<br><a href="' + esc(d.commit) + '" target="_blank" rel="noopener">查看 GitHub 提交 →</a>';
    }
    resultEl.innerHTML = html;
    toast('发布成功');
  }

  /* ------------------------------------------------------------ 事件 */

  dropEl.addEventListener('click', function () { fileEl.click(); });

  fileEl.addEventListener('change', function () {
    if (fileEl.files && fileEl.files[0]) handleFile(fileEl.files[0]);
  });

  ['dragenter', 'dragover'].forEach(function (ev) {
    dropEl.addEventListener(ev, function (e) {
      e.preventDefault(); e.stopPropagation(); dropEl.classList.add('over');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dropEl.addEventListener(ev, function (e) {
      e.preventDefault(); e.stopPropagation(); dropEl.classList.remove('over');
    });
  });
  dropEl.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  function handleFile(file) {
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      toast('请选择 Excel 文件（.xlsx / .xls / .csv）');
      return;
    }
    toast('正在解析…');
    readWorkbook(file, function (err, rows) {
      if (err) { toast('解析失败：' + err.message); console.error(err); return; }
      parsed = P.parse(rows);
      renderPreview(parsed, file.name);
      if (parsed.length) toast('解析完成');
    });
  }

  publishBtn.addEventListener('click', publish);

  el('cancel').addEventListener('click', function () {
    previewCard.hidden = true;
    parsed = null;
    fileEl.value = '';
    resultEl.hidden = true;
  });

  /* 回填本标签页上次发布成功的口令 */
  try {
    var saved = sessionStorage.getItem(TOKEN_KEY);
    if (saved) el('token').value = saved;
  } catch (e) { /* 隐私模式下忽略 */ }

  /* 已有类目填充 datalist */
  fetch('./data/resources.json')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var seen = {};
      (d.categories || []).forEach(function (c) { seen[c.group || '默认'] = 1; });
      var dl = el('group-list');
      Object.keys(seen).forEach(function (g) {
        var o = document.createElement('option');
        o.value = g;
        dl.appendChild(o);
      });
    })
    .catch(function () { /* 忽略：静态兜底缺失不影响使用 */ });
})();
