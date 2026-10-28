/**
 * 给搜索引擎看的结构化数据（schema.org JSON-LD）：网站、作者、文章、面包屑。
 * 只描述页面上真实存在的信息，不夸大。
 */
const SITE = 'https://xiaodao.ai';
const abs = (path: string) => new URL(path, SITE).toString();

/** 作者：用品牌名「小岛AI」，同一个人在 B 站的主页用 sameAs 关联起来。 */
export const AUTHOR = {
  '@type': 'Person',
  name: '小岛AI',
  url: abs('/about/'),
  description: 'AI Harness 工程师，在创业公司给大模型搭脚手架，记录一线实战、踩坑与判断。',
  sameAs: ['https://space.bilibili.com/108463642'],
} as const;

export function websiteLd(description: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: '小岛AI',
    alternateName: '小岛AI · AI 航行日志',
    url: abs('/'),
    description,
    inLanguage: 'zh-CN',
    publisher: AUTHOR,
  };
}

export interface PostLdInput { slug: string; title: string; summary: string; pubDate: Date; cover?: string; tags: string[] }

export function postLd(p: PostLdInput) {
  const url = abs(`/posts/${p.slug}/`);
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: p.title,
      description: p.summary,
      datePublished: p.pubDate.toISOString(),
      dateModified: p.pubDate.toISOString(),
      inLanguage: 'zh-CN',
      url,
      mainEntityOfPage: url,
      image: abs(p.cover ?? '/island/og.jpg'),
      ...(p.tags.length ? { keywords: p.tags.join(', ') } : {}),
      author: AUTHOR,
      publisher: AUTHOR,
    },
    breadcrumbLd([['小岛', '/'], ['全部文章', '/archive/'], [p.title, `/posts/${p.slug}/`]]),
  ];
}

export function breadcrumbLd(items: [string, string][]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: abs(path) })),
  };
}

/** 序列化成可以直接放进 <script> 的字符串（转义 <，防止提前闭合标签）。 */
export const ldJson = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');
