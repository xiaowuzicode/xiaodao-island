/**
 * 小岛邮差：画质三档、动态分辨率、自动降级。判定是纯函数（检查脚本喂假数据测），落实在 main.ts。
 *
 * - 高（电脑默认）：后期 + 彩铅 + 柔光 + 4 倍抗锯齿，阴影 2048，64 人（精细小人 10 个）。
 * - 中（手机默认；电脑降级）：后期 + 彩铅，无柔光无抗锯齿，阴影 1024，省电海面，22 人（精细 6 个）。
 * - 低：保留彩铅后期（不要柔光、抗锯齿），像素比 1.25，没有阴影，22 人（精细 3 个），老岛民 11 个。
 *   试玩第 2 轮：原来低档关掉后期、像素比 1，慢手机开局 8 秒掉到底，彩铅和纸边全没了、满屏锯齿，整局回不来。
 * 自动降级：先锁半刷新率（高刷屏），再降分辨率（1 → 0.85 → 0.72），到底了还慢才降一档。
 * 帧率稳了会升回来：连着 4 个窗口（10 秒）平均快过 57 帧、一帧不掉，升一档（升上去以后 30 秒内又降下来，就不再升了）。
 */

export interface Tier {
  dpr: number; pixels: number; post: boolean; bloom: boolean; msaa: boolean; shadow: number;
  lampLights: number; crowdMobile: boolean; detail: number; residents: number | undefined; liteSea: boolean;
  /** 小于这么多像素（半径）的零件不画（远处的手、路灯零件）。 */
  minPx: number;
  /** 海面网格一边几段（520 米见方：130 段 4 米一格，弯曲误差 1 厘米；80 段 6.5 米一格，3 厘米）、平面切到多长一条边、云用几段的球。 */
  seaSeg: number; tessEdge: number; cloudSeg: [number, number];
}
export const TIERS: Tier[] = [
  { dpr: 1.25, pixels: 1.0e6, post: true, bloom: false, msaa: false, shadow: 0, lampLights: 0, crowdMobile: true, detail: 3, residents: 11, liteSea: true, minPx: 3.6, seaSeg: 80, tessEdge: 3, cloudSeg: [9, 6] },
  { dpr: 1.5, pixels: 1.8e6, post: true, bloom: false, msaa: false, shadow: 1024, lampLights: 2, crowdMobile: true, detail: 6, residents: undefined, liteSea: true, minPx: 2, seaSeg: 96, tessEdge: 2, cloudSeg: [12, 8] },
  { dpr: 2, pixels: 3.2e6, post: true, bloom: true, msaa: true, shadow: 2048, lampLights: 6, crowdMobile: false, detail: 10, residents: undefined, liteSea: false, minPx: 1.2, seaSeg: 130, tessEdge: 2, cloudSeg: [16, 12] },
];
/** 动态分辨率的几格。 */
export const SCALES = [1, 0.85, 0.72];
/** 慢帧的线：慢于 48 帧/秒（半刷新率下 24）。 */
export const LOW_FPS = 48;
/** 一个窗口多长（秒）、几个窗口连着慢才降档。 */
export const WINDOW = 2.5, SLOW_WINDOWS = 2;

/** 内部渲染的像素密度：不超过这一档的密度，也不超过这一档的像素总数，再乘动态分辨率。 */
export function pixelRatio(tier: Tier, devicePixelRatio: number, w: number, h: number, scale: number) {
  return Math.min(devicePixelRatio, tier.dpr, Math.sqrt(tier.pixels / Math.max(1, w * h))) * scale;
}

export type Judge = 'hold' | 'halfRate' | 'scaleDown' | 'scaleUp' | 'tierDown' | 'tierUp';
/** 升档：连着几个窗口够快、够快是平均快过多少帧。 */
export const UP_WINDOWS = 4, UP_FPS = 57;
/** 降级判定的状态（每帧喂一个帧间隔，按半秒、2.5 秒两种窗口出结论）。 */
export interface JudgeState {
  period: number; recent: number[]; frames: number; late: number; calm: number; lateWindows: number; halfRate: boolean;
  /** winSlow：这一段「算慢」的那条线（秒，按刷新间隔定）。 */
  winTime: number; winFrames: number; winSlow: number; slow: number; scaleAt: number;
  /** 连着够快的窗口数；这个窗口里掉过帧没有。 */
  good: number; winLate: number;
}
export const newJudge = (): JudgeState => ({ period: 1 / 60, recent: [], frames: 0, late: 0, calm: 0, lateWindows: 0, halfRate: false, winTime: 0, winFrames: 0, winSlow: 0, slow: 0, scaleAt: 0, good: 0, winLate: 0 });

/**
 * 喂一帧（real：这一帧的真实间隔，秒）。返回这一帧该做的动作（多数时候是 hold）。
 * 规则（照 skate/main.ts 的循环）：
 * 1. 屏幕刷新间隔取最近 20–40 帧里偏快的那一头（15% 分位）：一直卡在二十来帧时不会把刷新间隔也量成五十毫秒；高刷屏连着两个半秒都掉帧 → 锁半刷新率。
 * 2. 每半秒：掉了三帧以上 → 分辨率降一格；连着四秒（八个半秒）一帧不掉 → 升一格。
 * 3. 每 2.5 秒：这一段的平均帧率低于 48 帧/秒（锁 30 帧的屏低于 27 帧/秒，半刷新率下 24）记一次慢；分辨率已经到底、连着两个窗口慢 → 降一档。
 *    （M1 验收：原来按「六成帧慢于 38 毫秒」算，CPU 跟不上时帧在 33 / 50 毫秒之间跳，平均二十四五帧也从来不降档。）
 */
export function judge(s: JudgeState, real: number, canTierDown: boolean, canTierUp = false): Judge {
  s.recent.push(real);
  if (s.recent.length > 40) s.recent.shift();
  if (s.recent.length >= 20 && s.frames % 20 === 0) {
    const sorted = [...s.recent].sort((a, b) => a - b), mid = sorted[Math.floor(sorted.length * 0.15)];
    if (mid > 0.004 && mid < 0.04) s.period = mid;
  }
  s.frames++;
  // 刷新间隔还没量出来（前 20 帧）先不判
  if (s.recent.length < 20) return 'hold';
  // 掉帧：比刷新间隔的一倍半还慢（但慢过 1/26 秒的一律算掉帧——不然一直二十来帧时刷新间隔也被量成五十毫秒，就永远不算掉帧了）
  if (real > Math.min(s.period * (s.halfRate ? 2.6 : 1.5), 1 / 26)) { s.late++; s.winLate++; }
  // 慢：平均慢于 48 帧/秒；系统锁在 30 帧的手机（省电模式）每帧本来就是 33 毫秒，不算慢——线跟着刷新间隔抬，但不超过 1/27 秒
  const slowLine = Math.max(s.halfRate ? 1 / (LOW_FPS / 2) : 1 / LOW_FPS, Math.min(s.period * 1.12, 1 / 27));
  s.winSlow = slowLine;
  s.winTime += real; s.winFrames++;
  let act: Judge = 'hold';
  if (s.frames % Math.max(1, Math.round(0.5 / (s.period * (s.halfRate ? 2 : 1)))) === 0) {
    if (!s.halfRate && s.period < 1 / 100) { s.lateWindows = s.late >= 3 ? s.lateWindows + 1 : 0; if (s.lateWindows >= 2) { s.halfRate = true; s.late = 0; act = 'halfRate'; } }
    if (act === 'hold') {
      if (s.late >= 3) { s.calm = 0; if (s.scaleAt < SCALES.length - 1) { s.scaleAt++; act = 'scaleDown'; } }
      else if (s.late === 0 && ++s.calm >= 8 && s.scaleAt > 0) { s.calm = 0; s.scaleAt--; act = 'scaleUp'; }
    }
    s.late = 0;
  }
  if (s.winTime >= WINDOW) {
    s.slow = s.winTime / s.winFrames > s.winSlow ? s.slow + 1 : 0;
    s.good = s.winTime / s.winFrames < 1 / UP_FPS && s.winLate === 0 && s.scaleAt === 0 && !s.halfRate ? s.good + 1 : 0;
    s.winTime = 0; s.winFrames = 0; s.winSlow = 0; s.winLate = 0;
    if (act === 'hold' && s.slow >= SLOW_WINDOWS && s.scaleAt === SCALES.length - 1 && canTierDown) { s.slow = 0; s.scaleAt = 0; s.good = 0; act = 'tierDown'; }
    else if (act === 'hold' && s.good >= UP_WINDOWS && canTierUp) { s.good = 0; act = 'tierUp'; }
  }
  return act;
}
