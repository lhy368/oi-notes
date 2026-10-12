#!/usr/bin/env node
/**
 * 把博客文章发布到博客园（cnblogs）。
 *
 * 走博客园的 MetaWeblog API（XML-RPC）。
 *
 * 用法：
 *   npm run publish -- --list            列出文章及其发布状态
 *   npm run publish -- <slug>            发布某一篇
 *   npm run publish -- --all             发布所有还没发布过的
 *   npm run publish -- <slug> --draft    发成草稿（不公开）
 *   npm run publish -- <slug> --update   更新已发布的文章
 *
 * 凭据从项目根目录的 .env 读取（该文件已被 .gitignore 忽略）：
 *   CNBLOGS_BLOG=你的博客名        （博客地址里那一段）
 *   CNBLOGS_USER=你的登录名
 *   CNBLOGS_TOKEN=访问令牌
 *
 * 已发布文章的 postId 记录在 .published.json，用于后续更新。
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const POSTS_DIR = path.join(ROOT, 'src', 'content', 'posts');
const ENV_PATH = path.join(ROOT, '.env');
const STATE_PATH = path.join(ROOT, '.published.json');

/* ------------------------------------------------------------------ *
 * 配置读取
 * ------------------------------------------------------------------ */
async function loadEnv() {
  if (!existsSync(ENV_PATH)) {
    console.error(
      `✗ 找不到 ${ENV_PATH}\n  请先复制 .env.example 为 .env 并填入博客园凭据。`
    );
    process.exit(1);
  }
  const text = await readFile(ENV_PATH, 'utf8');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  for (const key of ['CNBLOGS_BLOG', 'CNBLOGS_USER', 'CNBLOGS_TOKEN']) {
    if (!env[key]) {
      console.error(`✗ .env 里缺少 ${key}`);
      process.exit(1);
    }
  }
  return env;
}

/* ------------------------------------------------------------------ *
 * frontmatter
 * ------------------------------------------------------------------ */
function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: raw };

  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const rawVal = kv[2].trim();
    if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
      data[key] = rawVal
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else {
      data[key] = rawVal.replace(/^["']|["']$/g, '');
    }
  }
  return { data, body: m[2] };
}

/* ------------------------------------------------------------------ *
 * XML-RPC（博客园 MetaWeblog）
 * ------------------------------------------------------------------ */
const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 把 JS 值编码成 XML-RPC 的 <value> 节点 */
function xmlValue(v) {
  if (typeof v === 'boolean') return `<value><boolean>${v ? 1 : 0}</boolean></value>`;
  if (typeof v === 'number') return `<value><int>${v}</int></value>`;
  if (Array.isArray(v)) {
    return `<value><array><data>${v.map(xmlValue).join('')}</data></array></value>`;
  }
  if (v && typeof v === 'object') {
    return `<value><struct>${Object.entries(v)
      .map(([k, val]) => `<member><name>${esc(k)}</name>${xmlValue(val)}</member>`)
      .join('')}</struct></value>`;
  }
  return `<value><string>${esc(v ?? '')}</string></value>`;
}

function buildCall(method, params) {
  return (
    `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>` +
    params.map((p) => `<param>${xmlValue(p)}</param>`).join('') +
    `</params></methodCall>`
  );
}

/** 从 XML 响应中取出 <value> 里的标量；有 <fault> 则抛错 */
function parseResponse(xml) {
  const fault = xml.match(/<fault>[\s\S]*?<name>faultString<\/name>\s*<value>\s*<string>([\s\S]*?)<\/string>/);
  if (fault) throw new Error(`博客园返回错误：${fault[1]}`);
  if (xml.includes('<fault>')) throw new Error(`博客园返回错误：${xml.slice(0, 400)}`);

  const val = xml.match(/<param>\s*<value>\s*(?:<string>([\s\S]*?)<\/string>|<int>(\d+)<\/int>)/);
  if (!val) return xml;
  return val[1] ?? val[2];
}

async function rpc(endpoint, method, params) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml', 'User-Agent': 'oi-notes-publisher/1.0' },
    body: buildCall(method, params),
  });
  const text = await res.text();
  if (!res.ok && !text.includes('<methodResponse>')) {
    throw new Error(`HTTP ${res.status}：${text.slice(0, 300)}`);
  }
  return parseResponse(text);
}

/* ------------------------------------------------------------------ *
 * 状态文件
 * ------------------------------------------------------------------ */
async function loadState() {
  if (!existsSync(STATE_PATH)) return {};
  try {
    return JSON.parse(await readFile(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ *
 * 文章读取
 * ------------------------------------------------------------------ */
async function loadPosts() {
  await readdir(POSTS_DIR).catch(() => {});
  const files = (await readdir(POSTS_DIR).catch(() => []))
    .filter((f) => f.endsWith('.md'))
    .sort();

  const posts = [];
  for (const f of files) {
    const raw = await readFile(path.join(POSTS_DIR, f), 'utf8');
    const { data, body } = parseFrontmatter(raw);
    if (data.draft === 'true') continue; // 标了草稿的跳过
    posts.push({
      slug: f.replace(/\.md$/, ''),
      file: f,
      title: data.title || f,
      date: data.date || '',
      category: data.category || '题解',
      tags: Array.isArray(data.tags) ? data.tags : [],
      body,
    });
  }
  // 按日期排
  return posts.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */
const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) flags[a.slice(2)] = true;
  else positional.push(a);
}

async function main() {
  const posts = await loadPosts();
  const state = await loadState();

  if (flags.list || (positional.length === 0 && !flags.all)) {
    console.log(`共 ${posts.length} 篇文章：\n`);
    for (const p of posts) {
      const st = state[p.slug];
      const mark = st ? `[已发布 id=${st.postId}]` : '[ 未发布 ]';
      console.log(`  ${mark}  ${p.date}  ${p.title}`);
      console.log(`              slug: ${p.slug}`);
    }
    console.log('\n发布：npm run publish -- <slug>      全部发布：npm run publish -- --all');
    return;
  }

  const targets = flags.all
    ? posts.filter((p) => !state[p.slug])
    : posts.filter((p) => positional.includes(p.slug));

  if (targets.length === 0) {
    console.log(positional.length ? '✗ 没找到匹配的文章（用 --list 查看 slug）' : '✓ 没有待发布的文章');
    return;
  }

  const env = await loadEnv();
  const endpoint = `https://rpc.cnblogs.com/metaweblog/${env.CNBLOGS_BLOG}`;
  const isDraft = !!flags.draft;

  console.log(`博客：${env.CNBLOGS_BLOG}\n待处理 ${targets.length} 篇\n`);

  for (const post of targets) {
    const existing = state[post.slug];
    const shouldUpdate = !!flags.update && existing;

    // 直接把 Markdown 原文提交给博客园，由它自己渲染成 HTML。
    // 分类里必须带 [Markdown]，否则博客园会把 Markdown 当纯文本原样显示。
    const categories = ['[Markdown]', post.category];
    const postStruct = {
      title: post.title,
      description: post.body,
      categories,
      mt_keywords: post.tags.join(','),
    };

    try {
      let postId;
      if (shouldUpdate) {
        await rpc(endpoint, 'metaWeblog.editPost', [
          existing.postId,
          env.CNBLOGS_USER,
          env.CNBLOGS_TOKEN,
          postStruct,
          !isDraft,
        ]);
        postId = existing.postId;
        console.log(`✓ 已更新：${post.title}`);
      } else {
        postId = await rpc(endpoint, 'metaWeblog.newPost', [
          env.CNBLOGS_BLOG,
          env.CNBLOGS_USER,
          env.CNBLOGS_TOKEN,
          postStruct,
          !isDraft,
        ]);
        console.log(`✓ ${isDraft ? '已存为草稿' : '已发布'}：${post.title}  (id=${postId})`);
      }
      state[post.slug] = { postId, title: post.title, date: post.date, at: new Date().toISOString() };
      await writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
    } catch (err) {
      console.error(`✗ 失败：${post.title}\n  ${err.message}`);
      if (/403|已在|禁用/i.test(err.message)) {
        console.error('  提示：确认 .env 的令牌是最新的，且「其他设置」里已开启博客客户端访问。');
      }
      process.exitCode = 1;
    }

    // 避免触发博客园的频率限制
    await new Promise((r) => setTimeout(r, 3500));
  }

  console.log('\n完成。到 https://i.cnblogs.com/posts 查看。');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
