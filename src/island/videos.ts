/**
 * B 站最近的作品（只放最近 12 个，旧作品不展示）。
 * 列表在 src/data/videos.json，由 ~/xiaodao-ai/scripts/sync_bilibili.py 随每天的自动同步更新（标题、日期取自 B 站详情接口），不再手工改。
 */
import data from '@/data/videos.json';

export interface Video { bvid: string; title: string; date: string; series?: 'pencil' | 'pi' }

export const BILIBILI_SPACE = 'https://space.bilibili.com/108463642';
export const videoUrl = (bvid: string) => `https://www.bilibili.com/video/${bvid}`;
/** B 站站外播放器：嵌在页面里放完整视频（有声音、能全屏）。 */
export const playerUrl = (bvid: string) => `https://player.bilibili.com/player.html?bvid=${bvid}&autoplay=1&high_quality=1&danmaku=0`;
/** 小岛介绍片：放映台银幕上循环播它的静音片段（public/island/cinema-loop.mp4），点银幕在页面里放完整版。 */
export const ISLAND_FILM = { bvid: 'BV1WJpE6QE21', title: '这不是游戏，是我的个人网站', date: '2026-10-11' } as const;
/** 封面已下载压缩到 public/videos/<bvid>.webp（480 宽），不从 B 站热链。 */
export const videoCover = (bvid: string) => `/videos/${bvid}.webp`;

/** 主推课程：固定排在最前面的位置（视频页、日报页、岛上船坞都用这一份）。url 为 null 表示还没上架。 */
export interface Featured { id: string; title: string; subtitle: string; status: string; url: string | null; cover: string; trailer?: string; trailerLabel?: string }
export const FEATURED: Featured[] = [
  {
    id: 'pi', title: 'AI Agent 是怎么造出来的：拆开开源 Pi', subtitle: '用彩铅动画一集拆开 pi 的一个设计决定，看懂一个能干活的 AI 编程 Agent 是怎么搭起来的。',
    status: '已上线 · B 站课堂', url: 'https://www.bilibili.com/cheese/play/ss918087467', cover: '/videos/pi-course.webp', trailer: 'BV17Ma86wEbA', trailerLabel: 'Pi 课 56 秒免费预告',
  },
  {
    id: 'agent', title: 'Agent 工程课：把 AI 做成能用的产品', subtitle: '一套 14 集的彩铅动画视频课。造一艘船，就是造一个 Agent。',
    status: '已上线 · B 站课堂', url: 'https://www.bilibili.com/cheese/play/ss226962156', cover: '/videos/agent-course.webp', trailer: 'BV1RMYF6rE5J', trailerLabel: 'Agent 工程课 47 秒预告',
  },
];

const isSeries = (s: string | undefined): s is Video['series'] => s === undefined || s === 'pencil' || s === 'pi';
const BVID = /^BV\w+$/, DATE = /^\d{4}-\d{2}-\d{2}$/;

/** videos.json 是脚本生成的：逐条核对，格式不对的丢掉并在构建日志里报出来，不让它把页面带崩。 */
export const RECENT_VIDEOS: Video[] = data.videos.flatMap((v, i) => {
  if (!BVID.test(v.bvid) || !DATE.test(v.date) || !v.title || !isSeries(v.series)) {
    console.error(`[videos] videos.json 第 ${i} 条格式不对，已跳过：${JSON.stringify(v)}`);
    return [];
  }
  return [{ bvid: v.bvid, title: v.title, date: v.date, ...(v.series ? { series: v.series } : {}) }];
});
