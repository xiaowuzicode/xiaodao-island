/**
 * 岛上每个地点对应的内容。规则：房子放成套的，船放新来的，小岛放系列。
 * 文章与日报来自构建时注入的数据（index.astro），课程与视频链接在 LINKS 里手工维护。
 */
import type { View } from '@/island/config';
import { BILIBILI_SPACE, ISLAND_FILM, RECENT_VIDEOS, videoUrl } from '@/island/videos';

export interface IslandPost { title: string; summary: string; date: string; url: string }
export interface IslandDaily { date: string; issueNo: number; count: number; url: string; headlines: string[] }
export interface IslandData {
  posts: IslandPost[];
  postCount: number;
  daily: IslandDaily | null;
  issueCount: number;
  /** 给码头钓鱼的岛民「钓」的旧文章：从一个月前往回均匀抽样。 */
  archive: { title: string; url: string; date: string }[];
  /** 专题（渔港夜市一个摊位一个）：篇数和最新一篇。 */
  topics: IslandTopic[];
}
export interface IslandTopic { slug: string; name: string; count: number; url: string; latest: { title: string; url: string } | null }

/** 外部链接。值为 null 表示还没有可公开的地址：卡片不出按钮，只写"即将上架"。 */
export const LINKS = {
  piCourse: 'https://www.bilibili.com/cheese/play/ss918087467',
  /** Agent 工程课：2026-10-05 在 B 站课堂上线。 */
  agentCourse: 'https://www.bilibili.com/cheese/play/ss226962156' as string | null,
  bilibili: BILIBILI_SPACE,
};
/** 公众号二维码（public/island/wechat-qr.jpg，344×344）。 */
export const WECHAT_QR = '/island/wechat-qr.jpg';

const videoItem = (v: (typeof RECENT_VIDEOS)[number]): CardItem => ({ label: v.title, sub: `B 站 · ${v.date}`, url: videoUrl(v.bvid) });

/** play：B 站 bvid，点了在页面里的播放窗放、不跳走（url 留给新标签页打开）。 */
export interface CardItem { label: string; sub?: string; url?: string | null; play?: string }
export interface Card {
  eyebrow: string;
  title: string;
  lede: string;
  items: CardItem[];
  cta?: { label: string; url: string; external?: boolean };
  /** 卡片里的一张图（比如公众号二维码）。 */
  image?: { src: string; alt: string; caption: string; size: number };
  /** 卡片底部的次要链接，一行排开。 */
  links?: { label: string; url: string }[];
  note?: string;
}
export type PlaceId = 'lighthouse' | 'press' | 'keeper' | 'shipyard' | 'cinema' | 'market' | 'next' | 'pencil' | 'ship' | 'mail';
export interface Place {
  id: PlaceId;
  name: string;
  /** 路牌挂在哪（世界坐标）。船类地点的路牌跟着船走，这里留空。 */
  anchor?: [number, number, number];
  view?: View;
  /** 是否出现在底部航海图 dock 里。 */
  dock: boolean;
  /** 在画布上点多近（水平米数）算点中它；占地大的地点（整条夜市街）比默认的大。 */
  pickRadius?: number;
  card: (d: IslandData) => Card;
}

const latestPost = (d: IslandData) => d.posts[0];

export const PLACES: Place[] = [
  {
    id: 'lighthouse', name: '灯塔', anchor: [30, 15.2, 0], dock: true,
    view: { look: [26, 7, 1], dist: 46, az: 1.3, tilt: 0.3 },
    card: (d) => ({
      eyebrow: 'LIGHTHOUSE · 最新信号',
      title: '灯塔',
      lede: '岛上的主角。夜里亮灯，光束会停在最近更新的地方。现在照着的是：',
      items: [
        ...(latestPost(d) ? [{ label: latestPost(d).title, sub: `新文章 · ${latestPost(d).date}`, url: latestPost(d).url }] : []),
        ...(d.daily ? [{ label: `日报第 ${d.daily.issueNo} 期 · ${d.daily.count} 条信号`, sub: d.daily.date, url: d.daily.url }] : []),
      ],
    }),
  },
  {
    id: 'press', name: '岛刊社', anchor: [-3, 9.4, 13.6], dock: true,
    view: { look: [-3, 4, 15], dist: 58, az: 0.32, tilt: 0.42 },
    card: (d) => ({
      eyebrow: 'ISLAND PRESS · 文章与日报',
      title: '岛刊社',
      lede: `${d.postCount} 篇文章、${d.issueCount} 期日报都收在这里。记录一线实战、踩坑与判断。`,
      items: d.posts.slice(0, 5).map((p) => ({ label: p.title, sub: p.date, url: p.url })),
      cta: { label: '翻阅全部文章', url: '/archive/' },
      links: [{ label: '专题', url: '/topics/' }, { label: '日报', url: '/daily/' }, { label: '日报翻页册', url: '/daily/book/' }],
    }),
  },
  {
    id: 'keeper', name: '岛主小屋', anchor: [-2, 9.8, -3], dock: true,
    view: { look: [-3, 6, -4], dist: 38, az: 0.9, tilt: 0.52 },
    card: () => ({
      eyebrow: 'ISLAND KEEPER · 关于',
      title: '岛主小屋',
      lede: 'AI Harness 工程师，在创业公司给大模型搭脚手架。写一线实战、踩坑与判断，偶尔泼冷水。',
      image: { src: WECHAT_QR, alt: '公众号「小岛AI」二维码', caption: '微信扫码关注公众号「小岛AI」', size: 150 },
      items: [
        { label: 'B 站', sub: '胖胖不胖的AI小岛', url: LINKS.bilibili },
        { label: 'RSS 订阅', sub: '/rss.xml', url: '/rss.xml' },
        { label: '给 AI 读的站点说明', sub: '/llms.txt', url: '/llms.txt' },
      ],
      cta: { label: '认识岛主', url: '/about/' },
    }),
  },
  {
    id: 'shipyard', name: '船坞', anchor: [-25, 7.8, 9], dock: true,
    view: { look: [-24, 2.5, 10], dist: 36, az: -0.9, tilt: 0.4 },
    card: () => {
      return {
        eyebrow: 'SHIPYARD · 课程',
        title: '课程船坞',
        lede: '造一艘船，就是造一个 Agent。已经下水的两门课可以直接上船；船台上那艘，是下一门课。',
        items: [
          { label: 'AI Agent 是怎么造出来的：拆开开源 Pi', sub: '已下水 · B 站课堂', url: LINKS.piCourse },
          { label: '先看 56 秒免费预告', sub: 'B 站 · 2026-09-27', url: videoUrl('BV17Ma86wEbA') },
          { label: 'Agent 工程课：把 AI 做成能用的产品', sub: LINKS.agentCourse ? '已下水 · B 站课堂' : '在建 · 即将在 B 站上架', url: LINKS.agentCourse },
          { label: '先看 47 秒预告', sub: 'B 站 · 2026-10-03', url: videoUrl('BV1RMYF6rE5J') },
        ],
        cta: { label: '去 B 站看课程', url: LINKS.piCourse, external: true },
      };
    },
  },
  {
    id: 'cinema', name: '放映台', anchor: [12, 6.6, 8], dock: true,
    // 正对银幕（银幕在放片），观众席在镜头前
    view: { look: [12, 3, 9], dist: 32, az: -0.2, tilt: 0.42 },
    card: () => ({
      eyebrow: 'CINEMA · B 站放映台',
      title: '放映台',
      lede: `银幕上正在放小岛介绍片，点银幕或下面第一条就能带声音看完整版。再往下是 B 站最近的作品。`,
      items: [
        { label: ISLAND_FILM.title, sub: `小岛介绍片 · 在这里直接播放`, url: videoUrl(ISLAND_FILM.bvid), play: ISLAND_FILM.bvid },
        ...RECENT_VIDEOS.filter((v) => v.bvid !== ISLAND_FILM.bvid).map(videoItem),
      ],
      cta: { label: '看全部课程与视频', url: '/videos/' },
      links: [{ label: 'B 站主页', url: LINKS.bilibili }],
    }),
  },
  {
    // 锚点和机位对着夜市街的中点（market-plan.ts 的 laneAt(LANE_LEN / 2, 0)，check:island 会核对）
    id: 'market', name: '渔港夜市', anchor: [-14.8, 5.4, 29.1], dock: true, pickRadius: 7.5,
    view: { look: [-14.8, 2, 29.4], dist: 30, az: 0.15, tilt: 0.42 },
    card: (d) => ({
      eyebrow: 'NIGHT MARKET · 按话题逛',
      title: '渔港夜市',
      lede: '一个专题一个摊位。白天这里是渔港，天黑灯一亮，摊子全开张——挑个话题，一路翻下去。',
      items: d.topics.map((t) => ({ label: t.name, sub: `${t.count} 篇${t.latest ? ` · 最新：${t.latest.title}` : ''}`, url: t.url })),
      cta: { label: '全部专题', url: '/topics/' },
    }),
  },
  {
    id: 'next', name: '无名岛', anchor: [56, 6.4, 26], dock: true,
    view: { look: [56, 2, 26], dist: 34, az: 1.0, tilt: 0.42 },
    card: () => ({
      eyebrow: 'NEXT ISLAND · 待命名',
      title: '无名岛',
      lede: '一座还没起名字的小岛，先搭了个登陆营地。下一个系列做出来，就在这里靠岸。',
      items: [],
      note: '敬请期待',
    }),
  },
  {
    id: 'pencil', name: '彩铅屿', anchor: [-50, 7, 30], dock: true,
    view: { look: [-50, 2, 30], dist: 34, az: -0.75, tilt: 0.42 },
    card: () => ({
      eyebrow: 'PENCIL ISLET · 视频系列',
      title: '大模型基础 · 彩铅系列',
      lede: '3 分钟一集，用彩铅动画讲清那些天天见、却说不清的词。',
      items: RECENT_VIDEOS.filter((v) => v.series === 'pencil').map(videoItem),
      cta: { label: '去 B 站看全部', url: LINKS.bilibili, external: true },
    }),
  },
  {
    id: 'ship', name: '新文章', dock: false,
    card: (d) => {
      const p = latestPost(d);
      return {
        eyebrow: 'NEW ARRIVAL · 刚靠岸',
        title: p ? p.title : '新文章',
        lede: p ? p.summary : '',
        items: [],
        ...(p ? { cta: { label: '读这一篇', url: p.url } } : {}),
        note: p ? `每篇新文章是一艘船，开到岛刊社的码头靠岸 · ${p.date}` : undefined,
      };
    },
  },
  {
    id: 'mail', name: '日报邮船', dock: false,
    view: { look: [-2.7, 1, 31], dist: 30, az: -0.5, tilt: 0.35 },
    card: (d) => ({
      eyebrow: 'DAILY MAIL · 今日日报',
      title: d.daily ? `日报第 ${d.daily.issueNo} 期` : '日报',
      lede: d.daily ? `${d.daily.date} · ${d.daily.count} 条信号，每条带一句判断。` : '',
      items: (d.daily?.headlines ?? []).map((h) => ({ label: h })),
      ...(d.daily ? { cta: { label: '读今天的日报', url: d.daily.url } } : {}),
    }),
  },
];

export const placeById = (id: string) => PLACES.find((p) => p.id === id);
