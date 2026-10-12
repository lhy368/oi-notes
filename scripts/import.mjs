#!/usr/bin/env node
/**
 * 从训练目录导入 Markdown 到博客。
 *
 * 用法：
 *   npm run import -- --list                      列出训练目录里可导入的文件
 *   npm run import "比赛日志/2026-07-23_CF873_Div2.md"        导入（自动补 frontmatter）
 *   npm run import <文件> --tags "DP,贪心" --category 题解    手动指定标签/分类
 *   npm run import <文件> --force                 覆盖已存在的同名文章
 *
 * 行为：
 *   - 日期：从文件名 `YYYY-MM-DD_xxx.md` 解析，否则用文件修改时间
 *   - 分类：根据所在目录推断（比赛日志 → 比赛复盘，训练日志 → 训练记录 …）
 *   - 标题：取正文第一个 H1，去掉 emoji 与「比赛日志 —」这类冗余前缀
 *   - 标签：从正文自动推测算法标签（仅供参考，建议导入后自行核对）
 *   - 正文：原样复制（会移除已被用作标题的那行 H1），不修改源文件
 */

import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const POSTS_DIR = path.join(ROOT, 'src', 'content', 'posts');
const TRAINING_ROOT = path.resolve(ROOT, '..', '暑假训练');

/* ------------------------------------------------------------------ *
 * 命令行参数
 * ------------------------------------------------------------------ */
const argv = process.argv.slice(2);
const flags = {};
const positional = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  } else {
    positional.push(a);
  }
}

/* ------------------------------------------------------------------ *
 * 标签关键词表（越具体的越靠前，避免被宽泛标签抢占）
 * ------------------------------------------------------------------ */
const KEYWORDS = [
  '权值BIT', '树状数组', '线段树', '势能线段树', '树链剖分', '主席树', '平衡树',
  '并查集', '单调栈', '单调队列', 'ST表', '分块', '莫队', 'Trie',
  '树形DP', '状压DP', '数位DP', '区间DP', '动态规划', 'DP', '背包',
  '最短路', 'Dijkstra', 'SPFA', 'Floyd', '生成树', 'Kruskal', '拓扑排序',
  '二分图', '网络流', 'Tarjan', 'LCA', '强连通分量',
  '字符串哈希', 'KMP', 'Manacher', 'AC自动机', '后缀数组', 'Z函数', '字符串',
  '费马小定理', '扩展欧几里得', '欧拉函数', '逆元', '数论', '组合数学',
  '矩阵快速幂', '快速幂', '高斯消元', '博弈论', 'SG函数', '容斥', '概率期望',
  '计算几何', '构造', '贪心', '二分', '三分', '离散化', '前缀和', '差分',
  '双指针', '分治', '倍增', '交互', '模拟', '枚举', '暴力',
];

/* ------------------------------------------------------------------ *
 * 工具函数
 * ------------------------------------------------------------------ */
const EMOJI =
  /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2700}-\u{27BF}]/gu;

/** 输出为合法的 YAML 标量 */
function yaml(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const s = String(value);
  return /^[A-Za-z0-9一-龥][^:#]*$/.test(s) && !/^\s|\s$/.test(s)
    ? s
    : JSON.stringify(s);
}

/** 从文件名解析日期 */
function parseDate(filePath, text) {
  const m = path.basename(filePath).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const t = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (t) return `${t[1]}-${t[2]}-${t[3]}`;
  return null;
}

/** 根据目录推断分类 */
function inferCategory(filePath) {
  const rel = path.relative(TRAINING_ROOT, filePath).replace(/\\/g, '/');
  if (rel.includes('队伍比赛日志')) return '队伍比赛';
  if (rel.includes('队伍周报')) return '队伍周报';
  if (rel.includes('比赛日志')) return '比赛复盘';
  if (rel.includes('训练日志')) return '训练记录';
  if (rel.includes('题解')) return '题解';
  if (rel.includes('专题')) return '专题笔记';
  return '题解';
}

/** 从 H1 清洗出标题：去 emoji、去「比赛日志 — / 训练日志 —」前缀、去与日期重复的部分 */
function cleanTitle(h1) {
  let t = h1.replace(/^#+\s*/, '').replace(EMOJI, '').trim();
  t = t.replace(
    /^(比赛日志|训练日志|队伍比赛日志|队伍周报|题解|专题笔记|笔记)\s*[—–\-·|:：]?\s*/,
    ''
  );
  t = t.replace(/^\d{4}-\d{2}-\d{2}\s*[—–\-·|]?\s*/, '');
  const bracket = t.match(/^[（(](.+)[）)]$/);
  if (bracket) t = bracket[1];
  return t.trim() || h1.replace(/^#+\s*/, '').trim();
}

/** 抽掉正文开头的 H1（它已经用作 frontmatter.title） */
function stripLeadingH1(md) {
  const lines = md.split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i < lines.length && /^#\s+/.test(lines[i])) {
    i++;
    while (i < lines.length && lines[i].trim() === '') i++;
    return lines.slice(i).join('\n');
  }
  return md;
}

/** 从正文推测算法标签 */
function extractTags(text, max = 6) {
  const found = [];
  for (const kw of KEYWORDS) {
    if (found.length >= max) break;
    if (found.some((f) => f.includes(kw) || kw.includes(f))) continue;
    const hit = /^[\x00-\x7f]+$/.test(kw)
      ? new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)
      : text.includes(kw);
    if (hit) found.push(kw);
  }
  return found;
}

/** 生成 URL slug：保留中文，空格/下划线转连字符，去掉 URL 非法字符 */
function toSlug(filePath) {
  return path
    .basename(filePath, path.extname(filePath))
    .replace(/[<>:"/\\|?*]/g, '') // URL 非法字符
    .replace(/[\s_]+/g, '-') // 空格、下划线 → 连字符
    .replace(/-{2,}/g, '-') // 合并连续连字符
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

/** 在 cwd、训练目录、项目目录三处解析用户传入的路径 */
function resolveSource(input) {
  for (const candidate of [
    path.resolve(process.cwd(), input),
    path.resolve(TRAINING_ROOT, input),
    path.resolve(ROOT, input),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 子命令：--list
 * ------------------------------------------------------------------ */
async function listImportable() {
  const entries = await readdir(TRAINING_ROOT, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => path.relative(TRAINING_ROOT, path.join(e.parentPath ?? e.path, e.name)))
    .map((p) => p.replace(/\\/g, '/'))
    .sort();

  console.log(`训练目录：${TRAINING_ROOT}\n`);
  for (const f of files) {
    const done = existsSync(path.join(POSTS_DIR, `${toSlug(path.join(TRAINING_ROOT, f))}.md`));
    console.log(`  ${done ? '[已导入]' : '        '} ${f}`);
  }
  console.log(`\n共 ${files.length} 个 Markdown 文件。`);
}

/* ------------------------------------------------------------------ *
 * 主流程：导入单个文件
 * ------------------------------------------------------------------ */
async function importOne(input) {
  const src = resolveSource(input);
  if (!src) {
    console.error(`✗ 找不到文件：${input}\n  （已尝试相对于当前目录与训练目录 ${TRAINING_ROOT} 查找）`);
    return false;
  }

  const raw = await readFile(src, 'utf8');
  const h1 = raw.split(/\r?\n/).find((l) => /^#\s+/.test(l)) ?? path.basename(src, '.md');

  const title = flags.title ? String(flags.title) : cleanTitle(h1);
  const category = flags.category ? String(flags.category) : inferCategory(src);

  let date = parseDate(src, raw);
  if (!date) {
    const s = await stat(src);
    date = s.mtime.toISOString().slice(0, 10);
  }

  const tags = flags.tags
    ? String(flags.tags)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : extractTags(raw);

  const slug = toSlug(src);
  const outPath = path.join(POSTS_DIR, `${slug}.md`);

  if (existsSync(outPath) && !flags.force) {
    console.error(`✗ 已存在：${path.relative(ROOT, outPath)}\n  加 --force 可覆盖。`);
    return false;
  }

  const body = stripLeadingH1(raw);
  const relSource = path.relative(TRAINING_ROOT, src).replace(/\\/g, '/');

  const front = [
    '---',
    `title: ${yaml(title)}`,
    `date: ${date}`,
    `category: ${yaml(category)}`,
    `tags: [${tags.map(yaml).join(', ')}]`,
    `source: ${yaml(relSource)}`,
    '---',
    '',
  ].join('\n');

  await mkdir(POSTS_DIR, { recursive: true });
  await writeFile(outPath, front + body.trimStart() + '\n', 'utf8');

  console.log(`✓ 导入 ${relSource}`);
  console.log(`  → src/content/posts/${slug}.md`);
  console.log(`  标题：${title}`);
  console.log(`  分类：${category}　日期：${date}`);
  console.log(`  标签：${tags.length ? tags.join('、') : '（无，建议手动补充）'}`);
  console.log(`  ⚠ 标签为自动推测，请打开文件核对，并检查是否含不便公开的内容。`);
  return true;
}

/* ------------------------------------------------------------------ *
 * 入口
 * ------------------------------------------------------------------ */
async function main() {
  if (flags.help || flags.h) {
    console.log(
      [
        '用法：',
        '  npm run import -- --list                          列出可导入的文件',
        '  npm run import <文件>                             导入并自动补 frontmatter',
        '  npm run import <文件> --tags "DP,贪心"            指定标签',
        '  npm run import <文件> --category 题解             指定分类',
        '  npm run import <文件> --title "自定义标题"        指定标题',
        '  npm run import <文件> --force                     覆盖同名文章',
      ].join('\n')
    );
    return;
  }

  if (flags.list) return listImportable();

  if (positional.length === 0) {
    console.error(
      '✗ 请指定要导入的文件，或使用 --list 查看候选。\n  例：npm run import "比赛日志/2026-07-23_CF873_Div2.md"'
    );
    process.exitCode = 1;
    return;
  }

  let ok = 0;
  for (const file of positional) {
    if (await importOne(file)) ok++;
  }
  if (ok > 0) console.log(`\n完成。运行 npm run dev 预览：http://localhost:4321`);
  if (ok < positional.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
