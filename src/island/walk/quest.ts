/**
 * 小岛邮差：任务（纯计算，页面和检查脚本用同一份）。六封信、六位收信人、岛上的钟，以及「某位收信人在某一刻在哪、下次什么时候出门去哪」。
 *
 * - 收信人：两位老岛民（residents.ts 的周伯、老林，位置固定）+ 四位按日程过日子的人（crowd-plan.ts 的花名册，编号都是 3 的倍数，手机上也会出现）。
 * - 行踪按日程逐分钟查（每位一张 1440 格的表，开局建一次）：在屋外 / 在路上 / 在屋里；不在外面时往后找「下一次在屋外站定」的那一刻。
 * - 拨钟跳过去的时刻是「站定以后再加 6 分钟」（人一定已经在那儿了）。
 * 地名只用 placeName() 和这里的固定说法，不出现内部名字（check:walk 的台词体检逐条查）。
 */
import { DAY_START, PLANS, ROSTER, blankState, clockText, placeName, stateAt, toDayMinute } from '@/island/crowd-plan';
import { LEVEL } from '@/island/config';
import { ROLES } from '@/island/residents';
import { onShift } from '@/island/schedule';
import { zoneAt } from '@/island/walk/zones';

/** 岛上的钟：开局几点、比真实时间快几倍；按日程的人每岛上分钟走几米（屏幕上还是 1.05 米/秒，全程不变）。 */
export const CLOCK = { start: 6 + 40 / 60, speed: 12 } as const;
export const PACE = (1.05 * 60) / CLOCK.speed;
/** 拨钟跳到「站定」以后再多几分钟。 */
export const DIAL_SETTLE = 6;

export type LetterId = 1 | 2 | 3 | 4 | 5 | 6;
export const LETTER_IDS: LetterId[] = [1, 2, 3, 4, 5, 6];
export interface Recipient {
  id: LetterId; name: string; title: string; he: '他' | '她';
  /** 是谁：花名册编号，或老岛民的名字。 */
  who: { roster: number } | { resident: string };
  /** 邮袋里的一句线索。 */
  clue: string;
  /** 收信时说的话。 */
  receive: string;
  /** 送到以后再搭话说的话（送到一个岛上小时以后）。 */
  after: string;
  /** 刚送到不久再搭话（信纸上是「拆开扫了一眼」，这会儿还没细看）。试玩第 1 轮：刚收到几秒，小鱼就说「我把信藏在枕头底下了」，人还在沙滩上。 */
  soon: string;
  /**
   * 只在这个地方收信（不给就是在外面哪儿都收）。小北只在渔港夜市收：线索写的是「天黑了去渔港夜市找」，
   * 下午他在广场长椅上坐着也不收，这样第六封一定要拨一次钟到晚上，夜市的夜景成了收尾（M2 验收：16:29 在长椅上就送掉了，线索和玩法对不上）。
   */
  only?: string;
  /** 不在 only 那儿时碰上他，他说的话。 */
  notHere?: string;
  /**
   * 要串两条线索的信（试玩第 2 轮：问一个人就出红箭头，「互相指路」用不上）：一般路人只知道「问问谁」（who：老岛民的名字，他在岛上时），
   * 问到这位知情人才说下落；hints 是路人说的两种说法（{W} 换成知情人），bag 是邮袋里那一行。知情人不在岛上（下班了）就照常直接指路。
   */
  ask?: { who: string; hints: [string, string]; bag: string };
}
export const RECIPIENTS: Recipient[] = [
  { id: 1, name: '周伯', title: '码头钓鱼的', he: '他', who: { resident: '周伯' }, clue: '码头栈桥尽头，戴草帽钓鱼的那位。', receive: '哟，给我的？等我把这条鱼拎上来。', after: '信我看了。下回钓着大的，分你一半。', soon: '信揣兜里了，鱼还没上钩呢。' },
  { id: 2, name: '许婆', title: '退休老人', he: '她', who: { roster: 24 }, clue: '天刚亮就在码头广场晨练，练完买菜回家。', receive: '哟，还有我的信？等我戴上老花镜。', after: '信我念给隔壁听了，都说写得好。', soon: '信我收好了，回家再慢慢念。' },
  { id: 3, name: '阿勇', title: '船坞工人', he: '他', who: { roster: 6 }, clue: '船坞的工人，上工前先去健身房练一会儿。', receive: '等等，我擦把手就拆。', after: '刷完这条船，我就照信里说的试试。', soon: '信我揣着呢，收了工再细看。' },
  { id: 4, name: '老林', title: '灯塔看守', he: '他', who: { resident: '老林' }, clue: '灯塔底下踱步的看守，一年到头都在。', receive: '信到了，灯就没白亮。', after: '天黑以后上来看看，灯一亮整座岛都是金的。', soon: '信我收着，等灯亮了再细看。' },
  { id: 5, name: '小鱼', title: '小学生', he: '她', who: { roster: 3 }, clue: '小学生，放了学才见得着。', receive: '是给我的吗！我能现在就拆吗！', after: '我把信藏在枕头底下了，不告诉别人。', soon: '信我还攥在手里呢，嘻嘻。', ask: { who: '周伯', hints: ['小鱼啊？她天天跑去栈桥看{W}钓鱼，问{W}准知道。', '那丫头？{W}最清楚，她一放学就蹲在栈桥看钓鱼。'], bag: '听说栈桥钓鱼的周伯知道她在哪。' } },
  { id: 6, name: '小北', title: '夜猫子', he: '他', who: { roster: 18 }, clue: '夜猫子。天黑了去渔港夜市找。', receive: '这个点还有信送？邮差也熬夜啊。', after: '夜里看信最香。下回带你吃串。', soon: '信收到啦，等夜深了再细看。', only: '渔港夜市', notHere: '信？白天收的信我转头就忘，夜里看才记得住。天黑了来夜市找我。', ask: { who: '老林', hints: ['小北那夜猫子？灯塔的{W}夜里老见他，去问{W}。', '夜猫子的事得问守夜的——灯塔下的{W}。'], bag: '听说灯塔的老林知道他夜里在哪。' } },
];
export const recipient = (id: LetterId) => RECIPIENTS[id - 1];

/** 两位老岛民的固定说法：在哪、干什么、坐着还是走着、什么时候在外面。 */
const RESIDENT_SPOT: Record<string, { place: string; doing: string; seated: boolean; pos: [number, number] }> = {
  周伯: { place: '码头栈桥尽头', doing: '在码头栈桥尽头钓鱼', seated: true, pos: [-0.6, 37.6] },
  老林: { place: '灯塔下', doing: '在灯塔下来回踱步', seated: false, pos: [25.7, 0.8] },
};

/** 某一刻的行踪。 */
export interface Whereabouts {
  /** 在屋外（站着、坐着、走在路上都算）。 */
  out: boolean;
  /** 在屋外而且站定了（不是走在路上）。 */
  settled: boolean;
  seated: boolean;
  /** 此刻在哪（在屋里就是那间屋子；在路上是「去 X 的路上」）。 */
  place: string;
  /** 在干什么（给台词用的完整说法：「在码头广场晨练」「在家做饭、午睡」）。 */
  doing: string;
  /** 此刻的位置（在屋里是门口；老岛民是他待的地方）。 */
  pos: [number, number];
  /** 走在路上时要去的那一站、那一站是不是在屋里（老林说小鱼「往东滩去了」，其实她正去上课：试玩第 2 轮）。 */
  dest?: string; destIndoor?: boolean;
  /** 在外面站定时，还在这儿待多少分钟（老岛民到下班；不在外面站定是 0）。 */
  until: number;
  /**
   * 下一次在屋外站定：几点（日程分钟）、「HH:MM」（拨钟拨到的那个时刻，邮袋、钟面都写它）、在哪、拨钟该拨到几点（站定后再加 6 分钟、凑整到 5 分钟）。
   * 已经在外面站定就是 null；走在路上是他要去的那一站。
   */
  next: { minute: number; clock: string; place: string; dial: number } | null;
}

/** 一个去处在台词里怎么叫：长椅说是哪儿的长椅、沙滩说东滩西滩、住处说「家」。 */
export function spotName(key: string, x: number, z: number, y: number): string {
  if (key.startsWith('home')) return '家';
  if (key === 'bench') { const a = zoneAt(x, z, y); return a && !a.endsWith('草地') ? `${a}的长椅` : '长椅'; }
  if (key === 'beach') return zoneAt(x, z, y) ?? '沙滩';
  if (key === 'ferry') return '码头';
  return placeName(key);
}
/** 在屋里时「在干什么」：日程里写的是动身时的说法（「回家做饭」「回阅览室上课」），换成此刻的说法。 */
export function doingNow(doing: string, atHome: boolean) {
  // 日程里「在健身房练一会儿」「在长椅上歇一会儿」是动身时的打算，说此刻就是「练着」「歇着」（试玩第 1 轮：「这会儿在健身房练一会儿」）
  const now = doing.replace(/(练|歇|坐|站)一会儿$/, '$1着').replace(/一会儿$/, '');
  if (atHome) return now.replace(/^(回家|在家)/, '在家');
  return now.replace(/^回/, '在');
}

/* ───────── 按日程的收信人：逐分钟的表 ───────── */

/** 0 在屋里、1 走在路上、2 站着、3 坐着。 */
interface Table { mode: Uint8Array; stop: Int16Array; x: Float32Array; z: Float32Array; y: Float32Array }
const TABLES = new Map<number, Table>();
function table(id: number): Table {
  let t = TABLES.get(id);
  if (t) return t;
  t = { mode: new Uint8Array(1440), stop: new Int16Array(1440), x: new Float32Array(1440), z: new Float32Array(1440), y: new Float32Array(1440) };
  const s = blankState();
  for (let i = 0; i < 1440; i++) {
    stateAt(id, DAY_START + i, PACE, s);
    t.mode[i] = s.mode === 'hidden' ? 0 : s.mode === 'walk' ? 1 : s.mode === 'stand' ? 2 : 3;
    t.stop[i] = s.stop; t.x[i] = s.x; t.z[i] = s.z; t.y[i] = s.y;
  }
  TABLES.set(id, t);
  return t;
}
/** 钟面小时 → 表里第几格（0–1439）。 */
const slotOf = (hour: number) => Math.floor(toDayMinute(hour)) - DAY_START;
/** 表里第几格 → 钟面分钟（0–1439）。 */
const clockMinute = (i: number) => (DAY_START + i) % 1440;

function rosterWhere(id: number, hour: number, only?: string): Whereabouts {
  const t = table(id), i = slotOf(hour), plan = PLANS[id], mode = t.mode[i], stop = plan.stops[t.stop[i]];
  const atHome = stop.place === ROSTER[id].home;
  const name = (k: number) => { const st = plan.stops[t.stop[k]]; return spotName(st.place, st.slot.x, st.slot.z, st.slot.y); };
  // 下一次站定（只在某处收信的人：下一次在那儿站定）：从下一格往后找（找到头从 04:00 绕回来）
  let next: Whereabouts['next'] = null;
  if (mode < 2 || (only && name(i) !== only)) for (let d = 1; d < 1440; d++) {
    const k = (i + d) % 1440;
    if (t.mode[k] < 2 || (only && name(k) !== only)) continue;
    // 拨到哪：站定以后再过 6 分钟、凑到 5 分钟的整数（钟面拖指针也是 5 分钟一格）；那会儿已经走了就拨到刚站定那一分钟。
    // 邮袋、钟面预设、快捷按钮都写这一个时间（试玩第 1 轮：邮袋 15:06、钟面 15:10、按钮 15:12 三个数）
    const settle = (k + DIAL_SETTLE + ((5 - (clockMinute(k + DIAL_SETTLE) % 5)) % 5)) % 1440, keep = t.mode[settle] >= 2 && t.stop[settle] === t.stop[k];
    const dial = clockMinute(keep ? settle : k);
    next = { minute: clockMinute(k), clock: clockText(dial), place: name(k), dial };
    break;
  }
  const here = name(i);
  let destIndoor = false;
  if (mode === 1) { let k = i; while (t.mode[k % 1440] === 1 && k - i < 1440) k++; destIndoor = t.mode[k % 1440] === 0; }
  let until = 0;
  if (mode >= 2) while (until < 1440 && t.mode[(i + until + 1) % 1440] >= 2 && t.stop[(i + until + 1) % 1440] === t.stop[i]) until++;
  return {
    until,
    out: mode > 0, settled: mode >= 2, seated: mode === 3,
    // 走在路上时 here 就是他要去的那一站（stateAt 的 stop 是正在走的这一段的终点）
    place: mode === 1 ? (here === '家' ? '回家的路上' : `去${here}的路上`) : here,
    doing: mode === 1 ? (here === '家' ? '在回家的路上' : `在去${here}的路上`) : doingNow(stop.doing, atHome && mode === 0),
    pos: [t.x[i], t.z[i]],
    next,
    ...(mode === 1 ? { dest: here, destIndoor } : {}),
  };
}

function residentWhere(name: string, hour: number): Whereabouts {
  const role = ROLES.find((r) => r.name === name), spot = RESIDENT_SPOT[name];
  if (!role || !spot) throw new Error(`[walk] 没有这位老岛民：${name}`);
  const out = onShift(role.hours, hour);
  let next: Whereabouts['next'] = null;
  if (!out && role.hours) {
    // 下一段在岛上的时间从哪一刻开始
    const now = ((hour % 24) + 24) % 24;
    let best = Infinity;
    for (const [from] of role.hours) { const d = (((from - now) % 24) + 24) % 24; if (d > 0 && d < best) best = d; }
    const m = Math.round(((now + best) % 24) * 60);
    const dial = Math.ceil((m + DIAL_SETTLE) / 5) * 5 % 1440;
    next = { minute: m, clock: clockText(dial), place: spot.place, dial };
  }
  return { out, settled: out, seated: spot.seated, place: out ? spot.place : '家', doing: out ? spot.doing : '在家歇着', pos: spot.pos, next, until: out ? 600 : 0 };
}

/** 第 id 封信的收信人在岛上 hour 点（0–24，带小数）的行踪。 */
export function whereabouts(id: LetterId, hour: number): Whereabouts {
  const r = recipient(id);
  return 'roster' in r.who ? rosterWhere(r.who.roster, hour, r.only) : residentWhere(r.who.resident, hour);
}
/** 第 id 封信此刻能不能送到：人在外面，而且（只在某处收信的）就在那儿站定。 */
export function receivable(id: LetterId, hour: number): boolean {
  const r = recipient(id), w = whereabouts(id, hour);
  return r.only ? w.settled && w.place === r.only : w.out;
}

/** 拨钟该拨到几点（钟面小时，0–24）：人已经在外面站定了（只在某处收信的：已经在那儿了）返回 null。 */
export function dialHour(id: LetterId, hour: number): number | null {
  const w = whereabouts(id, hour);
  if (!w.next) return null;
  return w.next.dial / 60;
}
/** 从 from 点往前拨到 to 点要走多少小时（钟只往前拨；拨到同一刻是 0）。 */
export const forwardHours = (from: number, to: number) => (((to - from) % 24) + 24) % 24;
/** 从 from 点往前走 dh 小时，跨过了几次凌晨 4 点（「又一天」）。 */
export function daysCrossed(from: number, dh: number) {
  const start = toDayMinute(from) - DAY_START;
  return Math.floor((start + dh * 60) / 1440);
}

/** 邮袋里的行踪行：「这会儿：在岛刊社阅览室上课 · 下次出门：15:58 去东滩」。 */
export function bagLine(w: Whereabouts): { now: string; next: string | null } {
  const now = `这会儿：${w.doing}`;
  const next = w.next ? (w.out ? `${w.settled ? '收信要等 ' : ''}${w.next.clock} 到${w.next.place}` : `下次见得着：${w.next.clock} 在${w.next.place}`) : null;
  return { now, next };
}

/** 钟面分钟 → 口语的时间：「早上七点四十多」「下午四点」「晚上八点半」。 */
const NUM = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
export function speakTime(minute: number) {
  let m = ((Math.round(minute) % 1440) + 1440) % 1440, h = Math.floor(m / 60), mm = m % 60;
  let tail: string;
  if (mm <= 5) tail = '点';
  else if (mm <= 20) tail = '点多';
  else if (mm <= 38) tail = '点半';
  else if (mm <= 52) tail = '点四十多';
  else { h = (h + 1) % 24; m = h * 60; tail = '点'; }
  const day = h < 5 ? '半夜' : h < 11 ? '早上' : h < 13 ? '中午' : h < 18 ? '下午' : '晚上';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${day}${mm > 52 ? '快' : ''}${NUM[h12]}${tail}`;
}

/** 码头：开场、结尾的地方（码头台阶顶，邮差阿海早上在这儿）。 */
export const PIER_HOME = { x: 1.2, z: 19.4, r: 4 } as const;
/**
 * 一局开始时少年站在哪：码头台阶口东边、邮差身边 1.4 米，面朝邮差。
 * 不用 M1 的出生点 (2.9, 19.0)：清晨六点到七点半，广场晨练的老人有两个站位正好在那儿（开场时少年被两个老人整个盖住）；
 * 也不用台阶口西边：那边身后是岛刊社门口的推车和灯杆，开场结束转身对着栈桥时镜头退不开、被挤到侧面（m2/camstart.ts 量的）。
 */
/**
 * 邮差阿海在这一页守在码头（试玩第 1 轮：开场说「腿不听使唤」，转头就牵着狗满岛走，故事前提当场穿帮；他 20 点下班，
 * 正常玩下来最后一封在夜市送完，回码头永远见不到他）。理由换成「船上卸下来的包裹多，得守着码头」，人就站在码头台阶口西南这一块空地上：
 * 离下码头的两条路（台阶、东边的坡）都一米半以上，不挡路；六封送完以前 6–20 点在，六封送完了一直等到少年回来。
 * 首页、滑板页的邮差照旧满岛送信（这一页在 residents.update 之后把他摆回这里）。
 */
export const POSTMAN_POST = { x: 0.5, z: 18.75 } as const;
/**
 * 开局少年站在台阶口、邮差西北边 1.5 米，面朝他（邮差挪到台阶口西南以后，原来的 (1.1, 19.4) 离他不到一米，东边一圈又站不住）。
 * 开场说完转身就正对着下码头的台阶和栈桥（试玩第 1 轮：按住 W 走下台阶旁的沙地，卡在公告栏和缆桩之间）。
 */
export const START = { x: -0.3, z: 20.0, heading: Math.atan2(POSTMAN_POST.x + 0.3, POSTMAN_POST.z - 20.0) } as const;
/** 邮差这会儿在不在码头：6–20 点；六封都送到了就一直在。 */
export const postmanOnDuty = (hour: number, allDone: boolean) => allDone || (hour >= 6 && hour < 20);
void LEVEL;
