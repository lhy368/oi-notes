import { defineConfig } from 'astro/config';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// https://astro.build/config
export default defineConfig({
  // 部署后改成你的实际域名（GitHub Pages 形如 https://<用户名>.github.io/<仓库名>）
  site: 'https://example.com',

  markdown: {
    // 支持 $...$ 与 $$...$$ 数学公式
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex],
    shikiConfig: {
      // 浅色/深色两套代码高亮主题
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      wrap: false,
    },
  },
});
