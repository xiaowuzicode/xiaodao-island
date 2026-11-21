/**
 * 小岛邮差：六封信里装的是什么（纯计算，构建时 walk.astro 调它，结果塞进页面的数据块）。
 * 每封信拆开是频道真实的一篇文章、一期日报、一门课或一期视频里的一句话，带「去看看」的链接（新标签页打开）。
 * 按人配信（试玩第 1 轮：钓鱼的周伯收到「千问开放平台」、退休的许婆和夜猫子小北收到同一条新闻，信和人没关系）：
 * 1 周伯（钓鱼的）讲这座能钓鱼的岛的那篇（没有就一个月前的旧文章）· 2 许婆 最新一期日报（头条避开和别的信撞题的）·
 * 3 阿勇（船坞）「造一艘船，就是造一个 Agent」的 Agent 课 · 4 老林（灯塔）跟着「灯塔几点亮？」的大模型原理课（没有就最新文章）·
 * 5 小鱼（小学生）一期彩铅动画 · 6 小北（夜猫子）最新文章（老林拿了最新的就第二新的）。
 * 每封信带一句收信人读完的反应（react）。文章不够、没有日报时用别的文章顶上，再不够用列表页；永远返回六条、六条的链接各不相同。
 */

export type LetterKind = 'post' | 'daily' | 'course' | 'video' | 'list';
/** more：信纸上「一句话」后面接着读的那一段（文章摘要剩下的部分、课程简介，最长 MORE_MAX 字；没有就不出）。 */
/** react：收信人读完说的一句（信纸底下）；sameTitle：「一句话」就是标题本身（信纸上不再重复一遍出处）。 */
export interface LetterContent { id: 1 | 2 | 3 | 4 | 5 | 6; kind: LetterKind; kicker: string; title: string; line: string; more?: string; url: string; external: boolean; react?: string; sameTitle?: boolean }
export interface LetterPost { title: string; summary: string; date: string; url: string }
/** headlines：这一期所有条目的标题（头条撞题时往后挑）。 */
export interface LetterDaily { date: string; issueNo: number; headline: string | null; url: string; headlines?: string[] }
/** id：课程编号（agent 造船那门给船坞的阿勇，llm「灯塔几点亮？」那门给灯塔的老林）。 */
export interface LetterCourse { title: string; subtitle: string; url: string | null; id?: string }
export interface LetterVideo { title: string; url: string; pencil: boolean }
export interface LetterSource { posts: LetterPost[]; daily: LetterDaily | null; courses: LetterCourse[]; videos: LetterVideo[]; today: string }

/** 「一句话」最长多少字：再长就整句不要、改用标题。 */
export const LINE_MAX = 48;

/**
 * 把一段话按句切开（按「。！？」切，带上那个标点）；引号、括号里的问号叹号不算句子完（「灯塔几点亮?」这一句话……是一句）。
 */
export function sentences(text: string): string[] {
  const t = text.replace(/\s+/g, ' ').trim(), out: string[] = [];
  let depth = 0, from = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if ('「『“（(《'.includes(ch)) depth++;
    else if ('」』”）)》'.includes(ch)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && '。！？!?'.includes(ch)) { out.push(t.slice(from, i + 1).trim()); from = i + 1; }
  }
  if (from < t.length && t.slice(from).trim()) out.push(t.slice(from).trim());
  return out;
}
/** 取第一句；超过 48 字就不要。 */
export function firstSentence(text: string): string | null {
  const s = sentences(text)[0];
  return s && s.length <= LINE_MAX ? s : null;
}
const clip = (s: string) => (s.length <= LINE_MAX ? s : `${s.slice(0, LINE_MAX - 1)}…`);
/** 信纸上接着读的那一段最长多少字（M2 验收：信纸只有一句话，读完就没了；多放一段可读的）。 */
export const MORE_MAX = 120;
/** 一段话里去掉已经当「一句话」用过的开头，剩下的按整句截到 MORE_MAX 字以内（一句都放不下就按字截、加省略号）。 */
export function moreOf(text: string, used: string): string {
  let t = text.replace(/\s+/g, ' ').trim();
  if (used && t.startsWith(used)) t = t.slice(used.length).trim();
  if (!t || t === used) return '';
  if (t.length <= MORE_MAX) return t;
  const parts = sentences(t);
  let out = '';
  for (const s of parts) { if ((out + s).length > MORE_MAX) break; out += s; }
  return out || `${t.slice(0, MORE_MAX - 1)}…`;
}

/** 列表页兜底（文章、日报、视频都不够时）。 */
const LISTS: Omit<LetterContent, 'id'>[] = [
  { kind: 'list', kicker: '全部文章', title: '小岛AI 的全部文章', line: '去翻翻全部文章，总有一篇是写给你的。', url: '/archive/', external: false },
  { kind: 'list', kicker: '日报', title: '小岛AI 日报', line: '每天一份，把 AI 圈的新鲜事摘给你看。', url: '/daily/', external: false },
  { kind: 'list', kicker: '视频', title: '小岛AI 的 B 站', line: '彩铅画的动画，一集讲明白一件事。', url: 'https://space.bilibili.com/108463642', external: true },
  { kind: 'list', kicker: '关于', title: '关于小岛AI', line: '这座岛是谁搭的、为什么搭，都写在这儿。', url: '/about/', external: false },
  { kind: 'list', kicker: '小游戏', title: '滑板环岛', line: '信送完了？踩上滑板绕岛一圈。', url: '/play/skate/', external: false },
  { kind: 'list', kicker: '小岛', title: '回小岛逛逛', line: '岛上每栋房子里都放着内容，去转转。', url: '/', external: false },
];

const postLetter = (p: LetterPost, kicker: string): Omit<LetterContent, 'id'> => {
  const first = firstSentence(p.summary);
  return { kind: 'post', kicker, title: p.title, line: first ?? clip(p.title), more: moreOf(p.summary, first ?? ''), url: p.url, external: false, sameTitle: !first };
};

/**
 * 两个标题撞不撞题：有同一个带数字的英文型号（GPT-6.2），或同一段 5 个字以上的中文。
 * 试玩第 1 轮：日报头条和第二新的文章都在讲 GPT-6.2 Astra。
 */
export function sameTopic(a: string, b: string) {
  // 英文词只认带数字的（型号、版本号：GPT-6.2、Qwen3）；Claude、Agent 这种常见词各篇都有，不算撞题
  const words = (t: string) => new Set((t.match(/[A-Za-z][A-Za-z0-9.\-]*\d[A-Za-z0-9.\-]*/g) ?? []).map((w) => w.toLowerCase().replace(/[.\-]+$/, '')));
  const wb = words(b);
  for (const w of words(a)) if (wb.has(w)) return true;
  const ca = a.replace(/[^\u4e00-\u9fff]/g, ' ');
  for (let i = 0; i + 5 <= ca.length; i++) { const seg = ca.slice(i, i + 5); if (!seg.includes(' ') && b.includes(seg)) return true; }
  return false;
}

/** 收信人读完的反应：配上了「他那一类」的内容说 fit，没配上（兜底的别的文章、列表页）说 any。 */
const REACT: Record<number, { fit: string; any: string }> = {
  1: { fit: '写的就是咱这座岛？难怪最近来钓鱼的人多了。', any: '字小，等我收了竿慢慢看。' },
  2: { fit: '这么多新鲜事，我念给隔壁听去。', any: '我戴上老花镜，回家慢慢看。' },
  3: { fit: '造船跟造这个一个道理？那我可得学学。', any: '先揣兜里，收了工再看。' },
  4: { fit: '灯塔几点亮？这个我会答——天一黑就亮。', any: '守灯的夜长，正好有东西看。' },
  5: { fit: '是动画！我要拉着同桌一起看！', any: '字好多……我让妈妈念给我听。' },
  6: { fit: '夜里看信最香，这篇我得细看。', any: '夜里看信最香。' },
};

export function pickLetters(src: LetterSource): LetterContent[] {
  const posts = [...src.posts].sort((a, b) => b.date.localeCompare(a.date));
  const used = new Set<string>();
  const take = <T extends { url: string }>(list: T[]) => list.find((x) => !used.has(x.url)) ?? null;
  const out: (Omit<LetterContent, 'id'> | null)[] = [null, null, null, null, null, null];
  const fit = [false, false, false, false, false, false];
  const put = (i: number, c: Omit<LetterContent, 'id'> | null, fits = true) => { if (c && !used.has(c.url)) { out[i] = c; used.add(c.url); fit[i] = fits; } };
  const course = (id: string) => src.courses.find((c) => c.id === id && c.url) ?? null;
  /** 课：简介里带 key（船、灯塔）的那一句当「一句话」（和收信人沾边），别的句子接在后面。 */
  const courseLetter = (c: LetterCourse, key = ''): Omit<LetterContent, 'id'> => {
    const hook = key ? sentences(c.subtitle).find((x) => x.includes(key) && x.length <= LINE_MAX) : undefined;
    if (hook) return { kind: 'course', kicker: 'B 站课堂', title: c.title, line: hook, more: sentences(c.subtitle).filter((x) => x !== hook).join('').slice(0, MORE_MAX), url: c.url ?? '', external: true };
    const first = firstSentence(c.subtitle);
    return { kind: 'course', kicker: 'B 站课堂', title: c.title, line: first ?? clip(c.subtitle || c.title), more: first ? moreOf(c.subtitle, first) : '', url: c.url ?? '', external: true };
  };

  // 3 阿勇：造船那门课；4 老林：「灯塔几点亮？」那门课（没有编号的旧数据：第一门有链接的课给阿勇）
  const ship = course('agent'), lamp = course('llm');
  if (ship) put(2, courseLetter(ship, '船'));
  if (lamp) put(3, courseLetter(lamp, '灯塔'));
  if (!ship && !lamp) { const c = src.courses.find((x) => x.url); if (c) put(2, courseLetter(c)); }
  // 6 小北：最新文章；老林没拿到课就拿最新的、小北拿第二新的
  if (!out[3]) put(3, posts[0] ? postLetter(posts[0], '最新文章') : null);
  const late = take(posts);
  put(5, late ? postLetter(late, late === posts[0] ? '最新文章' : '近期文章') : null);
  // 1 周伯：讲这座能钓鱼的岛的那篇；没有就一个月前的旧文章（早于构建日 30 天的里取正中间那一篇，再没有取最旧的）
  const island = posts.find((p) => !used.has(p.url) && /钓鱼/.test(p.title) && /岛/.test(p.title));
  if (island) put(0, postLetter(island, '岛上的事'));
  else {
    const cut = new Date(new Date(`${src.today}T00:00:00Z`).getTime() - 30 * 864e5).toISOString().slice(0, 10);
    const old = posts.filter((p) => p.date <= cut && !used.has(p.url));
    const oldPick = old.length ? old[Math.floor(old.length / 2)] : take([...posts].reverse());
    put(0, oldPick ? postLetter(oldPick, '一个月前的旧文章') : null, false);
  }
  // 5 小鱼：一期彩铅视频（没有就最新一期）。「一句话」就是片名，信纸上不再重复一遍出处
  const video = src.videos.find((v) => v.pencil && !used.has(v.url)) ?? take(src.videos);
  if (video) put(4, { kind: 'video', kicker: video.pencil ? '彩铅动画' : '最新视频', title: video.title, line: clip(video.title), more: video.pencil ? '一集彩铅画的动画。点「去看看」在 B 站打开。' : '频道最新的一期视频。点「去看看」在 B 站打开。', url: video.url, external: true, sameTitle: true });
  // 2 许婆：最新一期日报；头条和别的信撞题就往后挑一条，信纸上再列两条别的
  if (src.daily) {
    const all = [...new Set([src.daily.headline, ...(src.daily.headlines ?? [])].filter((h): h is string => !!h))];
    const titles = out.filter((c) => c && (c.kind === 'post' || c.kind === 'video')).map((c) => (c as LetterContent).title);
    const head = all.find((h) => !titles.some((t) => sameTopic(h, t))) ?? all[0] ?? null;
    const rest = all.filter((h) => h !== head && !titles.some((t) => sameTopic(h, t))).slice(0, 2);
    put(1, { kind: 'daily', kicker: `日报第 ${src.daily.issueNo} 期`, title: `小岛AI 日报 · 第 ${src.daily.issueNo} 期`, line: clip(head ?? '今天 AI 圈的新鲜事，都摘在这一份里了。'), more: rest.length ? `这一期还有：${rest.map((h) => `「${clip(h)}」`).join('、')}。` : '', url: src.daily.url, external: false });
  }

  // 兜底：先拿还没用过的文章顶上，再用列表页
  for (let i = 0; i < 6; i++) {
    if (out[i]) continue;
    const p = take(posts);
    if (p) { put(i, postLetter(p, '一篇文章'), false); continue; }
    const l = take(LISTS);
    if (l) put(i, l, false);
  }
  return out.map((c, i) => ({ ...(c ?? LISTS[LISTS.length - 1]), id: (i + 1) as LetterContent['id'], react: REACT[i + 1][fit[i] && c ? 'fit' : 'any'] }));
}
