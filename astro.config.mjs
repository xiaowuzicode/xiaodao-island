import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

/**
 * 正文图片懒加载：第一张照常加载（多半在首屏），后面的滚到附近才下载，并异步解码。
 * 国内走国际线路，一篇文章十几张图同时抢带宽，正文和首图都会被拖慢。
 */
function rehypeLazyImages() {
  return (tree) => {
    let seen = 0;
    const walk = (node) => {
      if (node.type === 'element' && node.tagName === 'img') {
        node.properties.decoding = 'async';
        if (seen++ > 0) node.properties.loading = 'lazy';
      }
      node.children?.forEach(walk);
    };
    walk(tree);
  };
}

export default defineConfig({
  site: 'https://xiaodao.ai',
  integrations: [sitemap()],
  // 样式直接写进 HTML：国内访问 Vercel 时每多一个请求就多一次卡住的机会，
  // 曾出现 HTML 到了、CSS 没到，页面只剩光秃秃的文字和链接。样式每页只有几 KB，内联更稳。
  build: { inlineStylesheets: 'always' },
  markdown: { rehypePlugins: [rehypeLazyImages] },
});
