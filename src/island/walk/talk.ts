/**
 * 小岛邮差：台词（纯计算）。按「谁在说、问的是谁、那人此刻在哪」拼一两句话；收信人收信时的话、邮差的开场白和收尾也在这里。
 * - 路人指路：内容全来自 quest.ts 的 whereabouts（真实日程），口气按说话人的身份换（渔民、老人、小孩、游客……）。
 * - 游客不认识人：只会让你去问附近的本地人（DECISIONS 13）。
 * - 每个人第二次被问，改说自己在干什么；再问又轮回指路。
 * 每一句不超过 40 个字；地名只出自 placeName() 和 quest.ts 的固定说法。check:walk 的台词体检把所有组合穷举一遍。
 */
import type { Kind } from '@/island/crowd-plan';
import type { SayKey } from '@/island/residents';
import { speakTime, type Recipient, type Whereabouts } from '@/island/walk/quest';

/** 说话人的口气：花名册的身份，加上老岛民、干活的人里几种特别的。 */
export type Voice = Kind | 'postman' | 'keeper' | 'vendor' | 'worker';
export const VOICES: Voice[] = ['fisher', 'editor', 'clerk', 'kid', 'elder', 'tourist', 'shipwright', 'artist', 'owl', 'docker', 'postman', 'keeper', 'vendor', 'worker'];
export const MAX_LINE = 40;

/** 老岛民、干活的人：台词类别 → 口气。 */
export function voiceOfSay(say: SayKey): Voice {
  switch (say) {
    case 'mail': return 'postman';
    case 'keeper': return 'keeper';
    case 'fish': case 'net': case 'unload': return 'fisher';
    case 'walkdog': return 'elder';
    case 'kid': return 'kid';
    case 'diner': case 'audience': return 'tourist';
    case 'vendor': return 'vendor';
    case 'painter': case 'paint': case 'pottery': return 'artist';
    case 'shipyard': return 'shipwright';
    default: return 'worker';
  }
}

/** 开头的一小句（{N} 是收信人的名字）：带名字的开头，后面就不再重复名字。 */
const OPENERS: Record<Voice, string[]> = {
  fisher: ['{N}？', '找{N}啊？'],
  editor: ['{N}啊——', '你说{N}？'],
  clerk: ['{N}？', '哦，{N}啊，'],
  kid: ['我知道！', '{N}？'],
  elder: ['你找{N}啊，', '哦，{N}啊，', '{N}？', '问{N}啊，'],
  tourist: [''],
  shipwright: ['{N}？', '找{N}？'],
  artist: ['{N}呀，', ''],
  owl: ['唔……', '{N}？'],
  docker: ['{N}？', '找{N}啊，'],
  postman: ['{N}那封是吧？', ''],
  keeper: ['{N}啊，', '你找{N}？'],
  vendor: ['{N}？', '找{N}？'],
  worker: ['{N}？', ''],
};
/** 小孩说完爱补一句。 */
const KID_TAIL = ['我刚看见的！', '不信你去看！'];

export interface GuideCtx {
  /** 说话人的口气；轮到第几回（换开头用）。 */
  voice: Voice; turn: number;
  r: Recipient; w: Whereabouts;
  /** 收信人这会儿就在说话人附近（14 米内、看得见）。 */
  nearby: boolean;
  /** 现在几点（钟面分钟）；要不要顺带教拨钟（目标还要等很久，而且玩家还没拨过钟）。 */
  minute: number; teachDial: boolean;
  /** 游客：附近能问的本地人叫什么（没有就是 null）。 */
  local: string | null;
  /** 往哪走（「往灯塔那头走」「就在这附近」；不给就不说）。试玩第 1 轮：只说地名，第一次来的人不知道兰兰超市在哪。 */
  way?: string | null;
}

/** 岛上谁都认得的几处，给指路时说「往哪头走」。 */
const LANDMARKS: [string, number, number][] = [['灯塔', 27, 1], ['码头', 0.5, 24], ['船坞', -22, 11], ['夜市', -14, 26], ['山上', -11, -12], ['码头广场', 4, 17], ['放映台', 12, 9.5], ['岛刊社', -3, 15]];
/**
 * 从说话人那儿看，(x, z) 往哪头走：离得近（10 米内）是「就在这附近」；不然挑离目标最近的地标（地名里已经有它的不挑：「码头广场的长椅」不说往码头广场走）。
 */
export function wayTo(fromX: number, fromZ: number, x: number, z: number, place: string): string {
  if (Math.hypot(x - fromX, z - fromZ) < 10) return '就在这附近';
  let best = '', bd = Infinity;
  for (const [n, lx, lz] of LANDMARKS) { if (place.includes(n) || Math.hypot(lx - fromX, lz - fromZ) < 6) continue; const d = Math.hypot(lx - x, lz - z); if (d < bd) { bd = d; best = n; } }
  return best && bd < 14 ? `往${best}那头走` : '';
}

/** 收信人此刻的情况，换成一句不带开头的话（subject 是句子开头要不要带名字）。 */
function core(c: GuideCtx, subject: string) {
  const { w } = c;
  // 站定了、但不在收信的地方（小北下午在长椅上）：说他这会儿在干什么、几点去收信的地方
  // 同一件事几种说法（试玩第 2 轮：站在一起的两个人指路只差开头两个字，模板味重）：按 turn 换
  const alt = c.turn % 2 === 1, he = subject || c.r.he;
  if (w.settled && w.next) return alt ? `${he}还${w.doing}呢，得${speakTime(w.next.minute)}才去${w.next.place}。` : `${subject}这会儿${w.doing}，${speakTime(w.next.minute)}才去${w.next.place}。`;
  if (c.nearby && w.out) return `${subject || '就'}${subject ? '就在那边，' : '在那边，'}${w.doing}呢。`;
  if (w.settled) {
    // 待不了多久了（一刻钟内就走）：说一声快去（试玩第 1 轮：08:03 说在超市买菜，08:08 人已经回家了，像被骗了）
    const hurry = w.until < 15 ? '，待不了多久，快去' : '';
    const area = w.place.replace(/的长椅$/, '').replace(/门口$/, '');
    // 地名已经在「在干什么」里了就不再说一遍（「在兰兰超市买菜呢，就在兰兰超市门口那边」），改说往哪头走
    const tail = c.way ? `，${c.way}` : w.doing.includes(area) ? '' : `，就在${area}那边`;
    return alt ? `我刚路过，${he}${w.doing}呢${tail}${hurry}。` : `${subject}${w.doing}呢${tail}${hurry}。`;
  }
  if (w.out) {
    if (w.place === '回家的路上') return w.next ? `刚看见${subject || c.r.he}往家走了，${speakTime(w.next.minute)}才再出来。` : `刚看见${subject || c.r.he}往家走了。`;
    // 正往屋里去（上课、上工）：说他去哪了、几点才再出来——不说下一个在外面的去处（那是几个钟头以后的事，照着去会扑空）
    if (w.destIndoor && w.dest) return `刚看见${he}往${w.dest}去了${w.next ? `，${speakTime(w.next.minute)}才去${w.next.place}` : ''}。`;
    return `刚看见${subject || c.r.he}往${w.next?.place ?? '那边'}去了${c.way && c.way !== '就在这附近' ? `，${c.way}` : ''}。`;
  }
  if (!w.next) return `${subject}这会儿${w.doing}。`;
  return `${subject}这会儿${w.doing}，${speakTime(w.next.minute)}才去${w.next.place}。`;
}

/** 等多久：现在到他下次站定还有几分钟（已经在外面是 0）。 */
export function waitMinutes(w: Whereabouts, minute: number) {
  if (!w.next) return 0;
  return (((w.next.minute - minute) % 1440) + 1440) % 1440;
}
/** 要等这么久以上，指路时顺带提一句拨钟。 */
export const LONG_WAIT = 30;

/** 顺带教拨钟的几种说法。 */
const DIAL_TIPS = ['嫌等得久？点右上角，拨一拨岛上的钟。', '等不及就拨岛上的钟——右上角那个。', '不想干等的话，右上角的钟能往前拨。'];
/** 要串线索的信：路人只说「去问问谁」（{W} 是知情人）。 */
export function askLine(r: Recipient, turn: number) { const a = r.ask; return a ? a.hints[turn % 2].replaceAll('{W}', a.who) : ''; }

/** 路人指路：一到两个气泡。 */
export function guideLines(c: GuideCtx): string[] {
  if (c.voice === 'tourist') return [c.local ? `我也是刚上岛……你问问${c.local}吧，本地人都熟。` : '我也是刚上岛……你问问戴草帽的本地人吧。'];
  const N = c.r.name, ops = OPENERS[c.voice], op = ops[c.turn % ops.length].replace('{N}', N);
  let line = op + core(c, op.includes(N) ? '' : N);
  if (line.length > MAX_LINE) line = core(c, N);
  if (line.length > MAX_LINE && c.way) line = core({ ...c, way: null }, N);
  if (c.voice === 'kid' && c.w.out && line.length + KID_TAIL[c.turn % 2].length <= MAX_LINE) line += KID_TAIL[c.turn % 2];
  const out = [line];
  if (c.teachDial && waitMinutes(c.w, c.minute) > LONG_WAIT) out.push(c.voice === 'kid' ? '等不及的话，拨一拨岛上的钟呀！右上角那个。' : DIAL_TIPS[c.turn % DIAL_TIPS.length]);
  return out;
}

/** 老岛民、干活的人被问第二回：说说自己。 */
const SELF: Partial<Record<SayKey, string>> = {
  mail: '今天包裹多，我得守着码头。信就拜托你了。',
  keeper: '我在这儿守灯。天一黑，灯就得亮。',
  jog: '我早晚各跑一趟，一趟一公里，不跑浑身不得劲。',
  fish: '钓鱼讲究个等。人也是，等着等着就来了。',
  reader: '这篇写得好，我再看一遍。',
  stroll: '我就到处走走，背着包，走到灯塔再回来。',
  shipyard: '我隔一阵就去船坞看看，新船刷到哪了。',
  climb: '我每天爬一趟台阶，到岛主小屋门口再下来。',
  kid: '我在绕圈圈跑！你要一起吗？',
  cinema: '我坐第一排，新片出来第一个看。',
  walkdog: '钱钱走不快，我也走不快，正好。',
  grill: '串要翻得勤，火要看得紧。',
  stock: '货架理整齐了，买东西的人心里也舒坦。',
  lift: '再来十个……你别跟我说话，会数乱。',
  paint: '这条船刷完，就能下水了。',
  pottery: '泥要揉透，罐子才不裂。',
  guard: '我盯着海呢，你别往深处去啊。',
  diner: '这家的串好吃，你也来一把？',
  audience: '嘘——片子快开始了。',
  vendor: '来看看？一个摊一个话题，挑一个带走。',
  market: '夜市走到头再走回来，正好消食。',
  net: '网破了得补，补好了明早还得出海。',
  unload: '一筐、两筐……鱼得趁新鲜搬上岸。',
  hiker: '山顶的亭子风大，看得最远。',
};
export function selfLineSay(say: SayKey) { return SELF[say] ?? '我啊，就在这儿忙着呢。'; }
/** 按日程的人被问第二回：说他此刻在干什么（日程里的说法）。 */
export function selfLineDoing(doing: string, kid = false) {
  const m = doing.match(/^去(.+)的路上$/), home = doing.match(/^在回家的路上，准备(.+)$/);
  const what = m ? `正要去${m[1]}` : home ? `正回家${home[1]}去` : doing;
  // 小孩说自己：带点劲儿（试玩第 1 轮：「我啊，在沙滩上玩。」太平）
  if (kid && !m && !home) return `我${what}呢！${what.endsWith('玩') ? '你要一起吗？' : ''}`;
  return `我啊，${what}。`;
}

/** 信都送完了。 */
export const ALL_DONE = { before: '信都送完啦？邮差在码头等你。', after: '今天的信都送到啦，辛苦。' } as const;
/** 走不到人跟前（隔着椅子、柜台）时的提示。 */
export const TOO_FAR = '再走近一点儿，信才递得过去。';

/** 邮差阿海：开场三句、送信中间搭话、收尾。 */
export const POSTMAN = {
  // 试玩第 1 轮：三句自动播完要 23 秒，压成两句；理由从「腿不听使唤」换成守码头（他这一页一直站在码头，不再满岛走）
  intro: [
    '早啊！船上卸下的包裹多，我得守着码头。这六封信你替我跑一趟？',
    '人不在原地等：找不着就问路人，等不及就拨岛上的钟。送完回这儿找我。',
  ],
  /** 送了几封以后再找他（left：还剩几封）。 */
  mid: (left: number) => (left === 6 ? '一封都还没送呢？邮袋里有线索，头顶有信封的就是收信人。' : `还剩 ${left} 封。邮袋里写着线索，不懂就问人。`),
  /** 交差：night 天黑了（他在码头等到这会儿），dials 拨过几次钟。 */
  done: (night: boolean, dials: number): string[] => [
    night ? '回来啦？我就在这儿等着呢。六封都到了？' : `六封都到了？${dials ? '连钟都拨上了，' : ''}比我自己跑还快。`,
    '空邮袋给我吧。明天的信，还找你。',
  ],
  /** 结尾他不在（下班了）：少年自己把邮袋挂回码头。 */
  doneAlone: '邮差下班了。把空邮袋挂回码头，明天再来。',
} as const;
