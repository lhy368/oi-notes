# OI Notes

林恒毅的算法竞赛题解与训练记录。基于 [Astro](https://astro.build) 构建的静态博客，
内容源是 `Desktop/oi/暑假训练/` 里的 Markdown 日志。

**核心思路**：训练目录始终是唯一真相源，博客只是它的发布端。
写日志的习惯不用改，导入脚本负责补 frontmatter。

---

## 常用命令

```bash
npm run dev        # 本地预览，http://localhost:4321（改文件自动刷新）
npm run build      # 构建静态站点到 dist/
npm run preview    # 预览构建结果
npm run import -- --list    # 列出训练目录里所有可导入的文件
```

---

## 写文章

### 方式一：从训练目录导入（推荐）

```bash
# 看看有哪些文件
npm run import -- --list

# 导入一篇（路径可以是相对于训练目录的，也可以写绝对路径）
npm run import "比赛日志/2026-07-23_CF873_Div2.md"

# 手动指定标签 / 分类 / 标题
npm run import "训练日志/2026-09-16_赛前冲刺_线段树BIT.md" --tags "线段树,权值BIT"

# 覆盖已导入的同名文章
npm run import "比赛日志/2026-07-23_CF873_Div2.md" --force
```

脚本会自动：

- 从文件名 `YYYY-MM-DD_xxx.md` 解析日期
- 从所在目录推断分类（`比赛日志/` → 比赛复盘，`训练日志/` → 训练记录 …）
- 从正文第一个 H1 提取标题，去掉 emoji 和「比赛日志 —」这类前缀
- **根据正文推测算法标签**（仅供参考，导入后请打开文件核对）
- 移除已被用作标题的那行 H1，避免页面里出现两个大标题
- 原文一个字都不改

> ⚠️ 博客是公开的。日志里「被指正后才过」这类记录导入前想清楚要不要公开，
> 不想发就把 `draft: true` 写进 frontmatter，或在导入后自行删改。

### 方式二：直接新建

在 `src/content/posts/` 下建 `.md` 文件，头部写好 frontmatter：

```markdown
---
title: CF1887E - Good Colorings
date: 2026-10-12
category: 题解
tags: [构造, 交互, 二分]
contest: Codeforces Round 906 (Div. 1)
difficulty: 2500
verdict: 赛后补题
draft: false
---

正文……
```

---

## frontmatter 字段

| 字段 | 必填 | 说明 |
|:---|:---:|:---|
| `title` | ✅ | 文章标题 |
| `date` | ✅ | 日期，`YYYY-MM-DD` |
| `tags` | | 算法标签数组，决定归档页 |
| `category` | | 比赛复盘 / 训练记录 / 题解 / 专题笔记 |
| `contest` | | 来源比赛 |
| `difficulty` | | CF 分数或洛谷难度 |
| `verdict` | | 独立 AC / 看题解后 AC / 赛后补题 |
| `source` | | 原文件在训练目录中的相对路径（导入时自动写入） |
| `draft` | | `true` 则不发布 |

---

## 目录结构

```
blog/
├── astro.config.mjs          # 站点配置（数学公式、代码高亮、部署域名）
├── scripts/import.mjs        # 训练目录 → 博客 的导入脚本
└── src/
    ├── content.config.ts     # 文章 schema（frontmatter 的字段定义）
    ├── content/posts/        # 文章正文
    ├── layouts/Base.astro    # 页面骨架
    ├── pages/
    │   ├── index.astro       # 首页：按年份分组的文章列表
    │   ├── posts/[...slug].astro   # 文章详情页
    │   ├── tags/index.astro        # 标签总览
    │   ├── tags/[tag].astro        # 单个标签下的文章
    │   └── about.astro             # 关于页
    └── styles/global.css     # 样式（自动跟随系统浅色/深色）
```

---

## 部署

### Cloudflare Pages（推荐，国内访问相对稳）

1. 把 `blog/` 推到一个 GitHub 仓库
2. Cloudflare Dashboard → Pages → 连接该仓库
3. 构建命令 `npm run build`，输出目录 `dist`
4. 绑定自己的域名

### GitHub Pages

1. 修改 `astro.config.mjs` 里的 `site` 为 `https://<用户名>.github.io/<仓库名>`
2. 若仓库不是 `<用户名>.github.io`，还要设 `base: '/<仓库名>'`
3. 推代码后用官方 GitHub Action（搜索 `withastro/action`）自动构建部署

---

## 排版提示

- 数学公式用 `$...$`（行内）和 `$$...$$`（独立行），由 KaTeX 渲染
- 代码块写 ` ```cpp ` 等语言标记，自动语法高亮
- 表格、引用块、任务列表都支持——比赛日志里那套表格可以原样贴
