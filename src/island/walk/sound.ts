/**
 * 小岛邮差：声音。不加载任何文件，全是振荡器和滤过的噪声现场合成（做法同滑板页的 skate/sound.ts）。
 * - 第一次点击 / 按键后才建 AudioContext（浏览器的自动播放限制）；页面隐藏时挂起，回来再接上。
 * - 调音台：环境 / 提示音 / 脚步 / 音乐 四路进一个温和的压限；说话、送达时环境和音乐轻轻让一下。
 * - 脚步：每落一次脚一声，按脚下是沙、草、石板、木板换音色（左右脚音高差一点，跑起来更响更短）。
 * - 环境：海浪（离海越近越响，复用首页那套三层合成）、人声（夜市傍晚以后最热闹，白天广场、街上有一点）、风（山上、灯塔岬、栈桥尽头大）、
 *   夜里的虫鸣、偶尔的海鸥。各自按少年的位置和镜头的朝向算音量和左右声像。
 * - 提示音：开口（按说话人的身份给不同音高）、送达（上行的小琶音）、拆信（纸声）、拨钟（咔哒）、挂上邮袋、进新地方（一声很轻的木琴）。
 * - 音乐：五声音阶的慢琶音加一层长音和低音，白天大调、夜里小调，每小节随机省掉几个音，听着不像循环；可以单独关。
 * - 静音、音乐开关记在本机（walk-prefs-v1），由页面存。
 */
import { build as buildSea } from '@/island/ambient';
import type { Surface } from '@/island/walk/ground';
import type { Voice } from '@/island/walk/talk';

/** 开口的音高（赫兹）：小孩高、老人低。 */
const PITCH: Partial<Record<Voice, number>> = { kid: 880, elder: 392, fisher: 440, keeper: 415, postman: 494, owl: 523, tourist: 587 };
/** 三路的音量、总音量。 */
const LEVEL = { amb: 0.5, sfx: 0.75, steps: 0.5, music: 0.14 } as const;
const MASTER = 0.9;
/** 说话、送达时环境和音乐压到多少。 */
const DUCK = 0.55;
/** 音乐：每分钟几拍（八分音符一步）、白天和夜里的音阶（相对 C4 的半音）、四小节一轮的和弦根音。 */
const BPM = 76;
const SCALE_DAY = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21], SCALE_NIGHT = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];
const ROOTS_DAY = [0, -3, -7, -5], ROOTS_NIGHT = [-3, -7, -12, -5];
const C4 = 261.63, hz = (semi: number) => C4 * 2 ** (semi / 12);

/** 每一刻环境声要的东西（页面每帧给，声音这边十分之一秒采一次）。 */
export interface Bed {
  /** 离海多近 0–1（站在栈桥上、沙滩上是 1）。 */
  coast: number;
  /** 人声：音量 0–1、左右 −1–1。 */
  crowd: { gain: number; pan: number };
  /** 风 0–1（山上、灯塔岬、栈桥尽头大）。 */
  wind: number;
  /** 夜里 0–1。 */
  night: number;
  /** 岛上几点（音乐换调式）。 */
  hour: number;
  /** 有没有在走（脚步之外，走着的时候风声稍大一点）。 */
  moving: boolean;
}

/** 一声脚步（实时、离线渲染共用）：at 是第几秒、surface 脚下、run 是不是在跑、left 左脚还是右脚。 */
export function footstep(ctx: BaseAudioContext, out: AudioNode, white: AudioBuffer, at: number, surface: Surface, run: boolean, left: boolean) {
  const k = run ? 1.35 : 1, p = left ? 1 : 1.06;
  const noise = (type: BiquadFilterType, f0: number, f1: number, q: number, dur: number, gain: number, attack = 0.004) => {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = white; f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0 * p, at); f.frequency.exponentialRampToValueAtTime(Math.max(40, f1 * p), at + dur);
    g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(gain * k, at + attack); g.gain.exponentialRampToValueAtTime(0.0005, at + dur);
    s.connect(f).connect(g).connect(out); s.start(at, Math.random() * 0.8); s.stop(at + dur + 0.02);
  };
  const tone = (f0: number, f1: number, dur: number, gain: number, type: OscillatorType = 'sine') => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0 * p, at); o.frequency.exponentialRampToValueAtTime(f1 * p, at + dur);
    g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(gain * k, at + 0.003); g.gain.exponentialRampToValueAtTime(0.0005, at + dur);
    o.connect(g).connect(out); o.start(at); o.stop(at + dur + 0.02);
  };
  const dur = run ? 0.75 : 1;
  if (surface === 'sand') { noise('lowpass', 900, 300, 0.7, 0.16 * dur, 0.32, 0.02); noise('bandpass', 1700, 900, 1.2, 0.08 * dur, 0.05, 0.015); }
  else if (surface === 'grass') { noise('bandpass', 2300, 1500, 0.9, 0.1 * dur, 0.18, 0.01); noise('highpass', 4800, 4800, 0.7, 0.04, 0.025); }
  else if (surface === 'stone') { noise('highpass', 2600, 2200, 0.8, 0.03, 0.16, 0.002); tone(1500, 900, 0.03, 0.03, 'triangle'); noise('bandpass', 900, 600, 1.4, 0.05, 0.12, 0.002); }
  else { tone(190, 120, 0.11 * dur, 0.32); noise('bandpass', 650, 420, 2.2, 0.07, 0.16, 0.002); tone(420, 300, 0.05, 0.05, 'triangle'); }
}

export function createWalkSound(prefs0: { muted: boolean; music: boolean }) {
  let ctx: AudioContext | null = null, muted = prefs0.muted, musicOn = prefs0.music;
  let master: GainNode | null = null, amb: GainNode | null = null, sfx: GainNode | null = null, steps: GainNode | null = null, music: GainNode | null = null, ducker: GainNode | null = null;
  let white: AudioBuffer | null = null;
  const layers = { sea: null as GainNode | null, murmur: null as GainNode | null, murmurPan: null as StereoPannerNode | null, wind: null as GainNode | null, windTone: null as BiquadFilterNode | null, crickets: null as GainNode | null };
  const AC = typeof window === 'undefined' ? undefined : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const gainNode = (v = 0) => { const g = ctx!.createGain(); g.gain.value = v; return g; };
  const filt = (type: BiquadFilterType, f: number, q = 0.7) => { const n = ctx!.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
  const loop = (buf: AudioBuffer) => { const s = ctx!.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };

  function ensure() {
    if (ctx || !AC) return ctx;
    try {
      ctx = new AC();
      master = gainNode(muted ? 0 : MASTER);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.2;
      master.connect(comp).connect(ctx.destination);
      ducker = gainNode(1);
      amb = gainNode(LEVEL.amb); sfx = gainNode(LEVEL.sfx); music = gainNode(musicOn ? LEVEL.music : 0);
      amb.connect(ducker).connect(master); music.connect(ducker); sfx.connect(master);
      // 脚步单独一路、轻一点（一秒三四声，响了很吵）
      steps = gainNode(LEVEL.steps); steps.connect(master);
      white = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const wd = white.getChannelData(0);
      for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
      const brown = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate), bd = brown.getChannelData(0);
      for (let i = 0, last = 0; i < bd.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; }
      // 海浪（首页那三层），离海越近越响
      layers.sea = gainNode(0); buildSea(ctx, layers.sea); layers.sea.connect(amb);
      // 人声：褐噪声过一个会慢慢摆动的带通（嗡嗡的说话声），再叠一点高频的碗碟声
      layers.murmur = gainNode(0);
      layers.murmurPan = 'createStereoPanner' in ctx ? ctx.createStereoPanner() : null;
      const voice = filt('bandpass', 460, 1.3), lfo = ctx.createOscillator(), lfoAmp = gainNode(160);
      lfo.frequency.value = 0.6; lfo.connect(lfoAmp).connect(voice.frequency); lfo.start();
      const murmurOut = layers.murmurPan ?? amb;
      layers.murmurPan?.connect(amb);
      loop(brown).connect(voice).connect(layers.murmur).connect(murmurOut);
      // 风：白噪声过带通，中心频率跟风大小走
      layers.wind = gainNode(0); layers.windTone = filt('bandpass', 520, 1.1);
      loop(white).connect(layers.windTone).connect(layers.wind).connect(amb);
      // 虫鸣：高音正弦被一快一慢两个方波门控（唧唧——唧唧）
      layers.crickets = gainNode(0);
      const chirp = ctx.createOscillator(), gate = ctx.createOscillator(), gate2 = ctx.createOscillator(), cg = gainNode(0), ga = gainNode(0.5), gb = gainNode(0.5);
      chirp.frequency.value = 4300; gate.type = 'square'; gate.frequency.value = 17; gate2.type = 'square'; gate2.frequency.value = 0.85;
      gate.connect(ga).connect(cg.gain); gate2.connect(gb).connect(cg.gain);
      chirp.connect(cg).connect(layers.crickets).connect(amb);
      for (const o of [chirp, gate, gate2]) o.start();
    } catch (e) { console.warn('[walk] 声音开不了', e); ctx = null; }
    return ctx;
  }
  const out = (bus: 'sfx' | 'amb' | 'music', pan = 0): AudioNode | null => {
    const b = bus === 'sfx' ? sfx : bus === 'amb' ? amb : music;
    if (!ctx || !b) return null;
    if (!pan || !('createStereoPanner' in ctx)) return b;
    const p = ctx.createStereoPanner(); p.pan.value = pan; p.connect(b); return p;
  };
  const tone = (at: number, f: number, dur: number, gain: number, type: OscillatorType = 'sine', f1 = f, bus: 'sfx' | 'amb' | 'music' = 'sfx', pan = 0, attack = 0.008) => {
    const dst = out(bus, pan);
    if (!ctx || !dst) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, at); if (f1 !== f) o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(gain, at + attack); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(dst); o.start(at); o.stop(at + dur + 0.03);
  };
  const hiss = (at: number, f: number, q: number, dur: number, gain: number, bus: 'sfx' | 'amb' = 'sfx', pan = 0, f1 = f) => {
    const dst = out(bus, pan);
    if (!ctx || !dst || !white) return;
    const s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = white; bp.type = 'bandpass'; bp.frequency.setValueAtTime(f, at); if (f1 !== f) bp.frequency.exponentialRampToValueAtTime(f1, at + dur); bp.Q.value = q;
    g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(gain, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    s.connect(bp).connect(g).connect(dst); s.start(at, Math.random() * 1.5); s.stop(at + dur + 0.03);
  };
  const now = () => (ctx ? ctx.currentTime + 0.01 : 0);
  const live = () => !!ctx && ctx.state === 'running';
  /** 说话、送达：环境和音乐让一下（0.25 秒压下去，hold 秒后 0.8 秒回来）。 */
  const duck = (hold = 1.2) => { if (!ctx || !ducker) return; const t = ctx.currentTime; ducker.gain.cancelScheduledValues(t); ducker.gain.setTargetAtTime(DUCK, t, 0.08); ducker.gain.setTargetAtTime(1, t + hold, 0.3); };

  // ---------- 环境 ----------
  let bedT = 0, gullT = 6 + Math.random() * 8, bedNight = 0;
  function bed(b: Bed, dt: number) {
    if (!live() || !ctx) return;
    bedT += dt;
    gullT -= dt;
    if (bedT < 0.1) return;
    bedT = 0;
    const t = ctx.currentTime;
    bedNight = b.night;
    layers.sea?.gain.setTargetAtTime(0.12 + b.coast * 0.7, t, 0.8);
    layers.murmur?.gain.setTargetAtTime(b.crowd.gain * 0.5, t, 0.5);
    layers.murmurPan?.pan.setTargetAtTime(b.crowd.pan, t, 0.3);
    layers.wind?.gain.setTargetAtTime(0.008 + b.wind * 0.05 + (b.moving ? 0.006 : 0), t, 0.6);
    layers.windTone?.frequency.setTargetAtTime(420 + b.wind * 420, t, 0.8);
    layers.crickets?.gain.setTargetAtTime(Math.max(0, b.night - 0.45) * 0.025 * (1 - b.coast * 0.7), t, 1.2);
    // 海鸥：白天、离海近，隔十几二十秒叫一串
    if (gullT <= 0) {
      gullT = 12 + Math.random() * 14;
      if (b.night < 0.4 && b.coast > 0.35) {
        const pan = Math.random() * 1.4 - 0.7, at = now() + 0.05;
        for (let k = 0; k < 3; k++) { const a = at + k * 0.24 + Math.random() * 0.05; tone(a, 1500 + Math.random() * 200, 0.2, 0.05 * b.coast, 'sawtooth', 950, 'amb', pan, 0.03); tone(a, 2250, 0.16, 0.02 * b.coast, 'sine', 1500, 'amb', pan, 0.03); }
      }
    }
    musicTick(b.hour);
  }

  // ---------- 音乐 ----------
  let beat = 0, nextAt = -1;
  const rnd = (() => { let s = 20261118; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; })();
  function musicTick(hour: number) {
    if (!ctx || !musicOn) { nextAt = -1; return; }
    const step = 60 / BPM / 2, t = ctx.currentTime;
    if (nextAt < t) nextAt = t + 0.1;
    const night = hour < 5.5 || hour >= 19.5, scale = night ? SCALE_NIGHT : SCALE_DAY, roots = night ? ROOTS_NIGHT : ROOTS_DAY, soft = night ? 0.75 : 1;
    while (nextAt < t + 0.5) {
      const at = nextAt, n = beat++, bar = Math.floor(n / 8), s = n % 8, root = roots[bar % roots.length];
      nextAt += step;
      // 小节头：一层长音（根音、五度、高八度）和一个低音
      if (s === 0) {
        for (const iv of [0, 7, 12]) tone(at, hz(root + iv - 12), step * 8.6, 0.022 * soft, 'sine', hz(root + iv - 12), 'music', 0, 0.9);
        tone(at, hz(root - 24), step * 3.5, 0.06 * soft, 'sine', hz(root - 24), 'music', 0, 0.03);
      }
      if (s === 4 && rnd() < 0.7) tone(at, hz(root - 24 + 7), step * 2.5, 0.04 * soft, 'sine', hz(root - 24 + 7), 'music', 0, 0.03);
      // 琶音：像木琴，按小节的根音在五声音阶里往上走，随机省掉几个（夜里更稀）
      if (rnd() < (night ? 0.38 : 0.55)) {
        const deg = Math.floor(rnd() * 6) + (s % 4 === 0 ? 0 : 1), semi = scale[Math.min(scale.length - 1, deg)] + (root >= -3 ? root : root + 12);
        tone(at, hz(semi), 0.55, 0.05 * soft, 'triangle', hz(semi), 'music', s % 2 ? 0.25 : -0.25, 0.004);
        tone(at, hz(semi + 12), 0.25, 0.012 * soft, 'sine', hz(semi + 12), 'music', 0, 0.004);
      }
    }
  }

  let stepLeft = false;
  const api = {
    /** 第一次用户手势时调（之后再调也无妨）。 */
    unlock() { const c = ensure(); if (c && c.state === 'suspended' && !document.hidden) c.resume().catch((e) => console.warn('[walk] 声音恢复失败', e)); },
    pause() { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); },
    get muted() { return muted; },
    setMuted(m: boolean) { muted = m; if (master && ctx) master.gain.setTargetAtTime(m ? 0 : MASTER, ctx.currentTime, 0.05); },
    get music() { return musicOn; },
    setMusic(on: boolean) { musicOn = on; if (music && ctx) music.gain.setTargetAtTime(on ? LEVEL.music : 0, ctx.currentTime, 0.3); },
    /** 总线增益（验收：静音时为 0）、音乐那一路的增益。 */
    get level() { return master?.gain.value ?? (muted ? 0 : MASTER); },
    get musicLevel() { return music?.gain.value ?? (musicOn ? LEVEL.music : 0); },
    get state() { return ctx?.state ?? 'none'; },
    /** 每帧：环境声跟上少年在哪、几点；音乐往前排半秒。 */
    bed,
    /** 落一次脚。 */
    step(surface: Surface, run: boolean) { if (!live() || !ctx || !steps || !white) return; stepLeft = !stepLeft; footstep(ctx, steps, white, now(), surface, run, stepLeft); },
    talk(voice: Voice) { const t = now(), f = PITCH[voice] ?? 523; if (!live()) return; duck(1.0); tone(t, f, 0.09, 0.16, 'triangle'); tone(t + 0.1, f * 1.25, 0.08, 0.12, 'triangle'); if (voice === 'kid') tone(t + 0.19, f * 1.5, 0.08, 0.1, 'triangle'); },
    deliver() { const t = now(); if (!live()) return; duck(2.2); [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.09, f, 0.4, 0.17, 'triangle')); tone(t + 0.36, 2093, 0.7, 0.04, 'sine'); tone(t, 131, 0.6, 0.08, 'sine'); },
    paper() { const t = now(); if (!live()) return; hiss(t, 3200, 0.8, 0.12, 0.2); hiss(t + 0.1, 2400, 0.7, 0.2, 0.16, 'sfx', 0, 1500); },
    tick() { const t = now(); if (!live()) return; tone(t, 2200, 0.025, 0.08, 'square', 1800); },
    bag() { const t = now(); if (!live()) return; tone(t, 160, 0.18, 0.3, 'sine', 90); hiss(t, 900, 1, 0.12, 0.1); },
    /** 进了一个新地方：一声很轻的木琴（两个音，五度）。 */
    zone() { const t = now(); if (!live()) return; const n = bedNight > 0.5 ? [0, 7] : [7, 12]; n.forEach((s, i) => { tone(t + i * 0.14, hz(s + 12), 0.7, 0.06, 'triangle'); tone(t + i * 0.14, hz(s + 24), 0.3, 0.015, 'sine'); }); },
    /** 打开面板、点按钮：一声很轻的「嗒」。 */
    ui() { const t = now(); if (!live()) return; tone(t, 1300, 0.05, 0.05, 'triangle', 1000); },
  };
  return api;
}
export type WalkSound = ReturnType<typeof createWalkSound>;
