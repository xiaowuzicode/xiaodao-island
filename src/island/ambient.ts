/**
 * 海浪声：用 WebAudio 现场合成，不下载音频文件、没有版权问题。
 * 三层：低沉的浪（褐噪声 + 低通，约 9 秒一次涨落）、浪花沙沙声（白噪声 + 带通）、很轻的海风（带通扫频）。
 * 默认关闭；开关时淡入淡出；切走标签页自动暂停。不依赖 three，按需单独加载。
 */

/** 总音量、淡入淡出秒数。 */
const VOLUME = 0.55;
const FADE_IN = 1.6;
const FADE_OUT = 0.8;
/** 噪声缓冲的长度（秒），循环播放。 */
const NOISE_SECONDS = 6;

type Ctx = BaseAudioContext;

function noise(ctx: Ctx, brown: boolean) {
  const len = ctx.sampleRate * NOISE_SECONDS, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w * 0.5;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.start();
  return src;
}

/** 一个慢速正弦，叠加到某个参数上：base ± depth，周期 period 秒。 */
function lfo(ctx: Ctx, param: AudioParam, base: number, depth: number, period: number) {
  param.value = base;
  const osc = ctx.createOscillator(), amp = ctx.createGain();
  osc.frequency.value = 1 / period;
  amp.gain.value = depth;
  osc.connect(amp).connect(param);
  osc.start();
}

function filter(ctx: Ctx, type: BiquadFilterType, freq: number, q: number) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** 搭三层声音的节点图（导出给离线渲染测试用）。 */
export function build(ctx: BaseAudioContext, out: AudioNode) {
  // 浪：褐噪声 → 低通 → 随涨落起伏的音量
  const swell = ctx.createGain();
  noise(ctx, true).connect(filter(ctx, 'lowpass', 420, 0.7)).connect(swell).connect(out);
  lfo(ctx, swell.gain, 0.55, 0.4, 9);
  // 浪花：白噪声 → 带通，周期略错开，像浪头打上沙滩
  const foam = ctx.createGain();
  noise(ctx, false).connect(filter(ctx, 'bandpass', 2600, 0.6)).connect(foam).connect(out);
  lfo(ctx, foam.gain, 0.035, 0.03, 9.6);
  // 海风：白噪声 → 窄带通，中心频率慢慢扫动
  const wind = ctx.createGain(), bp = filter(ctx, 'bandpass', 700, 1.6);
  noise(ctx, false).connect(bp).connect(wind).connect(out);
  lfo(ctx, bp.frequency, 700, 280, 17);
  lfo(ctx, wind.gain, 0.05, 0.035, 23);
}

export interface Ambient { readonly on: boolean; toggle(): Promise<boolean>; state(): string }

export function createAmbient(): Ambient | null {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) { console.warn('[island] 浏览器不支持 WebAudio，海浪声不可用'); return null; }
  let ctx: AudioContext | null = null, master: GainNode | null = null, on = false, stopTimer = 0;

  function ensure() {
    if (ctx && master) return { ctx, master };
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    build(ctx, master);
    return { ctx, master };
  }
  function fade(to: number, seconds: number) {
    const { ctx: c, master: m } = ensure();
    m.gain.cancelScheduledValues(c.currentTime);
    m.gain.setValueAtTime(m.gain.value, c.currentTime);
    m.gain.linearRampToValueAtTime(to, c.currentTime + seconds);
  }
  document.addEventListener('visibilitychange', () => {
    if (!ctx || !on) return;
    if (document.hidden) ctx.suspend().catch((e) => console.warn('[island] 海浪声暂停失败', e));
    else ctx.resume().catch((e) => console.warn('[island] 海浪声恢复失败', e));
  });

  return {
    get on() { return on; },
    state: () => ctx?.state ?? 'idle',
    async toggle() {
      const { ctx: c } = ensure();
      clearTimeout(stopTimer);
      on = !on;
      if (on) {
        await c.resume();
        fade(VOLUME, FADE_IN);
      } else {
        fade(0, FADE_OUT);
        // 淡出完再挂起，省电
        stopTimer = window.setTimeout(() => { if (!on) c.suspend().catch((e) => console.warn('[island] 海浪声挂起失败', e)); }, FADE_OUT * 1000 + 100);
      }
      return on;
    },
  };
}
