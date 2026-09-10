# StarNote 资料口令库

把 Excel 里的资料兑换口令变成可一键复制的网页，供用户粘贴到 StarNote 笔记中使用。

**技术结构：GitHub（数据源 + 版本历史） + Cloudflare Pages（托管） + KV（即时层） + Pages Functions（发布接口）**

> **域名**：当前使用 Cloudflare Pages 默认域名 `xxx.pages.dev`，不绑定自定义域名。
> 将来要绑（如 `res.100ideas.net`）时，在 Pages → Custom domains 里加一条即可，无需改代码。

---

## 1. 它解决什么问题

| 痛点 | 做法 |
|---|---|
| 口令含 emoji / 生僻字，手动复制易漏字符 | 一键复制，Clipboard API 原样写入，全程零清洗 |
| Excel 在手机上看不了 | 响应式网页 + 分类 tab + 搜索 |
| 后续要加考公 / 考研 | 一级类目（group）在维护页直接填新名字即可 |
| 定期更新资料 | 上传 Excel → 预览 → 发布，无需改代码 |

### 关键约束

> **口令逐字符敏感。** 任何 `trim`、字符集过滤、编码转换都会让口令失效。
> 代码里对 `code` 字段不做任何处理，JSON 一律 UTF-8 写出。

---

## 2. 目录结构

```
starnote-resources/
├── public/                     # Cloudflare Pages 输出目录
│   ├── index.html              # 展示页（资料名 + 口令 + 一键复制）
│   ├── admin.html              # 维护入口（上传 Excel）
│   ├── assets/
│   │   ├── app.css  app.js     # 展示页样式与逻辑
│   │   ├── admin.css admin.js  # 维护页样式与逻辑
│   │   └── parser.js           # Excel 版式解析（浏览器 / Node 共用同一份实现）
│   ├── data/resources.json     # 数据源（Git 版本化，同时作为静态兜底）
│   └── vendor/xlsx.full.min.js # SheetJS，浏览器端解析 Excel
├── functions/api/
│   ├── data.js                 # GET  /api/data    —— 读 KV 即时数据
│   └── publish.js              # POST /api/publish —— 校验口令 → 写 KV + 提交 GitHub
├── scripts/
│   ├── import_xlsx.py          # 命令行导入（纯标准库，可选）
│   ├── test_parser.mjs         # 版式解析测试
│   ├── test_publish.mjs        # 发布接口合并逻辑测试
│   ├── smoke.mjs               # 浏览器端到端冒烟
│   └── fixtures/cet-grid.json  # 真实 Excel 导出的测试样本
└── package.json
```

---

## 3. 数据格式

`public/data/resources.json`：

```json
{
  "updatedAt": "2026-09-10T08:37:00Z",
  "categories": [
    {
      "id": "四级",
      "name": "四级",
      "group": "四六级",
      "order": 0,
      "items": [
        { "id": "a1b2c3d4e5", "name": "2026年6月四级真题（共三套）", "code": "😛会僝我s的极限…" }
      ]
    }
  ]
}
```

- `group` 是一级类目（四六级 / 考公 / 考研）
- `name` 是二级分类（四级 / 六级）
- 新增类目不需要改代码，维护页填名字即可

---

## 4. 部署（约 15 分钟，全部免费额度内）

### 4.1 建仓库

```bash
cd starnote-resources
git init && git add . && git commit -m "feat: StarNote 资料口令库"
git remote add origin git@github.com:<你的账号>/starnote-resources.git
git push -u origin main
```

### 4.2 建 GitHub fine-grained PAT

GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens**

- Repository access：**Only select repositories** → 选这个仓库
- Permissions → Repository permissions → **Contents: Read and write**
- 生成后立刻保存（只显示一次）

### 4.3 建 KV 命名空间

Cloudflare → Workers & Pages → KV → Create namespace，名字例如 `starnote-resources-kv`。

### 4.4 建 Pages 项目

Cloudflare → Workers & Pages → Create → Pages → Connect to Git

| 配置项 | 值 |
|---|---|
| Build command | 留空（纯静态，无构建） |
| Build output directory | `public` |
| Root directory | `/` |

### 4.5 配置环境变量与绑定

Pages 项目 → Settings → Environment variables（Production 与 Preview 都加）

| 名称 | 说明 |
|---|---|
| `ADMIN_TOKEN` | 维护页口令，见下方「管理口令」 |
| `GITHUB_TOKEN` | 4.2 生成的 PAT，**勾选 Encrypt** |
| `GITHUB_REPO` | `owner/repo`，如 `ron/starnote-resources` |
| `GITHUB_BRANCH` | `main` |
| `GITHUB_PATH` | `public/data/resources.json` |

### 管理口令

已生成，保存在 **`.dev.vars`** 的 `ADMIN_TOKEN` 一行（该文件已 gitignore，不进仓库）：

```bash
cat .dev.vars    # 取 ADMIN_TOKEN 的值
npm run token    # 需要换一个时重新生成
```

- 字母表剔除 `0/1/i/l/o` 等易混淆字符，22 字符约 **99 bit 熵**
- **不要写进任何会被提交的文件**（README、代码、注释都不行）
- 泄漏处置：在 Cloudflare 改掉 `ADMIN_TOKEN` → Retry deployment，旧值立即失效；
  同时 `git revert` 可疑提交

Settings → Functions → **KV namespace bindings**

| Variable name | KV namespace |
|---|---|
| `RESOURCES_KV` | 4.3 建的命名空间 |

改完环境变量需要 **Retry deployment** 才会生效。

### 4.6 验证

1. 打开 `https://xxx.pages.dev/` —— 应看到四级 / 六级共 23 条
2. 打开 `https://xxx.pages.dev/admin.html` —— 填 `ADMIN_TOKEN` → 类目填「四六级」→ 上传 Excel → 预览 → 发布
3. 发布后刷新首页，数据应立刻变化

---

## 5. 日常维护：更新资料

打开 `https://你的域名/admin.html`：

1. **管理口令**填 `ADMIN_TOKEN`
2. **一级类目**填 `四六级`（或新建 `考公` / `考研`）
3. **更新模式**
   - **合并**（默认，推荐）：只替换本次 Excel 覆盖到的分类，同类目下其他分类保留
   - **整类替换**：先清空该类目全部旧分类再写入，适合大类重做
4. 拖入 Excel → 检查预览（分类名可就地改）→ **确认发布**

发布链路：

```
上传 → 浏览器 SheetJS 解析 → 预览确认
     → POST /api/publish（校验 token）
     → 写 KV（秒级生效）
     → 提交 GitHub（Pages 1-2 分钟重建，静态兜底同步更新）
```

认错版本时：`git revert` 那次提交即可，Pages 会自动回滚。

---

## 6. Excel 版式要求

两种都支持，解析失败时优先按三列版式识别：

**A. 并排双栏（当前四六级表在用）**

```
        A列            B列        C列        D列            E列
第3行   四级                                六级
第4行   2026年6月四级真题   <口令>              2026年6月六级真题   <口令>
```

识别规则：相邻两列成对，左列短文本为资料名、右列长文本（≥24 字符或含 `x://`）为口令；向上找该列最近的短文本作为分类名。

**B. 标准三列**

| 分类 | 资料名称 | 提取口令 |
|---|---|---|
| 四级 | 2026年6月四级真题 | 😛会僝… |

表头含「资料 / 名称」与「口令 / 提取码」关键字即可，可加一列「分类」。

---

## 7. 本地开发

```bash
# 静态预览（无 Functions，纯看页面）
python3 -m http.server 8788 -d public

# 完整本地环境（含 /api/data 与 /api/publish）
cp .dev.vars.example .dev.vars   # 填入真实值
npx wrangler pages dev public --port 8788 --kv RESOURCES_KV
```

命令行导入（不想走网页时）：

```bash
python3 scripts/import_xlsx.py 四六级资料口令.xlsx --group 四六级
python3 scripts/import_xlsx.py 考公资料.xlsx --group 考公 --merge
```

`--merge` 与现有 JSON 合并，未指定则覆盖整个文件。

---

## 8. 测试

```bash
npm test          # 解析 + 发布合并逻辑，共 39 项
npm run smoke     # 浏览器端到端，需先 npm run serve 起本地服务
```

`npm run smoke` 依赖 playwright-core 与本机 chromium，路径可用 `CHROME_PATH` 覆盖：

```bash
CHROME_PATH=/path/to/chrome BASE=http://127.0.0.1:8788 node scripts/smoke.mjs
```

覆盖点：列表渲染、分类切换、**剪贴板内容与口令逐字符一致**、搜索、Excel 上传预览、运行时零报错。

---

## 9. 安全注意事项

- `GITHUB_TOKEN` 只存在于 Cloudflare 加密环境变量中，**永不经过浏览器**
- `ADMIN_TOKEN` 在维护页手工输入；发布成功后写入 `sessionStorage`，
  **关闭标签页即清除**，从不写 localStorage 或落盘
- Token 一旦外泄：立刻在 GitHub 撤销 PAT、在 Cloudflare 轮换 `ADMIN_TOKEN`，轮换后旧值立即失效
- `/admin.html` 已加 `<meta name="robots" content="noindex">`，但仍建议不要在公开渠道扩散链接

---

## 10. 后续可扩展

| 需求 | 改动量 |
|---|---|
| 加新大类（考公 / 考研） | 零代码，维护页填类目名 |
| 资料加备注 / 有效期字段 | `resources.json` 加字段 + `app.js` 渲染 |
| 口令失效检测 | 加 `expiresAt` 字段 + 前端置灰 |
| 访问统计 | Cloudflare Web Analytics，加一行 script |
| 绑定自定义域名 | 暂不需要。要上时 Pages → Custom domains 加一条，零代码改动 |
