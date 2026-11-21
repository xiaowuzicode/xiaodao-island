/**
 * 小岛邮差：玩法（送信这一局怎么走）。main.ts 只接线，这里管：开场（邮差交邮袋）→ 找人（说话、问路、拨钟）→ 送达（小仪式、拆信）→ 结尾（回码头）。
 * 世界从不暂停：说话时岛上的钟照走、别的人照常过日子，气泡飘在说话人的头顶。
 * - 阶段：intro 开场 · play 自由走 · deliver 送达那几秒（少年不能走）· dial 拨钟快进那一下（不能走）· ending 结尾。说话不算一个阶段，走开就收。
 * - 防死局：问路和邮袋里的行踪行都来自真实日程（quest.ts），能把人引到「几点去哪」；钟面上一直有「跳到 X 出门的时候」；
 *   连着找一封信 90 秒还没问过人，这封信的行踪行自己亮出来；卡住了邮袋里能回码头。
 * - 进度存本机（save.ts）：送达、拨钟后、每 10 秒、页面隐藏时各存一次。
 */
import { clockText, toDayMinute } from '@/island/crowd-plan';
import type { Folk, FolkTable } from '@/island/walk/folk';
import type { LetterContent } from '@/island/walk/letters';
import { CLOCK, LETTER_IDS, PIER_HOME, RECIPIENTS, bagLine, daysCrossed, dialHour, forwardHours, receivable, recipient, whereabouts, type LetterId } from '@/island/walk/quest';
import { blankSave, type Save, type Store } from '@/island/walk/save';
import { ALL_DONE, POSTMAN, askLine, guideLines, selfLineDoing, selfLineSay, wayTo, type Voice } from '@/island/walk/talk';
import type { UI, BagCard } from '@/island/walk/ui';
import type { WalkSound } from '@/island/walk/sound';

/** 区名上面那一行小字：一天里的什么时候和几点（「清晨 · 06:41」）。 */
function dayPart(h: number) {
  const w = h < 5 ? '凌晨' : h < 8 ? '清晨' : h < 11 ? '上午' : h < 13 ? '中午' : h < 17 ? '下午' : h < 19 ? '傍晚' : '夜里';
  return `${w} · ${clockText(Math.floor(h * 60) % 1440)}`;
}
/** 说话：多近能开口（坐着的人隔着椅子、柜台，放宽）；收信人多近自动开口；走开多远就收。 */
/** 收信人走到 1.9 米就自己开口（试玩第 1 轮：老林来回踱步，1.6 米老是够不着，只有他要按 E，别的人都是走近就送）。 */
export const REACH = { talk: 1.9, seated: 2.3, give: 1.9, leave: 3.2 } as const;
/** 逐字出：每秒几个字；说完以后停多久自己往下（开场的话长一点）。 */
const TYPE = { cps: 30, hold: 3.2, holdIntro: 3.4 } as const;
/** 送达的小仪式（秒）：抬手、信封递过去、对方开口、信纸升起来（这时才放开少年）。 */
const GIVE = { raise: 0.4, handOver: 0.95, speak: 0.85, open: 3.0, lower: 0.5 } as const;
/** 送完以后多久信纸升起来（秒）：镜头从双人机位回到身后要 0.6 秒。 */
const SHEET_AFTER = 0.7;
/** 找一封信多久还没问过人，行踪行自己亮出来（秒）。 */
const REVEAL_AFTER = 90;
/** 拨钟快进多久（秒）；减少动态效果下直接淡出淡入。 */
const DIAL_ANIM = { dur: 2.8, still: 0.3, min: 1.6 } as const;

export interface GameDeps {
  reduced: boolean; touch: boolean;
  /** 网址里固定了开局时间（?hour=）：跳过开场。 */
  startHour: number | null;
  /** 每一天的六封信（第 round 天用第 round % 几天）。 */
  letters: LetterContent[][];
  folk: FolkTable; ui: UI; sound: WalkSound; store: Store;
  boy: { hasBag: boolean };
  /** 少年此刻在哪、朝哪；改朝向（说话时转过去）。 */
  me(): { x: number; z: number; heading: number; y?: number };
  face(heading: number, dt: number): void;
  getHour(): number; setHour(h: number): void;
  /** 拨钟以后：被叫住的人欠的时间清掉。 */
  clearHolds(): void;
  walkTo(x: number, z: number): boolean; cancelRoute(): void; routing(): boolean;
  /** 传送（读档、回码头、再来一局），镜头跟着摆好。 */
  respawn(x: number, z: number, heading: number): void;
  standable(x: number, z: number): boolean;
  /** 镜头：双人机位 / 正面 / 回到身后。 */
  shot(s: { other: { x: number; y: number; z: number; foot?: number }; shift?: number; lift?: number; face?: { x: number; z: number } } | { front: true } | null, snap?: boolean): void;
  /** 平的世界 → 屏幕（像素）；镜头水平朝向；镜头位置。 */
  toScreen(x: number, y: number, z: number): { x: number; y: number } | null;
  camYaw(): number; camPos(): { x: number; y: number; z: number };
  spawn: { x: number; z: number; heading: number };
  /** 按能走的路去 (x, z) 的下一个拐点（direct：拐点就是终点、能直着走过去）；找路网格没建好是 null。 */
  guideTo(x: number, z: number): { x: number; y: number; z: number; direct: boolean; bend: number } | null;
  /** 站着不动时镜头慢慢转到 yaw 那个方向的身后（说完话、送完信、拨完钟）。 */
  recenter(yaw: number): void;
}

type Phase = 'intro' | 'play' | 'deliver' | 'dial' | 'ending';
interface Talk { f: Folk | null; who: string; title: string; voice: Voice; lines: string[]; i: number; shown: number; held: number; kind: 'chat' | 'intro' | 'deliver' | 'end'; auto: boolean }

export function createGame(d: GameDeps) {
  const { ui, folk, sound, store } = d;
  /** 「再送一天」（next）：第几天加一、换一批信；邮袋里的「重新送一天」是同一天重来。 */
  const fresh = (next = false): Save => { const round = (save?.round ?? 0) + (next ? 1 : 0); return { ...blankSave(CLOCK.start, d.spawn, save?.best), ...(round ? { round } : {}) }; };
  /** 今天这一批信。 */
  const letters = () => d.letters[(save.round ?? 0) % d.letters.length] ?? d.letters[0];
  let save: Save = store.load() ?? blankSave(CLOCK.start, d.spawn);
  let phase: Phase = 'play', talk: Talk | null = null, pending: Folk | null = null;
  let giving: { f: Folk; id: LetterId; t: number; done: boolean } | null = null;
  let dialing: { from: number; dh: number; t: number; dur: number; tick: number } | null = null;
  let ending: { t: number; f: Folk | null; shown: boolean } | null = null;
  let saveT = 0, trackT = 0, bagT = 0, firstTip = false, playing = false, chase = 0, sheetDue: { id: LetterId; t: number } | null = null;
  /** 信纸什么时候升起来的（performance.now）：刚升起来的半秒里 E、点屏幕不收它（试玩第 2 轮：交信对白按 E 继续，同一个 E 把刚弹出的信纸收掉了）。 */
  let sheetAt = -1e9;
  /** 送到以后，「正在找」和送到几封等信纸收好了再换（试玩第 2 轮：卡片还没出来，右下角先跳成「正在找：许婆」，以为送完就没了）。 */
  let afterSheet: (() => void) | null = null;
  /** 上一段话什么时候、跟谁说完的：说完半秒内点屏幕只算「收起」，同一个人 3 秒内再点不重说一遍（试玩第 2 轮：想翻页结果让人把指路重说四遍、或者少年走开 8 米）。 */
  let talkEnd = { t: -1e9, f: null as Folk | null };
  const asks = new Map<string, number>();
  /** 听路人说过「去问问谁」的信（邮袋里多一行「听说某某知道」；只记在这一趟里）。 */
  const hinted = new Set<LetterId>();
  /** 头顶标记要躲开的身子（少年、正在说话的人）。 */
  const bodies: { x: number; y: number; z: number; h: number }[] = [];
  const zone = { cur: '', since: 0, seen: new Map<string, number>(), t: 0 };

  const pendingSet = () => new Set(LETTER_IDS.filter((id) => !save.delivered[id]));
  const deliveredN = () => LETTER_IDS.filter((id) => save.delivered[id]).length;
  const minuteNow = () => toDayMinute(d.getHour()) % 1440;
  const persist = () => { const me = d.me(); save.x = me.x; save.z = me.z; save.heading = me.heading; save.hour = d.getHour(); store.save(save); };
  const setPhase = (p: Phase) => { phase = p; ui.setPhase(p); };
  const reach = (f: Folk) => (f.seated ? REACH.seated : REACH.talk);
  const giveReach = (f: Folk) => (f.seated ? REACH.seated : REACH.give);
  const headOf = (f: Folk) => ({ x: f.x, y: f.head - 0.2, z: f.z, foot: f.y });
  const nextPending = (after = 0) => LETTER_IDS.find((id) => id > after && !save.delivered[id]) ?? LETTER_IDS.find((id) => !save.delivered[id]) ?? 0;
  const tracked = () => (save.tracking && !save.delivered[save.tracking as LetterId] ? (save.tracking as LetterId) : null);

  function refreshTrack() {
    const t = tracked();
    if (deliveredN() === 6) ui.setTrack(save.done ? null : '码头找邮差', '都送到了，回');
    else ui.setTrack(t ? recipient(t).name : null);
  }

  // ---------- 说话 ----------
  function say(t: Omit<Talk, 'i' | 'shown' | 'held'>) {
    endTalk(false);
    talk = { ...t, i: 0, shown: 0, held: 0 };
    ui.bubble(t.who, t.title, '');
    ui.say(`${t.who}：${t.lines.join(' ')}`);
    sound.talk(t.voice);
    if (t.f) { folk.talkTo(t.f); d.shot({ other: headOf(t.f) }); }
  }
  function endTalk(camBack = true) {
    if (!talk) return;
    talkEnd = { t: performance.now(), f: talk.f };
    talk = null;
    ui.bubble(null);
    folk.talkTo(null);
    if (camBack && phase === 'play') { d.shot(null); lookOnward(); }
  }
  /** 说完话、送完信、拨完钟：少年和镜头慢慢转向下一个要去的方向（有指路就朝指路的拐点，没有就照他现在的朝向转到身后）。 */
  let turnWant: number | null = null;
  function lookOnward() {
    const me = d.me(), g = guideTarget();
    let yaw = me.heading;
    if (g) { const w = d.guideTo(g.x, g.z), tx = w && !w.direct ? w.x : g.x, tz = w && !w.direct ? w.z : g.z; if (Math.hypot(tx - me.x, tz - me.z) > 1) yaw = Math.atan2(tx - me.x, tz - me.z); }
    turnWant = yaw === me.heading ? null : yaw;
    d.recenter(yaw);
  }
  /** 下一句（点气泡、按 E）：字还没出完就先出完。 */
  function next() {
    if (!talk) return;
    const line = talk.lines[talk.i];
    if (talk.shown < line.length) { talk.shown = line.length; ui.bubbleText(line); return; }
    if (talk.kind === 'deliver' && giving && !giving.done) return;
    if (talk.i < talk.lines.length - 1) {
      talk.i++; talk.shown = 0; talk.held = 0; ui.bubbleText(''); sound.talk(talk.voice);
      // 结尾第二句：少年把空邮袋交回去
      if (talk.kind === 'end' && talk.i === 1) { d.boy.hasBag = false; sound.bag(); }
      return;
    }
    const kind = talk.kind;
    endTalk(kind === 'chat' || kind === 'deliver');
    if (kind === 'intro') finishIntro();
    if (kind === 'end' && ending) showEnd();
  }

  /** 和一个人开口：收信人（手里有他的信）直接送；邮差有专门的话；别人指路、聊自己。 */
  function startTalk(f: Folk) {
    pending = null;
    if (f.letter && !save.delivered[f.letter]) {
      if (receivable(f.letter, d.getHour())) { startGive(f, f.letter); return; }
      // 只在某处收信的人（小北只在夜市收）：不在那儿就说一句「晚上来夜市找我」，把这封信的行踪行亮出来
      const r = recipient(f.letter);
      if (!save.asked.includes(f.letter)) { save.asked.push(f.letter); if (ui.bagOpen) renderBag(); }
      ui.flashClock();
      say({ f, who: f.name, title: f.title, voice: f.voice, lines: [r.notHere ?? r.after], kind: 'chat', auto: true });
      return;
    }
    const all = deliveredN() === 6, n = (asks.get(f.key) ?? 0), t = tracked();
    asks.set(f.key, n + 1);
    let lines: string[];
    if (f.say === 'mail') {
      if (all && !save.done) { startEnding(f); return; }
      lines = [all ? ALL_DONE.after : POSTMAN.mid(6 - deliveredN())];
      if (t && !all) lines.push(...guide(f, t, n));
    } else if (f.letter && save.delivered[f.letter]) {
      // 收到信的人：正在找下一封就先指路，再顺带说说信（刚收到一个岛上小时内是「还没来得及细看」）——
      // 试玩第 2 轮：送完信右下角已经写着「正在找：许婆」，第一次开口却是「信揣兜里了」，要再点一次才指路，新手以为问他没用
      const r = recipient(f.letter), got = save.delivered[f.letter]?.hour ?? d.getHour(), since = forwardHours(got, d.getHour()), own = since < 1 ? r.soon : r.after;
      if (t && !all) { lines = guide(f, t, n); if (lines.length < 2) lines.push(own); }
      else lines = [own];
    }
    else if (all) lines = [save.done ? ALL_DONE.after : ALL_DONE.before];
    else if (!t) lines = ['邮袋里点一封信，我帮你想想他在哪。'];
    // 问的是正在找的那封：每回都先指路（试玩第 1 轮：问第二回改说自己，找阿勇时阿松答「我啊，回船坞干活」，像没读题）；问到第三回再顺带说说自己
    else { lines = guide(f, t, n); if (n % 3 === 2 && lines.length < 2) lines.push(selfOf(f)); }
    say({ f, who: f.name, title: f.title, voice: f.voice, lines, kind: 'chat', auto: true });
  }
  /** 指路的话（问的是正在找的那封信）；问过了就把这封信的行踪行亮出来。 */
  function guide(f: Folk, id: LetterId, n: number) {
    const r = recipient(id), w = whereabouts(id, d.getHour()), rf = folk.ofLetter(id);
    let hash = 0; for (const ch of f.key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    // 要串线索的信：还没问到下落时，一般路人只知道「去问问谁」；问到知情人本人才说下落（知情人不在岛上就照常指路）
    if (r.ask && !save.asked.includes(id) && f.key !== `r:${r.ask.who}` && f.voice !== 'tourist') {
      const w2 = folk.find(`r:${r.ask.who}`);
      if (w2?.visible) { hinted.add(id); if (ui.bagOpen) renderBag(); return [askLine(r, n + hash)]; }
    }
    const nearby = !!rf && rf.visible && Math.hypot(rf.x - f.x, rf.z - f.z) < 14;
    const local = f.voice === 'tourist' ? folk.nearest(f.x, f.z, 15, (o) => o.voice === 'tourist' || o === f || !!o.letter)?.name ?? null : null;
    // 开头的说法按人换（码头广场七位老人原来同一句开头），再说往哪头走（走在路上的人不说往哪头：他此刻的位置一会儿就变了）
    const lines = guideLines({ voice: f.voice, turn: n + hash, r, w, nearby, minute: minuteNow(), teachDial: !save.dialTaught, local, way: w.settled ? wayTo(f.x, f.z, w.pos[0], w.pos[1], w.place) || null : null });
    if (f.voice !== 'tourist' && !save.asked.includes(id)) { save.asked.push(id); trackT = 0; if (ui.bagOpen) renderBag(); }
    if (lines.length > 1) ui.flashClock();
    return lines;
  }
  /** 按日程的人此刻在干什么（日程里的说法）。 */
  const crowdDoing = (f: Folk) => folk.doingOf(f);
  /** 说说自己（问到第三回顺带一句）。 */
  const selfOf = (f: Folk) => (f.roster !== undefined ? selfLineDoing(crowdDoing(f), f.voice === 'kid') : f.say ? selfLineSay(f.say) : '我啊，就在这儿忙着呢。');

  // ---------- 送达 ----------
  function startGive(f: Folk, id: LetterId) {
    d.cancelRoute(); pending = null;
    ui.closeBag(); ui.hideHint();
    setPhase('deliver');
    giving = { f, id, t: 0, done: false };
    folk.talkTo(f);
    d.shot({ other: headOf(f) });
  }
  function stepGive(dt: number) {
    if (!giving) return;
    const g = giving, f = g.f, me = d.me();
    g.t += dt;
    d.face(Math.atan2(f.x - me.x, f.z - me.z), dt);
    if (g.t - dt < GIVE.speak && g.t >= GIVE.speak) {
      sound.deliver();
      // 信封到手：收信人头顶撒一把彩纸
      const at = d.toScreen(f.x, f.head + 0.25, f.z);
      if (at) ui.burst(at.x, at.y);
      say({ f, who: f.name, title: f.title, voice: f.voice, lines: [recipient(g.id).receive], kind: 'deliver', auto: true });
    }
    if (!g.done && g.t >= GIVE.open) {
      g.done = true;
      save.delivered[g.id] = { order: deliveredN() + 1, hour: d.getHour() };
      if (save.tracking === g.id) save.tracking = nextPending(g.id);
      afterSheet = () => { ui.setCount(deliveredN(), true); refreshTrack(); };
      persist();
      setPhase('play');
      // 收信人那句话说完、镜头回到身后以后信纸才升起来（M2 验收：双人机位还没收信纸就弹出来，横屏正好盖住两个人）
      if (talk?.kind === 'deliver') endTalk();
      else { d.shot(null); lookOnward(); }
      sheetDue = { id: g.id, t: SHEET_AFTER };
      if (deliveredN() === 1) firstTip = true;
      if (deliveredN() === 6) ui.hint('六封都送到了！回码头找邮差。', 6000);
    }
    if (g.t > GIVE.open + GIVE.lower) giving = null;
  }
  /** 递信的姿势：0–1 抬手；手里还有没有信封。 */
  function givePose() {
    if (!giving) return { give: 0, letter: false };
    const t = giving.t, up = Math.min(1, t / GIVE.raise), down = t > GIVE.open ? Math.max(0, 1 - (t - GIVE.open) / GIVE.lower) : 1;
    return { give: up * down * (t > GIVE.handOver ? 0.8 : 1), letter: t < GIVE.handOver };
  }
  function closeSheet() {
    flushAfterSheet();
    if (!ui.sheetOpen) return;
    ui.closeSheet();
    if (firstTip) { firstTip = false; ui.hint(`邮袋里还有 ${6 - deliveredN()} 封，点右下角看线索。`, 6000); }
  }

  function flushAfterSheet() { const f = afterSheet; afterSheet = null; f?.(); }
  /** 信纸开着（或者马上要升起来）：少年不走、不自动送信、不进结尾，点屏幕先收信纸。 */
  const sheetUp = () => ui.sheetOpen || sheetDue !== null;

  // ---------- 拨钟 ----------
  function openDial(want?: number) {
    if (phase !== 'play') return;
    ui.closeBag();
    const now = minuteNow(), t = tracked() ?? nextPending();
    let quick: { name: string; minute: number; place: string } | null = null, note: string | null = null;
    // 快捷按钮只在问到下落以后才有（试玩第 1 轮：一个人都不问，打开钟面点一下就到，问路这条玩法被绕过）；没问过就只能自己拨
    if (t) {
      const id = t as LetterId, h = dialHour(id, d.getHour()), r = recipient(id), known = id === 1 || save.asked.includes(id);
      const w = whereabouts(id, d.getHour());
      if (!known) note = `还不知道${r.name}什么时候出门——先问问路人`;
      else if (h !== null && w.next) quick = { name: r.name, minute: Math.round(h * 60) % 1440, place: w.next.place };
      else note = `${r.name}这会儿就在外面，不用拨钟。`;
    }
    ui.openDial(now, want ?? quick?.minute ?? (Math.round(now / 30) * 30 + 60) % 1440, quick, note);
  }
  function dialTo(minute: number) {
    ui.closeDial();
    if (phase !== 'play') return;
    endTalk(); d.cancelRoute(); pending = null;
    const from = d.getHour(), dh = forwardHours(from, minute / 60);
    if (dh < 1 / 60) return;
    setPhase('dial');
    folk.talkTo(null);
    d.clearHolds();
    // 快进放 1.6–2.8 秒（拨得越远越久）：太阳走、影子扫、人按倍速过日子都看得见（试玩第 1 轮：1.2 秒一片白，像切了一刀）
    dialing = { from, dh, t: 0, dur: d.reduced ? DIAL_ANIM.still : DIAL_ANIM.min + (DIAL_ANIM.dur - DIAL_ANIM.min) * Math.min(1, dh / 8), tick: 0 };
    ui.ff(true);
  }
  function stepDial(dt: number) {
    if (!dialing) return;
    const g = dialing;
    g.t += dt;
    const k = Math.min(1, g.t / g.dur), e = d.reduced ? (k < 0.5 ? 0 : 1) : k * k * (3 - 2 * k);
    d.setHour((g.from + g.dh * e) % 24);
    // 钟声跟着快进的快慢走：两头慢、中间密
    if (!d.reduced && (g.tick -= dt) <= 0) { g.tick = 0.05 + 0.2 * (1 - Math.sin(Math.PI * k)); sound.tick(); }
    if (k < 1) return;
    dialing = null;
    d.clearHolds();
    save.dials++; save.days += daysCrossed(g.from, g.dh); save.dialTaught = true;
    ui.ff(false);
    setPhase('play');
    persist();
    if (ui.bagOpen) renderBag();
    // 停在拨到的那一分钟上（右上角的钟按向下取整显示：差一点点就会少一分钟，试玩第 1 轮「拨到了 15:12」右上角写 15:11）
    const to = Math.round(((g.from + g.dh) % 24) * 60) % 1440;
    d.setHour(to / 60 + 1e-4);
    ui.hint(`钟拨到了 ${clockText(to)}。`, 3500);
    lookOnward();
  }

  // ---------- 开场、结尾 ----------
  const postman = () => folk.find('r:阿海');
  function startIntro() {
    const p = postman();
    setPhase('intro');
    ui.showBag(false); ui.skip(true); ui.hideHint();
    d.boy.hasBag = false;
    d.respawn(d.spawn.x, d.spawn.z, d.spawn.heading);
    if (!p || !p.visible) { finishIntro(); return; }
    const me = d.me();
    d.face(Math.atan2(p.x - me.x, p.z - me.z), 1);
    // 开场两句只在点了以后才往下翻（试玩第 2 轮：读得慢的人第二句——唯一讲玩法的那句——还没看见就自己翻过去了）
    say({ f: p, who: p.name, title: '邮差', voice: 'postman', lines: [...POSTMAN.intro], kind: 'intro', auto: false });
    d.shot({ other: headOf(p) }, true);
  }
  function finishIntro() {
    if (talk?.kind === 'intro') endTalk(false);
    ui.skip(false);
    save.intro = true;
    if (!save.tracking) save.tracking = 1;
    d.boy.hasBag = true;
    sound.bag();
    ui.showBag(true); ui.setCount(deliveredN(), true);
    refreshTrack();
    setPhase('play');
    // 转身对着栈桥尽头的周伯（他头顶的信封标记就在画面里），镜头从双人机位慢慢回到身后
    const me = d.me(), [zx, zz] = whereabouts(1, d.getHour()).pos;
    const heading = Math.atan2(zx - me.x, zz - me.z);
    d.shot(null);
    d.respawn(me.x, me.z, heading);
    // 镜头再转到下码头那一段路的方向（按 W 就是往栈桥走）
    lookOnward();
    ui.hint(d.touch ? '按住屏幕拖一拖就能走 · 点一下地面也行' : '方向键 / WASD 走路 · Shift 跑 · 也可以点地面', 0);
    persist();
  }
  /**
   * 结尾：走到邮差跟前（他一直守在码头等），双人机位，他说两句、少年把空邮袋交回去，镜头停在两个人身上，明信片从旁边升起来。
   * 试玩第 1 轮：原来离码头点 4 米就弹卡片（人还在岛刊社门口的街上，画面正中一根灯杆），夜里还永远见不到邮差。
   */
  function startEnding(f: Folk | null) {
    d.cancelRoute(); pending = null; ui.closeBag(); closeSheet();
    setPhase('ending');
    ending = { t: 0, f, shown: false };
    if (f) { say({ f, who: f.name, title: '邮差', voice: 'postman', lines: POSTMAN.done(d.getHour() >= 19 || d.getHour() < 5, save.dials), kind: 'end', auto: true }); d.shot({ other: headOf(f), face: SEA }); }
    else { d.shot({ front: true }); ui.hint(POSTMAN.doneAlone, 4000); }
  }
  function showEnd() {
    if (!ending || ending.shown) return;
    ending.shown = true;
    const f = ending.f;
    endTalk(false);
    ui.hideHint(); ui.arrow(null);
    // 和邮差站在一起的那个双人机位就是「合影」：不切走
    if (f) d.shot(photoShot(f)); else d.shot({ front: true });
    const prev = save.best, ms = save.playMs;
    const t = (v: number) => `${Math.floor(v / 60000)} 分 ${String(Math.floor((v % 60000) / 1000)).padStart(2, '0')} 秒`;
    let best = '';
    if (prev && ms < prev.playMs) best = `比上次最快还快 ${t(prev.playMs - ms)}！`;
    else if (prev) best = `最好成绩 ${t(prev.playMs)}`;
    if (!prev || ms < prev.playMs) save.best = { playMs: ms, steps: save.steps };
    save.done = true;
    persist();
    ui.openEnd(endStats(), best, letters(), postmark(), !!f, endExtra());
    sound.deliver();
    refreshTrack();
  }
  /** 结尾合影的机位：明信片在右边（电脑、横屏）就把两人让到左边，在下面（竖屏）就让到上面。 */
  const photoShot = (f: Folk) => (innerHeight > innerWidth ? { other: headOf(f), lift: 0.55, face: SEA } : { other: headOf(f), shift: -0.5, face: SEA });
  /** 结尾的镜头朝着海拍（码头往外是栈桥、海和远处的灯塔）。试玩第 2 轮：结尾背景是岛刊社的一面墙，夜里灰紫一片。 */
  const SEA = { x: 1, z: 46 };
  /** 明信片上的邮戳：小岛邮局 · 岛上第几天 · 交差的时刻。 */
  function postmark() { return { day: `第 ${(save.round ?? 0) + save.days + 1} 天`, time: clockText(minuteNow()) }; }
  /**
   * 结尾卡片上多的：这一天的称号（试玩第 2 轮：只有四个数字，没有一句评语）、六位收信人各回一句话、存成明信片用的纯文字统计。
   */
  function endExtra() {
    const ms = save.playMs, min = ms / 60000;
    const badge = save.dials === 0 ? ['不靠钟的邮差', '一次钟都没拨，全靠两条腿赶上了人'] : min < 6 ? ['飞毛腿邮差', '岛上的人还没反应过来，信就到了'] : save.dials >= 4 ? ['管着岛上时间的邮差', `拨了 ${save.dials} 回钟，太阳都被你赶着走`] : save.steps < 320 ? ['认路的邮差', '没走一步冤枉路'] : ['靠得住的邮差', '六封信一封没落下'];
    const replies = RECIPIENTS.map((r) => ({ who: r.name, line: r.after }));
    const plain = `用时 ${Math.floor(ms / 60000)} 分 ${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')} 秒 · 走了 ${save.steps} 步 · 拨了 ${save.dials} 次钟`;
    return { badge: badge[0], why: badge[1], replies, plain };
  }
  /** 结尾卡片上那一行：用时、步数、拨钟、过了几天。 */
  function endStats() {
    const ms = save.playMs, tb = `<b>${Math.floor(ms / 60000)}</b> 分 <b>${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}</b> 秒`;
    return `<span>用时 ${tb}</span> · <span>走了 <b>${save.steps.toLocaleString('zh-CN')}</b> 步</span> · <span>拨了 <b>${save.dials}</b> 次钟</span> · <span>${save.days === 0 ? '当天送完' : `岛上过了 <b>${save.days}</b> 天`}</span>`;
  }
  function roam() { ui.closeEnd(); ending = null; setPhase('play'); d.shot(null); }
  function restart(next = false) {
    ui.closeEnd(); ui.closeBag(); closeSheet(); endTalk(false);
    ending = null; giving = null; dialing = null; sheetDue = null; ui.ff(false);
    save = fresh(next);
    asks.clear(); trackT = 0;
    d.clearHolds();
    d.setHour(CLOCK.start);
    d.respawn(d.spawn.x, d.spawn.z, d.spawn.heading);
    d.shot(null);
    ui.setCount(0);
    persist();
    startIntro();
  }

  // ---------- 邮袋 ----------
  function cards(): BagCard[] {
    const h = d.getHour();
    return RECIPIENTS.map((r) => {
      const done = !!save.delivered[r.id], known = r.id === 1 || save.asked.includes(r.id);
      let where: string | null = null, next: BagCard['next'] = null;
      if (!done && !known && r.ask && hinted.has(r.id)) where = r.ask.bag;
      if (!done && known) {
        const w = whereabouts(r.id, h), b = bagLine(w);
        where = b.now;
        if (b.next && w.next) next = { text: b.next, dial: w.next.dial };
      }
      return { id: r.id, name: r.name, title: r.title, clue: r.clue, done, tracking: save.tracking === r.id, where, next };
    });
  }
  const bagTop = () => (deliveredN() === 6 ? (save.done ? '六封信都送到了。信还能再看。' : '都送到了，回码头找邮差吧。') : `送到 ${deliveredN()} 封，还剩 ${6 - deliveredN()} 封。点一张设成「正在找」。`);
  function renderBag() { ui.renderBag(cards(), bagTop()); }
  function toggleBag() {
    if (ui.bagOpen) { ui.closeBag(); return; }
    if (phase === 'intro' || phase === 'ending') return;
    ui.closeDial();
    ui.openBag(cards(), bagTop());
  }

  // ---------- 区名大字 ----------
  function zoneTick(name: string | null, dt: number) {
    zone.t += dt;
    if (!name || name.endsWith('草地')) { zone.cur = ''; return; }
    if (name !== zone.cur) { zone.cur = name; zone.since = 0; return; }
    zone.since += dt;
    if (zone.since >= 0.8 && zone.since - dt < 0.8 && phase === 'play') {
      const last = zone.seen.get(name) ?? -Infinity;
      if (zone.t - last > 40) { zone.seen.set(name, zone.t); ui.zone(name, dayPart(d.getHour())); sound.zone(); }
    }
  }

  /**
   * 屏幕边上的小箭头指着 (x, y, z)，旁边写 label：在画面里时 inView 为真就挂在它头顶，为假就不出（头顶本来有信封标记）；
   * 不在画面里就贴着屏幕边、朝它那边指。离它 near 米以内不出。
   */
  function pointTo(x: number, y: number, z: number, label: string, near: number, inView: boolean) {
    const me = d.me(), dist = Math.hypot(me.x - x, me.z - z), s = d.toScreen(x, y, z), w = innerWidth, h = innerHeight, m = h < 520 && w > h ? 76 : 48;
    if (dist < near) { ui.arrow(null); return; }
    // 贴边的箭头躲开顶栏（上面 100 像素；竖屏顶栏下面还挂着提示条，让到 190）、左下角的区名大字和右下角那一摞按钮（横屏下面 205、竖屏 300、电脑 270 像素）
    const top = h > w ? 190 : 100, bot = h - (h > w ? 300 : h < 520 ? 205 : 270), mid = (top + bot) / 2;
    if (s && s.x > m && s.x < w - m && s.y > top && s.y < bot) { if (inView) putArrow(s.x, s.y - 30, 90, label); else ui.arrow(null); return; }
    const cy = d.camYaw(), a = Math.atan2(x - me.x, z - me.z) - cy, dx = -Math.sin(a), dy = -Math.cos(a);
    // 在身后（往下指）：不贴下沿（那是少年站的地方，M3 验收 r1：横屏后巷里「周伯」箭头直接压在少年身上），贴左右两边的下角
    if (dy > 0.35) { putArrow(dx < 0 ? m : w - m, bot, (Math.atan2(dy, dx) * 180) / Math.PI, label); return; }
    const k = Math.min((w / 2 - m) / Math.max(1e-3, Math.abs(dx)), (dy < 0 ? mid - top : bot - mid) / Math.max(1e-3, Math.abs(dy)));
    putArrow(w / 2 + dx * k, mid + dy * k, (Math.atan2(dy, dx) * 180) / Math.PI, label);
  }

  /**
   * 这会儿指路箭头指谁：都送到了指码头的邮差；正在找的那封信，知道他在哪（第一封、问过路、行踪自己亮出来了）而且他此刻收得了信，就指他。
   * 试玩第 1 轮：第 2–6 封问到地名后屏幕上没有任何方向指引，新手不认识岛只能乱逛。没问过路的不指（问路是玩法）。
   */
  function guideTarget(): { x: number; y: number; z: number; label: string; near: number } | null {
    if (phase !== 'play') return null;
    if (deliveredN() === 6) {
      if (save.done) return null;
      const p = postman();
      return p && p.visible ? { x: p.x, y: p.head + 0.6, z: p.z, label: '阿海 · 码头', near: 2.4 } : { x: PIER_HOME.x, y: 3.2, z: PIER_HOME.z, label: '码头', near: 3 };
    }
    const t = tracked();
    if (!t || !(t === 1 || save.asked.includes(t)) || !receivable(t, d.getHour())) return null;
    const f = folk.ofLetter(t);
    // 串线索的那两封：箭头只领到一带（12 米内就收起，剩下的看头顶的信封自己找）
    return f && f.visible ? { x: f.x, y: f.head + 0.6, z: f.z, label: f.name, near: recipient(t).ask ? 12 : 2.6 } : null;
  }
  let guideAt: { x: number; z: number } | null = null, blockedT = -1e9;
  const run6 = () => performance.now() - blockedT < 6000;
  /**
   * 把箭头（连同下面的标签）放到 (x, y)：要是压在少年身上（头顶到脚、左右各 60 像素，标签在箭头下面 18–46 像素），就横着挪到他身子旁边
   * （试玩第 2 轮：目标在正前方时箭头和「这边绕 · 周伯」的白底标签正好压住少年的头和肩）。
   */
  function putArrow(x: number, y: number, a: number, label: string) {
    const me = d.me(), head = d.toScreen(me.x, (me.y ?? 0) + 1.9, me.z), foot = d.toScreen(me.x, me.y ?? 0, me.z);
    if (head && foot) {
      const half = Math.max(48, Math.abs(foot.y - head.y) * 0.35), lw = Math.min(150, 34 + label.length * 15) / 2;
      const x0 = head.x - half, x1 = head.x + half, y0 = head.y - 20, y1 = foot.y + 10;
      if (x + lw > x0 && x - lw < x1 && y + 46 > y0 && y - 14 < y1) {
        const left = x0 - lw - 8, right = x1 + lw + 8, m = 12 + lw;
        x = (x < head.x && left > m) || right > innerWidth - m ? Math.max(m, left) : Math.min(innerWidth - m, right);
      }
    }
    ui.arrow(x, y, a, label);
  }
  /**
   * 箭头：目标能直着走过去（或者路基本是直的）就指目标，写「往这边」（在画面里就不出，头顶有信封）；真要绕（隔着海、房子、摊位）才写「这边绕」、指下一个拐点：
   * 拐点在身边就贴在少年脚边朝它指，拐点在画面里就挂在它头顶写「先走到这儿」。试玩第 2 轮：直直一条栈桥也写「这边绕」，夜市里箭头朝下指着远处路面看不懂。
   */
  function drawGuide(t: number) {
    const g = talk ? null : guideTarget();
    if (!g) { ui.arrow(null); guideAt = null; return; }
    const w = d.guideTo(g.x, g.z);
    if (!w || w.direct || w.bend < 0.45) { guideAt = w && !w.direct ? { x: w.x, z: w.z } : { x: g.x, z: g.z }; pointTo(g.x, g.y, g.z, w && !w.direct ? `往这边 · ${g.label}` : g.label, g.near, false); return; }
    guideAt = { x: w.x, z: w.z };
    const me = d.me(), label = `这边绕 · ${g.label}`;
    // 拐点就在身边（5 米内，常常在侧面、身后）：箭头贴在少年脚边、朝拐点那边指（挂在拐点头顶的话，玩家朝箭头拖反而往前走）
    if (Math.hypot(w.x - me.x, w.z - me.z) < 5) {
      const s0 = d.toScreen(me.x, (me.y ?? w.y) + 0.2, me.z), s1 = d.toScreen(w.x, w.y + 0.2, w.z);
      if (s0 && s1 && Math.hypot(s1.x - s0.x, s1.y - s0.y) > 4) {
        const a = Math.atan2(s1.y - s0.y, s1.x - s0.x), r = Math.min(innerWidth, innerHeight) * 0.2;
        const x = Math.max(60, Math.min(innerWidth - 60, s0.x + Math.cos(a) * r)), y = Math.max(120, Math.min(innerHeight - 160, s0.y - 40 + Math.sin(a) * r));
        putArrow(x, y, (a * 180) / Math.PI, label);
        return;
      }
    }
    pointTo(w.x, w.y + 1.1, w.z, `先走到这儿 · ${g.label}`, 0, true);
    void t;
  }

  /** 屏幕上点到了哪个人（胸口投到屏幕上离点击最近、36 像素内；比点到的地面远 2 米以上的算被挡住）。 */
  function pickPerson(sx: number, sy: number, groundDist: number | null) {
    const cam = d.camPos(), px = d.touch ? 44 : 36;
    let best: Folk | null = null, bd = px;
    // 先看点没点到头顶的信封（试玩第 1 轮：点栈桥上方的信封、点 10 米外头顶信封的老林都没反应——原来只认胸口 36 像素内）
    let be = d.touch ? 52 : 40;
    for (const e of folk.envelopes) { const s = d.toScreen(e.x, e.y, e.z); if (!s) continue; const dd = Math.hypot(s.x - sx, s.y - sy); if (dd < be) { be = dd; best = e.f; } }
    if (best) return best;
    for (const f of folk.list) {
      if (!f.visible || f.dist > 40) continue;
      const s = d.toScreen(f.x, f.head - 0.65, f.z), top = d.toScreen(f.x, f.head, f.z), foot = d.toScreen(f.x, f.y, f.z);
      if (!s) continue;
      // 点在他身子的竖条里（头顶到脚、左右各 0.4 个身高宽）也算点中：近处的人身子大，点胳膊、腿都认
      const tall = top && foot ? Math.abs(foot.y - top.y) : 0, inBody = !!top && !!foot && sy > top.y - 8 && sy < foot.y && Math.abs(sx - s.x) < Math.max(18, tall * 0.4);
      const dd = inBody ? Math.min(Math.hypot(s.x - sx, s.y - sy), px * 0.5) : Math.hypot(s.x - sx, s.y - sy), cd = Math.hypot(f.x - cam.x, f.z - cam.z);
      if (dd < bd && (groundDist === null || cd < groundDist + 2)) { bd = dd; best = f; }
    }
    return best;
  }

  const api = {
    get save() { return save; },
    get phase() { return phase; },
    /** 六封都送到了、还没交差（邮差这时一直在码头等）。 */
    get allDelivered() { return deliveredN() === 6 && (!save.done || ending !== null); },
    get talking() { return talk ? { who: talk.who, line: talk.lines[talk.i], kind: talk.kind, i: talk.i, n: talk.lines.length } : null; },
    /** 开局：有存档就接着玩，没有就放开场。 */
    begin() {
      playing = true;
      ui.setMuted(sound.muted, sound.music);
      if (d.startHour !== null) { save.intro = true; save.hour = d.startHour; }
      d.setHour(save.hour);
      if (save.intro) {
        const ok = d.standable(save.x, save.z) && Math.hypot(save.x, save.z) < 60;
        d.respawn(ok ? save.x : d.spawn.x, ok ? save.z : d.spawn.z, ok ? save.heading : d.spawn.heading);
        d.boy.hasBag = true;
        ui.showBag(true); ui.setCount(deliveredN());
        refreshTrack();
        setPhase('play');
        // 已经通关又打开（M3 验收 r1：刷新后直接进自由逛，「再送一天」要到邮袋底部去找）：先把结尾卡片再给一次，「再送一天」「接着逛」都在上面
        if (save.done) ui.openEnd(endStats(), '这一天的信都送完了。', letters(), postmark(), false, endExtra());
        else ui.hint(d.touch ? '按住屏幕拖一拖就能走 · 点一下人就能说话' : '方向键 / WASD 走路 · E 说话 · B 邮袋 · T 拨钟', 6000);
      } else startIntro();
    },
    /** 输入层要知道的：这一帧少年能不能走（送达、拨钟、开场、结尾时不能）。 */
    locked: () => phase !== 'play' || sheetUp(),
    /** 推进玩法（每帧，在走路之前）：moving 是这一帧有没有方向输入。 */
    update(dt: number, moving: boolean) {
      if (!playing) return;
      if (phase !== 'intro' && !save.done) save.playMs += dt * 1000;
      stepGive(dt); stepDial(dt);
      if (sheetDue && (sheetDue.t -= dt) <= 0) {
        const id = sheetDue.id;
        sheetDue = null;
        if (phase === 'play' || phase === 'deliver') { sound.paper(); ui.openSheet(letters()[id - 1], recipient(id).name); sheetAt = performance.now(); }
        else flushAfterSheet();
      }
      const me = d.me();
      // 说话：逐字出、说完停一会儿自己往下；走开、按方向就收
      if (talk) {
        const line = talk.lines[talk.i];
        if (talk.shown < line.length) { talk.shown = Math.min(line.length, talk.shown + dt * TYPE.cps); ui.bubbleText(line.slice(0, Math.floor(talk.shown))); }
        else if (talk.auto && (talk.held += dt) > (talk.kind === 'intro' ? TYPE.holdIntro : TYPE.hold) + line.length * 0.04) next();
        if (talk) ui.bubbleMore(talk.shown >= talk.lines[talk.i].length && (talk.i < talk.lines.length - 1 || talk.kind === 'intro'), talk.kind === 'intro' && talk.i === talk.lines.length - 1 ? '点一下出发 ›' : d.touch ? '点一下继续 ›' : '点一下 / E 继续 ›');
        if (talk && talk.f && talk.kind === 'chat') {
          const far = Math.hypot(talk.f.x - me.x, talk.f.z - me.z) > REACH.leave || !talk.f.visible;
          if (far || (moving && talk.shown >= 2)) endTalk();
          else { d.face(Math.atan2(talk.f.x - me.x, talk.f.z - me.z), dt); }
        }
        if (talk?.f && talk.kind !== 'chat') d.face(Math.atan2(talk.f.x - me.x, talk.f.z - me.z), dt);
      }
      if (ending && !ending.shown && !talk && (ending.t += dt) > (ending.f ? 0.3 : 2.2)) showEnd();
      if (phase !== 'play') return;
      if (turnWant !== null) {
        if (moving || talk) turnWant = null;
        else { d.face(turnWant, dt); const dh = Math.atan2(Math.sin(turnWant - d.me().heading), Math.cos(turnWant - d.me().heading)); if (Math.abs(dh) < 0.03) turnWant = null; }
      }
      // 信纸开着：别的先不发生（不接着送下一封、不进结尾）
      if (sheetUp()) { if ((saveT += dt) > 10) { saveT = 0; persist(); } return; }
      // 收信人：走到跟前自动开口送信
      for (const id of LETTER_IDS) {
        if (save.delivered[id]) continue;
        const f = folk.ofLetter(id);
        if (f && f.visible && f.dist < giveReach(f) && receivable(id, d.getHour())) { endTalk(false); startGive(f, id); return; }
      }
      // 点了一个人：走到他跟前就开口
      if (pending) {
        if (!pending.visible) pending = null;
        else if (pending.dist < reach(pending)) { d.cancelRoute(); startTalk(pending); }
        // 走到了他却挪开了（老林在灯塔下来回踱步）：再追，最多追三回
        else if (!d.routing()) { const f = pending; if (chase++ < 3 && f.dist < 8) api.approach(f, true); else pending = null; }
      }
      // 结尾：六封都送到、回到码头
      // 走到邮差跟前（他一直在码头等）才交差；他不在（不该发生）才按回到码头那一圈算
      if (deliveredN() === 6 && !save.done) {
        const p = postman();
        if (p ? p.visible && p.dist < REACH.talk + 0.4 : Math.hypot(me.x - PIER_HOME.x, me.z - PIER_HOME.z) < PIER_HOME.r) { startEnding(p); return; }
      }
      // 找一封信 90 秒还没问过人：行踪行自己亮出来
      const t = tracked();
      if (t && !save.asked.includes(t) && (trackT += dt) > (recipient(t).ask ? REVEAL_AFTER * 1.7 : REVEAL_AFTER)) { save.asked.push(t); trackT = 0; ui.hint(`邮袋里多了一行：${recipient(t).name}这会儿在哪。`, 5000); ui.setCount(deliveredN(), true); }
      if ((saveT += dt) > 10) { saveT = 0; persist(); }
      if (ui.bagOpen && (bagT += dt) > 1) { bagT = 0; renderBag(); }
    },
    /** 每帧画面（人都更新过以后）：说话按钮、气泡挂在头顶、头顶标记、指向码头的箭头。 */
    frame(t: number, dt: number, zoneName: string | null) {
      const me = d.me();
      zoneTick(zoneName, dt);
      // 说话按钮：离得最近、够得着的那个人（收信人走到跟前自己开口，不用按）
      let cand: Folk | null = null;
      if (phase === 'play') {
        // 收信人走到 1.6 米内自己开口；够得着（1.9 米）但被旁边的人挡着挤不过去时，按钮也能把信递过去
        cand = folk.nearest(me.x, me.z, REACH.seated, (f) => f.dist > reach(f) || f === talk?.f);
      }
      api.candidate = cand;
      ui.setTalk(cand ? cand.name : null, !!cand?.letter && !save.delivered[cand.letter] && receivable(cand.letter, d.getHour()));
      // 气泡挂在说话人的头顶（他在画面外就贴在上沿）
      if (talk?.f) { const s = d.toScreen(talk.f.x, talk.f.head + 0.15, talk.f.z); ui.placeBubble(s ? s.x : null, s ? s.y : 0); }
      // 结尾说话时用平常的双人机位（朝着海），明信片出来了才把两人让到一边（试玩第 2 轮：说话时两人就挤在上面四成，气泡贴着顶栏）
      if (talk?.f && phase !== 'dial') d.shot(talk.kind === 'end' ? { other: headOf(talk.f), face: SEA } : { other: headOf(talk.f) });
      else if (ending?.shown && ending.f) d.shot(photoShot(ending.f));
      bodies.length = 0;
      bodies.push({ x: me.x, y: me.y ?? 0, z: me.z, h: 1.7 });
      if (talk?.f) bodies.push({ x: talk.f.x, y: talk.f.y, z: talk.f.z, h: talk.f.head - talk.f.y + 0.1 });
      // 头顶的信封只给此刻收得了信的人（试玩第 2 轮：小北白天在广场头顶飘着信封，走过去却说「天黑了来夜市找我」）
      folk.marks(phase === 'intro' ? new Set() : new Set([...pendingSet()].filter((id) => receivable(id, d.getHour()))), t, d.camYaw(), d.reduced, phase === 'play', d.camPos(), { toScreen: d.toScreen, bodies });
      // 指路箭头：都送到了指邮差；正在找的人知道下落就指他（隔着东西就指下一个拐点）
      drawGuide(t);
    },
    /** 递信的姿势（boy.pose 用）。 */
    givePose,
    /** 指路箭头这会儿指的方向（世界坐标、单位长度，从少年指向下一个拐点）；没有箭头是 null。摇杆顺着它拖就照它走。 */
    get guideDir() {
      if (!guideAt || phase !== 'play') return null;
      const me = d.me(), dx = guideAt.x - me.x, dz = guideAt.z - me.z, l = Math.hypot(dx, dz);
      return l > 0.6 ? { x: dx / l, z: dz / l } : null;
    },
    /** 推着方向一秒挪不动：说一句（6 秒内只说一次）。 */
    blocked() {
      if (phase !== 'play' || talk || run6()) return;
      blockedT = performance.now();
      ui.hint(guideAt ? '这边过不去——跟着红箭头绕一下' : '这边过不去，换个方向试试', 2600);
    },
    candidate: null as Folk | null,
    /** 走了一步（统计）。 */
    step() { if (phase !== 'intro' && !save.done) save.steps++; },
    /** E / 空格 / 回车：说话、下一句。 */
    act() {
      if (talk) { next(); return; }
      if (ui.sheetOpen) { if (performance.now() - sheetAt > 600) closeSheet(); return; }
      if (sheetDue) return;
      if (api.candidate && phase === 'play') startTalk(api.candidate);
    },
    /** 点了屏幕：点到人就走过去和他说话，返回 true（点地面交回给页面）。 */
    /** 走到这个人跟前（停在他朝少年这一侧 1.1 米处），到了就开口（收信人就送信）。 */
    approach(f: Folk, again = false) {
      if (!again) chase = 0;
      const me = d.me();
      if (f.dist < reach(f)) { startTalk(f); return true; }
      // 站到他身边哪儿：先试朝少年这一侧 1.1 米，站不了人（灯塔墙根、柜台后面）就绕着他一圈找能站的点，离少年近的先试
      // （M2 验收：从老林东南边点他，朝少年那一侧正好是灯塔的墙，找不到路就什么也不做）
      const base = Math.atan2(me.x - f.x, me.z - f.z), spots: [number, number, number][] = [];
      for (const r of [1.1, 1.5]) for (let k = 0; k < 12; k++) {
        const a = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6), x = f.x + Math.sin(a) * r, z = f.z + Math.cos(a) * r;
        if (d.standable(x, z)) spots.push([x, z, Math.hypot(x - me.x, z - me.z) + (r - 1.1) * 2]);
      }
      spots.sort((a, b) => a[2] - b[2]);
      pending = f;
      for (const [x, z] of spots.slice(0, 6)) if (d.walkTo(x, z)) return true;
      if (!spots.length && !d.walkTo(f.x + Math.sin(base) * 1.1, f.z + Math.cos(base) * 1.1) && !d.routing()) { pending = null; return false; }
      if (!d.routing()) { pending = null; return false; }
      return true;
    },
    tap(sx: number, sy: number, groundDist: number | null) {
      // 信纸开着：点画面就是「收好」（刚升起来的半秒不算，免得翻台词的那一下把它收掉）；不走路
      if (ui.sheetOpen) { if (performance.now() - sheetAt > 500) closeSheet(); return true; }
      if (sheetDue) return true;
      // 气泡开着：点哪儿都是翻页（试玩第 2 轮：手指落在人和气泡旁边，一下翻页一下让人重说、一下让少年走开）；说完半秒内的那一下也只算收起
      if (talk) { next(); return true; }
      if (performance.now() - talkEnd.t < 500) return true;
      if (phase !== 'play') return phase === 'intro' ? (next(), true) : false;
      const f = pickPerson(sx, sy, groundDist);
      if (!f) return false;
      // 刚说完话的那个人 3 秒内再点：不让他把同一件事重说一遍（点到他脚下的地面也不走）
      if (f === talkEnd.f && performance.now() - talkEnd.t < 3000) return true;
      api.approach(f);
      return true;
    },
    talkTo: (f: Folk) => startTalk(f),
    /** 开局的操作提示收起来以后（走出 3 米）：第一封还没送，就说一句去哪找（不看说明也知道往哪走）。 */
    walkedOff() {
      if (save.delivered[1] || tracked() !== 1 || phase !== 'play') return;
      const w = whereabouts(1, d.getHour());
      ui.hint(w.out ? '第一封给周伯：栈桥尽头，头顶有信封的那位' : '第一封给周伯：打开邮袋看看线索', 7000);
    },
    next, toggleBag, openDial, dialTo, closeSheet, restart, roam, finishIntro,
    closeAll() {
      if (ui.endOpen) { roam(); return true; }
      if (ui.dialOpen) { ui.closeDial(); return true; }
      if (ui.bagOpen) { ui.closeBag(); return true; }
      if (ui.sheetOpen) { closeSheet(); return true; }
      return false;
    },
    track(id: LetterId) { if (save.delivered[id]) return; save.tracking = id; trackT = 0; refreshTrack(); renderBag(); persist(); },
    whereDial(minute: number) { ui.closeBag(); openDial(minute); },
    reread(id: LetterId) { ui.closeBag(); ui.openSheet(letters()[id - 1], recipient(id).name); },
    stuck() { ui.closeBag(); d.respawn(d.spawn.x, d.spawn.z, d.spawn.heading); persist(); },
    /** M 键：只管静音（背景音乐的开关记着不动）。 */
    toggleMute() { sound.unlock(); sound.setMuted(!sound.muted); ui.setMuted(sound.muted, sound.music); store.setPrefs({ muted: sound.muted, music: sound.music }); ui.hint(sound.muted ? '静音了' : sound.music ? '声音开了' : '声音开了（背景音乐关着）', 1800); },
    /** N 键：只管背景音乐。 */
    toggleMusic() { sound.unlock(); sound.setMusic(!sound.music); if (sound.muted && sound.music) sound.setMuted(false); ui.setMuted(sound.muted, sound.music); store.setPrefs({ muted: sound.muted, music: sound.music }); ui.hint(sound.music ? '背景音乐开了' : '背景音乐关了，别的声音还在', 2200); },
    /** 声音按钮：全开 → 关掉背景音乐 → 全部静音 → 全开，一下一下点过去，每次屏幕下方说一句现在是什么状态。 */
    cycleSound() {
      sound.unlock();
      if (sound.muted) { sound.setMuted(false); sound.setMusic(true); }
      else if (sound.music) sound.setMusic(false);
      else sound.setMuted(true);
      ui.setMuted(sound.muted, sound.music);
      store.setPrefs({ muted: sound.muted, music: sound.music });
      ui.hint(sound.muted ? '全部静音了 · 再点一下打开' : sound.music ? '声音全开 · 再点一下只关背景音乐' : '背景音乐关了，别的声音还在 · 再点一下全部静音', 2600);
    },
    persist,
    /** 开场时邮差站住：给老岛民的「让一让」传一个就在邮差身边的点（他在那儿停下）。 */
    residentNear(bx: number, bz: number) {
      const p = phase === 'intro' ? postman() : null;
      if (!p) return { x: bx, z: bz };
      const dx = bx - p.x, dz = bz - p.z, l = Math.hypot(dx, dz) || 1;
      return { x: p.x + (dx / l) * 0.6, z: p.z + (dz / l) * 0.6 };
    },
    /** 调试、机器人用。 */
    deliverNow(id: LetterId) { const f = folk.ofLetter(id); if (f) startGive(f, id); else { save.delivered[id] = { order: deliveredN() + 1, hour: d.getHour() }; ui.setCount(deliveredN()); persist(); } },
    get pending() { return pending; },
  };
  return api;
}
export type Game = ReturnType<typeof createGame>;
