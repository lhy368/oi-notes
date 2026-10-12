import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * 文章集合。
 * 内容源：src/content/posts/ 下的 Markdown 文件。
 * 这些文件由 `npm run import <训练目录里的文件>` 从训练日志导入并自动补全 frontmatter。
 */
const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    /** 算法标签，用于归档与筛选，例如 [DP, 图论, 权值BIT] */
    tags: z.array(z.string()).default([]),
    /** 分类：比赛复盘 / 训练记录 / 专题笔记 / 题解 */
    category: z.string().default('题解'),
    /** 来源比赛，例如 "Codeforces Round 873 (Div. 2)" */
    contest: z.string().optional(),
    /** 难度：CF 分数或洛谷难度标签 */
    difficulty: z.union([z.string(), z.number()]).optional(),
    /** 过题状态：独立 AC / 看题解后 AC / 赛后补题 */
    verdict: z.string().optional(),
    /** 摘要，列表页展示用 */
    summary: z.string().optional(),
    /** 原始文件在训练目录中的相对路径，便于追溯与重新导入 */
    source: z.string().optional(),
    /** 标记为草稿则不发布 */
    draft: z.boolean().default(false),
  }),
});

export const collections = { posts };
