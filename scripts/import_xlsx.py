#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Excel -> resources.json 导入器（纯标准库，零依赖）

支持的 Excel 版式：
  1) 并排双栏（StarNote 现用版式）
     A列=资料名  B列=口令   |   D列=资料名  E列=口令
     表头行给出分类名，例如 A3="四级"、D3="六级"

  2) 标准三列
     分类 | 资料名称 | 提取口令

用法：
  python import_xlsx.py <excel路径> [--group 四六级] [--out ../public/data/resources.json]

硬约束：口令逐字符敏感（含 emoji / 生僻字 / x:// 锚点），
        全流程不做任何 trim、字符集过滤或编码转换。
"""

import argparse
import hashlib
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

NAME_KEYS = ("资料", "名称", "标题", "name", "title", "resource")
CODE_KEYS = ("口令", "提取码", "码", "code", "key", "link")
GROUP_KEYS = ("分类", "类目", "类别", "category", "group")

# 口令特征：足够长，或含有 StarNote 的 x:// 锚点
CODE_ANCHOR = re.compile(r"[A-Za-z0-9]://")


# ---------------------------------------------------------------- xlsx 读取


def col_index(ref: str) -> int:
    """'AB12' -> 27"""
    n = 0
    for ch in ref:
        if ch.isalpha():
            n = n * 26 + (ord(ch.upper()) - 64)
        else:
            break
    return n - 1


def read_sheet(path: str, sheet_file: str = "xl/worksheets/sheet1.xml"):
    """返回二维 list（按列索引对齐，空单元格为 ''）"""
    z = zipfile.ZipFile(path)

    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall(NS + "si"):
            shared.append(
                "".join(t.text or "" for t in si.iter(NS + "t"))
            )

    if sheet_file not in z.namelist():
        names = [n for n in z.namelist() if n.startswith("xl/worksheets/")]
        sheet_file = sorted(names)[0]

    root = ET.fromstring(z.read(sheet_file))
    grid = []
    max_col = 0
    for row in root.iter(NS + "row"):
        cells = {}
        for c in row.findall(NS + "c"):
            ref = c.get("r")
            if not ref:
                continue
            ci = col_index(ref)
            t = c.get("t")
            v = c.find(NS + "v")
            inline = c.find(NS + "is")
            if inline is not None:
                val = "".join(x.text or "" for x in inline.iter(NS + "t"))
            elif v is None:
                val = ""
            elif t == "s":
                val = shared[int(v.text)]
            else:
                val = v.text or ""
            cells[ci] = val
            max_col = max(max_col, ci)
        grid.append([cells.get(i, "") for i in range(max_col + 1)])
    return grid


# ---------------------------------------------------------------- 版式识别


def is_code(text: str) -> bool:
    if not text:
        return False
    return len(text) >= 24 or bool(CODE_ANCHOR.search(text))


def looks_like_name(text: str) -> bool:
    if not text:
        return False
    if is_code(text):
        return False
    return 2 <= len(text.strip()) <= 60


def parse_wide(grid):
    """
    并排双栏解析：
      找出所有 (name列, code列) 相邻成对组合，
      再向上寻找该 name 列上最近的分类标题。
    """
    pairs = {}
    for r in grid:
        for i in range(len(r) - 1):
            left, right = r[i], r[i + 1]
            if looks_like_name(left) and is_code(right):
                pairs.setdefault(i, 0)
                pairs[i] += 1

    # 至少要出现两次才认为是稳定的栏位结构
    name_cols = sorted([i for i, cnt in pairs.items() if cnt >= 2])
    if not name_cols:
        return []

    # 为每个 name 列向上找分类标题：该列上、在所有数据行之前的最后一行短文本
    first_data_row = {}
    for r_i, r in enumerate(grid):
        for i in name_cols:
            if i + 1 < len(r) and looks_like_name(r[i]) and is_code(r[i + 1]):
                first_data_row.setdefault(i, r_i)

    categories = []
    for i in name_cols:
        start = first_data_row.get(i, 0)
        title = ""
        for r_i in range(start - 1, -1, -1):
            cell = grid[r_i][i] if i < len(grid[r_i]) else ""
            cell = cell.strip()
            if cell and not is_code(cell) and len(cell) <= 20:
                title = cell
                break
        items = []
        for r in grid[start:]:
            name = r[i] if i < len(r) else ""
            code = r[i + 1] if i + 1 < len(r) else ""
            name, code = name.strip(), code.strip()
            if not name or not code:
                continue
            if not looks_like_name(name) or not is_code(code):
                continue
            items.append({"name": name, "code": code})
        if items:
            categories.append({"name": title or "未分类", "items": items})
    return categories


def parse_long(grid):
    """标准三列 / 两列（表头含『资料』『口令』关键字）解析"""
    header_row, name_col, code_col, group_col = None, None, None, None
    for r_i, r in enumerate(grid):
        lowered = [c.strip().lower() for c in r]
        n_i = next((i for i, c in enumerate(lowered)
                    if any(k in c for k in NAME_KEYS)), None)
        c_i = next((i for i, c in enumerate(lowered)
                    if any(k in c for k in CODE_KEYS)), None)
        if n_i is not None and c_i is not None and n_i != c_i:
            header_row, name_col, code_col = r_i, n_i, c_i
            group_col = next((i for i, c in enumerate(lowered)
                              if any(k in c for k in GROUP_KEYS)
                              and i not in (n_i, c_i)), None)
            break
    if header_row is None:
        return []

    buckets = {}
    order = []
    for r in grid[header_row + 1:]:
        name = r[name_col].strip() if name_col < len(r) else ""
        code = r[code_col].strip() if code_col < len(r) else ""
        if not name or not code:
            continue
        group = r[group_col].strip() if (group_col is not None
                                         and group_col < len(r)) else ""
        group = group or "未分类"
        if group not in buckets:
            buckets[group] = []
            order.append(group)
        buckets[group].append({"name": name, "code": code})
    return [{"name": g, "items": buckets[g]} for g in order if buckets[g]]


# ---------------------------------------------------------------- 输出构造


def slugify(text: str) -> str:
    s = re.sub(r"[^\w\u4e00-\u9fff]+", "-", text.strip().lower()).strip("-")
    return s or "cat"


def make_id(category: str, name: str) -> str:
    raw = f"{category}::{name}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:10]


def build_document(categories, default_group, now):
    cats = []
    for order, c in enumerate(categories):
        items = []
        for it in c["items"]:
            items.append({
                "id": make_id(c["name"], it["name"]),
                "name": it["name"],
                "code": it["code"],
            })
        cats.append({
            "id": slugify(c["name"]),
            "name": c["name"],
            "group": default_group,
            "order": order,
            "items": items,
        })
    return {
        "version": now,
        "updatedAt": now,
        "categories": cats,
    }


def merge_into(existing, incoming_categories, default_group, now):
    """
    按 category.id 合并；同分类内按 name 更新 code，
    保留用户手工维护的 group / order。
    """
    by_id = {c["id"]: c for c in existing.get("categories", [])}

    for order, c in enumerate(incoming_categories):
        cid = slugify(c["name"])
        prev = by_id.get(cid, {})
        prev_items = {i["name"]: i for i in prev.get("items", [])}

        items = []
        for it in c["items"]:
            old = prev_items.get(it["name"])
            items.append({
                "id": old["id"] if old else make_id(c["name"], it["name"]),
                "name": it["name"],
                "code": it["code"],
            })

        by_id[cid] = {
            "id": cid,
            "name": c["name"],
            "group": prev.get("group") or default_group,
            "order": prev.get("order", order),
            "items": items,
        }

    existing["categories"] = sorted(by_id.values(), key=lambda x: x["order"])
    existing["updatedAt"] = now
    return existing


# ---------------------------------------------------------------- 入口


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("excel")
    ap.add_argument("--group", default="未分组", help="一级类目，如 四六级 / 考公 / 考研")
    ap.add_argument("--out", default=None)
    ap.add_argument("--merge", action="store_true", help="与现有 JSON 合并而非覆盖")
    ap.add_argument("--replace-category", action="store_true",
                    help="合并时仅替换本次 Excel 覆盖到的分类")
    args = ap.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    out = args.out or os.path.join(here, "..", "public", "data", "resources.json")
    out = os.path.normpath(out)

    grid = read_sheet(args.excel)
    categories = parse_long(grid) or parse_wide(grid)
    if not categories:
        sys.exit("未能识别 Excel 版式：未找到『资料名 + 口令』成对列，"
                 "请改为三列版式（分类 | 资料名称 | 提取口令）后重试。")

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    if args.merge and os.path.exists(out):
        with open(out, "r", encoding="utf-8") as f:
            doc = json.load(f)
        doc = merge_into(doc, categories, args.group, now)
    else:
        doc = build_document(categories, args.group, now)

    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write("\n")

    total = sum(len(c["items"]) for c in doc["categories"])
    print(f"写入 {out}")
    for c in doc["categories"]:
        print(f"  - {c['group']} / {c['name']}: {len(c['items'])} 条")
    print(f"共 {len(doc['categories'])} 个分类、{total} 条资料")


if __name__ == "__main__":
    main()
