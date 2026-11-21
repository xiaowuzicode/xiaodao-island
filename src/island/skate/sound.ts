/**
 * 声音：全部用 WebAudio 现场合成，不下载音频。
 * 先有一张小调音台：总线分成 环境 / 滑板 / 收集 / 岛上 / 音乐 五路，各有音量；收集和提示音响的时候环境和滑板轻轻让一下；
 * 总输出过一个温和的压限，不会爆音。轮子滚动只是一层很轻的底（比金币声低二十多分贝），不是主角。
 * 所有声音都按「第几秒响」排进去：实时游玩用现在的时间，自动巡游照事件表排，离线渲染（量响度）用同一套代码。
 */
import { build as buildSea } from '@/island/ambient';
import { laneAt } from '@/island/market-plan';
import type { Plan, Surface } from '@/island/skate/plan';
import type { Route } from '@/island/skate/route';
import type { Ev, Snap } from '@/island/skate/sim';
import { RULES } from '@/island/skate/sim';
import * as THREE from 'three';

export type Bus = 'ambience' | 'board' | 'pickups' | 'world' | 'music';
export const BUSES: Bus[] = ['ambience', 'board', 'pickups', 'world', 'music'];
/** 各路的默认音量。 */
const LEVEL: Record<Bus, number> = { ambience: 0.42, board: 0.5, pickups: 0.62, world: 0.5, music: 0.34 };
/** 总音量（进压限之前）。整体响度定在 −17 LUFS 上下，网页游戏常见的水平。 */
const MASTER = 2.0;
/** 收集、提示音响起时，环境和滑板压到多少、多久回来（秒）。 */
const DUCK = { to: 0.6, hold: 0.22, back: 0.35 } as const;
/** 金币的音阶（C 大调五声，相对 C5 的半音数）：连着收一路往上，断了落回主音。 */
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
/** 九支彩铅各自的两个音（相对 C5 的半音数），顺序同 plan.STOPS。 */
const MOTIFS: [number, number][] = [[7, 12], [0, 7], [4, 9], [9, 16], [2, 7], [12, 16], [5, 12], [7, 14], [0, 12]];
const C5 = 523.25, hz = (semi: number) => C5 * 2 ** (semi / 12);
/** 音乐：四小节一轮的和弦（根音、三音、五音，相对 C4 的半音数），傍晚的小岛用 C–Am–F–G。 */
const CHORDS = [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]];
const BPM = 96;

/** 岛上会响的固定位置。 */
export const PLACES_XZ = { market: laneAt(5, 0), press: [-3, 13.6], cinema: [12, 8], lighthouse: [30, 0] } as const;
/** 听的人在 (lx, lz)、面朝 heading（atan2(dx, dz)）；声源在 (x, z)：返回左右声像和随距离的衰减。 */
export function spatial(lx: number, lz: number, heading: number, x: number, z: number, ref = 7) {
  const dx = x - lx, dz = z - lz, d = Math.hypot(dx, dz), a = Math.atan2(dx, dz) - heading;
  return { pan: Math.max(-1, Math.min(1, -Math.sin(a) * Math.min(1, d / 4))), gain: ref / (ref + d * d * 0.12) };
}

export interface Bed { speed: number; grounded: boolean; surface: Surface; carve: number; coast: number; night: number; market: { pan: number; gain: number }; cinema: { pan: number; gain: number }; boost: boolean;
  /** 骑在龙背上 0–1：风声变成一股低低的、呼呼往后灌的气流。 */
  rush?: number }
const P = new THREE.Vector3(), D = new THREE.Vector3();
/** 由某一刻的快照算出各层底噪该多大（实时和离线渲染共用）。coast：离海多近 0–1。 */
export function bedFor(route: Route, plan: Plan, p: Snap, night: number, coast: number, nominal: number): Bed {
  route.at(p.s, P, D);
  const h = Math.atan2(D.x, D.z);
  return {
    speed: p.f >= 0 ? 1.6 : p.v / nominal, grounded: !p.air && p.f < 0, surface: plan.surface(p.s), carve: Math.min(1, Math.abs(p.xv) * 0.5 + Math.abs(route.curve(p.s)) * p.v * 0.5), coast, night,
    market: spatial(P.x, P.z, h, PLACES_XZ.market[0], PLACES_XZ.market[1], 9), cinema: spatial(P.x, P.z, h, PLACES_XZ.cinema[0], PLACES_XZ.cinema[1], 6), boost: p.boost,
    rush: p.f >= 0 ? plan.dragon.riding(p.f) : 0,
  };
}

/** 在一个声音上下文上搭调音台和所有的声音。only：只留某一路或某一样（量响度时单独渲染用）。 */
export function createMix(ctx: BaseAudioContext, opts: { music: boolean; only?: Bus | 'roll' | 'coins' } = { music: true }) {
  const master = ctx.createGain(), limiter = ctx.createDynamicsCompressor();
  master.gain.value = MASTER;
  limiter.threshold.value = -11; limiter.knee.value = 6; limiter.ratio.value = 12; limiter.attack.value = 0.003; limiter.release.value = 0.16;
  // 压限后面再垫一层软削波：不管多少声音叠在一起，输出都不超过 −1 dB
  const ceiling = ctx.createWaveShaper(), curve = new Float32Array(2049), TOP = 0.88;
  for (let i = 0; i < curve.length; i++) { const x = (i / 1024 - 1) * 2; curve[i] = TOP * Math.tanh(x / TOP); }
  ceiling.curve = curve;
  const trim = ctx.createGain();
  trim.gain.value = 0.5; // 波形整形器的输入范围是 ±1，这里把 ±2 映进去（曲线按 ±2 画的）
  master.connect(limiter).connect(trim).connect(ceiling).connect(ctx.destination);
  const solo = opts.only, on = (b: Bus) => !solo || solo === b || (solo === 'roll' && b === 'board') || (solo === 'coins' && b === 'pickups');
  const bus = {} as Record<Bus, GainNode>, duckers = {} as Record<Bus, GainNode>;
  for (const b of BUSES) {
    bus[b] = ctx.createGain();
    duckers[b] = ctx.createGain();
    bus[b].gain.value = on(b) && (b !== 'music' || opts.music) ? LEVEL[b] : 0;
    bus[b].connect(duckers[b]).connect(master);
  }
  const white = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), wd = white.getChannelData(0);
  for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
  const brown = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate), bd = brown.getChannelData(0);
  for (let i = 0, last = 0; i < bd.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; }

  const out = (b: Bus, pan = 0) => {
    if (!pan || !('createStereoPanner' in ctx)) return bus[b];
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(bus[b]);
    return p;
  };
  /** 一个音：从 f0 滑到 f1，快起慢落。 */
  function tone(at: number, b: Bus, f0: number, f1: number, dur: number, gain: number, type: OscillatorType = 'sine', pan = 0, attack = 0.004) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(gain, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0006, at + dur);
    o.connect(g).connect(out(b, pan));
    o.start(at);
    o.stop(at + dur + 0.03);
  }
  /** 一小段过了滤波的噪声（啪、咚、唰都靠它）。 */
  function hiss(at: number, b: Bus, kind: BiquadFilterType, f0: number, f1: number, q: number, dur: number, gain: number, pan = 0, attack = 0.003) {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = white;
    f.type = kind; f.Q.value = q;
    f.frequency.setValueAtTime(f0, at);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), at + dur);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(gain, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0006, at + dur);
    src.connect(f).connect(g).connect(out(b, pan));
    src.start(at, Math.random() * 1.5);
    src.stop(at + dur + 0.03);
  }
  /** 收集和提示音响的时候，让环境和滑板轻一点。 */
  function duck(at: number) {
    for (const b of ['ambience', 'board'] as Bus[]) {
      const g = duckers[b].gain;
      g.setTargetAtTime(DUCK.to, at, 0.02);
      g.setTargetAtTime(1, at + DUCK.hold, DUCK.back / 3);
    }
  }
  const loop = (buf: AudioBuffer) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
  const filt = (type: BiquadFilterType, f: number, q = 0.7) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
  const gainNode = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };

  // ---------- 一直在的几层 ----------
  // 轮子：低沉的「身子」（褐噪声过低通）加一点点路面的沙沙（带通），都很轻
  const rollBody = gainNode(), rollGrit = gainNode(), rollTone = filt('lowpass', 300, 0.6), gritTone = filt('bandpass', 1400, 0.9);
  const rollOut = solo === 'coins' ? gainNode(0) : bus.board;
  loop(brown).connect(rollTone).connect(rollBody).connect(rollOut);
  loop(white).connect(gritTone).connect(rollGrit).connect(rollOut);
  const others = solo === 'roll' || solo === 'coins' ? gainNode(0) : null;
  const to = (b: Bus) => others ?? bus[b];
  // 海浪（复用首页那套三层合成）、风（跟速度）、蛐蛐（天擦黑才有）
  const sea = gainNode(), wind = gainNode(), windTone = filt('bandpass', 520, 1.1), crickets = gainNode();
  // 骑龙的气流：褐噪声过低通、慢慢起伏（一阵一阵往后灌），只在龙背上才有
  const rush = gainNode(), rushTone = filt('lowpass', 420, 0.8), rushLfo = ctx.createOscillator(), rushLfoAmp = gainNode(160);
  rushLfo.frequency.value = 0.37; rushLfo.connect(rushLfoAmp).connect(rushTone.frequency); rushLfo.start();
  loop(brown).connect(rushTone).connect(rush).connect(to('ambience'));
  buildSea(ctx, sea);
  sea.connect(to('ambience'));
  loop(white).connect(windTone).connect(wind).connect(to('ambience'));
  const chirp = ctx.createOscillator(), chirpGate = gainNode(), gate = ctx.createOscillator(), gate2 = ctx.createOscillator(), gateAmp = gainNode(0.5), gate2Amp = gainNode(0.5);
  chirp.frequency.value = 4300; gate.type = 'square'; gate.frequency.value = 17; gate2.type = 'square'; gate2.frequency.value = 0.9;
  gate.connect(gateAmp).connect(chirpGate.gain); gate2.connect(gate2Amp).connect(chirpGate.gain);
  chirp.connect(chirpGate).connect(crickets).connect(to('ambience'));
  for (const o of [chirp, gate, gate2]) o.start();
  // 夜市：一层嗡嗡的人声（褐噪声过带通、慢慢起伏）和铁板的滋滋声；放映台：放映机的哒哒声
  const marketPan = 'createStereoPanner' in ctx ? ctx.createStereoPanner() : null, cinemaPan = 'createStereoPanner' in ctx ? ctx.createStereoPanner() : null;
  const murmur = gainNode(), sizzle = gainNode(), flutter = gainNode(), flutterGate = gainNode(), tick = ctx.createOscillator(), tickAmp = gainNode(0.5);
  const marketOut = marketPan ?? to('world'), cinemaOut = cinemaPan ?? to('world');
  marketPan?.connect(to('world')); cinemaPan?.connect(to('world'));
  const voice = filt('bandpass', 420, 1.4), lfo = ctx.createOscillator(), lfoAmp = gainNode(140);
  lfo.frequency.value = 0.7; lfo.connect(lfoAmp).connect(voice.frequency); lfo.start();
  loop(brown).connect(voice).connect(murmur).connect(marketOut);
  loop(white).connect(filt('highpass', 5200)).connect(sizzle).connect(marketOut);
  tick.type = 'square'; tick.frequency.value = 18; tick.connect(tickAmp).connect(flutterGate.gain); tick.start();
  loop(white).connect(filt('bandpass', 1900, 2.5)).connect(flutterGate).connect(flutter).connect(cinemaOut);

  const sfx = {
    // ----- 滑板和人 -----
    push(at: number) { hiss(at, 'board', 'bandpass', 500, 220, 0.8, 0.28, 0.22, 0, 0.03); tone(at, 'board', 95, 60, 0.18, 0.2); },
    ollie(at: number) { hiss(at, 'board', 'highpass', 2600, 2600, 0.7, 0.035, 0.5); tone(at, 'board', 190, 120, 0.06, 0.3, 'triangle'); hiss(at + 0.02, 'board', 'bandpass', 700, 1700, 0.9, 0.22, 0.14, 0, 0.05); },
    land(at: number, height: number) { const k = Math.min(1, 0.35 + height * 0.6); tone(at, 'board', 120, 52, 0.16, 0.5 * k); hiss(at, 'board', 'lowpass', 600, 160, 0.7, 0.14, 0.45 * k); hiss(at + 0.01, 'board', 'highpass', 3000, 3000, 0.7, 0.03, 0.18 * k); },
    flip(at: number) { hiss(at, 'board', 'bandpass', 1500, 3600, 2.2, 0.16, 0.2); tone(at, 'board', 620, 940, 0.1, 0.08, 'triangle'); },
    trick(at: number) { duck(at); for (const [i, s] of [12, 16, 19].entries()) tone(at + i * 0.05, 'pickups', hz(s), hz(s), 0.25, 0.1, 'triangle'); },
    stumble(at: number) { for (let i = 0; i < 4; i++) hiss(at + i * 0.055 + Math.random() * 0.02, 'board', 'bandpass', 900 + i * 300, 500, 2.5, 0.07, 0.4 - i * 0.07); tone(at, 'board', 150, 70, 0.22, 0.35, 'sawtooth'); },
    duck(at: number) { hiss(at, 'board', 'bandpass', 900, 380, 0.7, 0.25, 0.12, 0, 0.06); },
    lane(at: number, dir: number) { hiss(at, 'board', 'bandpass', 1600, 700, 1.6, 0.13, 0.07, dir * 0.3, 0.02); },
    /** 路面的小声响：栈桥木板的咔哒、铺地的接缝、木坡的空响。 */
    seam(at: number, surface: Surface) {
      if (solo === 'coins') return;
      if (surface === 'pier') { tone(at, 'board', 150, 105, 0.07, 0.07, 'triangle'); hiss(at, 'board', 'bandpass', 800, 800, 3, 0.03, 0.035); }
      else if (surface === 'ramp') tone(at, 'board', 115, 85, 0.09, 0.07, 'sine');
      else if (surface === 'paving') hiss(at, 'board', 'bandpass', 2300, 2300, 4, 0.025, 0.025);
    },
    // ----- 收集 -----
    coin(at: number, streak: number) {
      duck(at);
      const f = hz(SCALE[Math.max(0, streak - 1) % SCALE.length] + (Math.floor(Math.max(0, streak - 1) / SCALE.length) % 2) * 0);
      tone(at, 'pickups', f, f, 0.26, 0.2); tone(at, 'pickups', f * 2, f * 2, 0.14, 0.07); tone(at, 'pickups', f * 3, f * 3, 0.07, 0.03);
    },
    coinBreak(at: number) { tone(at, 'pickups', hz(4), hz(0), 0.22, 0.07, 'triangle'); },
    pencil(at: number, i: number) {
      duck(at);
      const [a, b] = MOTIFS[i % MOTIFS.length];
      tone(at, 'pickups', hz(a), hz(a), 0.3, 0.2, 'triangle'); tone(at + 0.13, 'pickups', hz(b), hz(b), 0.6, 0.22, 'triangle');
      for (let k = 0; k < 6; k++) tone(at + 0.2 + k * 0.05, 'pickups', hz(b + 12 + (k % 3) * 4), hz(b + 12 + (k % 3) * 4), 0.18, 0.035); // 一小串亮晶晶
    },
    item(at: number, kind: string) {
      duck(at);
      if (kind === 'magnet') { tone(at, 'pickups', 110, 220, 0.7, 0.16, 'sawtooth', 0, 0.3); tone(at, 'pickups', 112, 226, 0.7, 0.12, 'sawtooth', 0, 0.3); }
      else if (kind === 'shield') { tone(at, 'pickups', 180, 420, 0.09, 0.3); tone(at + 0.08, 'pickups', 420, 250, 0.16, 0.22); hiss(at, 'pickups', 'lowpass', 900, 300, 1, 0.12, 0.2); }
      else if (kind === 'star') for (let k = 0; k < 7; k++) tone(at + k * 0.045, 'pickups', hz(12 + SCALE[(k * 2) % 6]), hz(12 + SCALE[(k * 2) % 6]), 0.22, 0.07);
    },
    boost(at: number) { duck(at); hiss(at, 'pickups', 'bandpass', 400, 3200, 1.2, 0.55, 0.26, 0, 0.3); tone(at, 'pickups', 160, 520, 0.5, 0.12, 'sawtooth', 0, 0.2); hiss(at + 0.5, 'pickups', 'bandpass', 3000, 500, 1, 0.5, 0.14, 0, 0.02); },
    spring(at: number) { duck(at); tone(at, 'pickups', 150, 680, 0.2, 0.3); tone(at + 0.05, 'pickups', 300, 1100, 0.28, 0.12, 'triangle'); tone(at + 0.2, 'pickups', 680, 430, 0.3, 0.1); },
    itemTick(at: number) { tone(at, 'pickups', 1250, 1250, 0.04, 0.05, 'square'); },
    itemEnd(at: number) { tone(at, 'pickups', 520, 300, 0.2, 0.08, 'triangle'); },
    shieldPop(at: number) { duck(at); tone(at, 'pickups', 360, 130, 0.2, 0.3); hiss(at, 'pickups', 'lowpass', 1400, 300, 1, 0.16, 0.3); },
    clear(at: number) { tone(at, 'pickups', hz(19), hz(19), 0.35, 0.09); tone(at, 'pickups', hz(26), hz(26), 0.25, 0.05); },
    // ----- 飞行 -----
    /** 长出翅膀：一声往上的呼，接一串上行的音。 */
    /** 蹬地起飞：一阵往上卷的风。 */
    takeoff(at: number) { hiss(at, 'board', 'bandpass', 420, 3000, 1.1, 0.8, 0.28, 0, 0.35); hiss(at + 0.05, 'pickups', 'bandpass', 900, 5200, 0.8, 0.7, 0.16, 0, 0.3); },
    wings(at: number) { duck(at); hiss(at, 'pickups', 'bandpass', 300, 2600, 0.9, 0.9, 0.3, 0, 0.5); for (const [i, n] of [0, 4, 7, 12, 16, 19, 24].entries()) tone(at + 0.15 + i * 0.07, 'pickups', hz(n), hz(n), 0.5, 0.11, 'triangle'); },
    /** 穿过金币环：两个音叠成一个和声，连着穿音越高。 */
    ring(at: number, streak: number) { duck(at); const n = SCALE[Math.floor(streak / 6) % SCALE.length]; tone(at, 'pickups', hz(n), hz(n), 0.5, 0.17); tone(at, 'pickups', hz(n + 7), hz(n + 7), 0.5, 0.12); tone(at + 0.06, 'pickups', hz(n + 12), hz(n + 12), 0.35, 0.07, 'triangle'); },
    bounce(at: number) { tone(at, 'pickups', 180, 520, 0.22, 0.2); tone(at + 0.03, 'pickups', 360, 760, 0.25, 0.08, 'triangle'); hiss(at, 'pickups', 'lowpass', 900, 300, 0.7, 0.2, 0.12); },
    /** 落回跑道、收翅膀。 */
    /** 钻进云顶：一阵往上卷、越来越亮的风，出了云顶散开。 */
    cloud(at: number) { hiss(at, 'ambience', 'bandpass', 260, 1900, 0.75, 3.6, 0.3, 0, 1.9); hiss(at + 1.2, 'ambience', 'highpass', 2200, 5200, 0.7, 2.4, 0.06, 0, 1.1); },
    /** 龙叫：低低的一声长吟（两根锯齿波过低通、带一点颤音），下面垫一口气声。far：远处（挑战里游过去那一下）更轻、更闷。 */
    dragon(at: number, gain = 1, pan = 0, far = false) {
      if (solo && solo !== 'world') return;
      const lp = ctx.createBiquadFilter(), g = ctx.createGain(), vib = ctx.createOscillator(), vibAmp = ctx.createGain();
      lp.type = 'lowpass'; lp.Q.value = 3.2;
      lp.frequency.setValueAtTime(far ? 260 : 360, at); lp.frequency.linearRampToValueAtTime(far ? 520 : 900, at + 0.5); lp.frequency.exponentialRampToValueAtTime(far ? 220 : 280, at + 2.2);
      vib.frequency.value = 5.2; vibAmp.gain.value = 2.2; vib.connect(vibAmp);
      g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(0.075 * gain, at + 0.35); g.gain.setTargetAtTime(0.052 * gain, at + 0.5, 0.3); g.gain.exponentialRampToValueAtTime(0.0006, at + 2.4);
      for (const [f0, f1] of [[98, 74], [99.4, 75.2], [147, 112]]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, at); o.frequency.linearRampToValueAtTime(f0 * 1.06, at + 0.45); o.frequency.exponentialRampToValueAtTime(f1, at + 2.3);
        vibAmp.connect(o.frequency); o.connect(lp); o.start(at); o.stop(at + 2.5);
      }
      vib.start(at); vib.stop(at + 2.5);
      lp.connect(g).connect(out('world', pan));
      hiss(at + 0.05, 'world', 'bandpass', 380, 260, 1.4, 1.8, 0.05 * gain, pan, 0.4);
    },
    /** 落到龙背上：板子踩实的一声，接一个暖暖的和弦。 */
    board(at: number) { duck(at); tone(at, 'board', 110, 58, 0.22, 0.26); hiss(at, 'board', 'lowpass', 700, 180, 0.7, 0.2, 0.2); for (const [i, n] of [0, 7, 12, 16].entries()) tone(at + 0.12 + i * 0.06, 'pickups', hz(n - 12), hz(n - 12), 0.9, 0.06, 'triangle', 0, 0.02); },
    /** 俯冲：风一下子从低往高刮过去。 */
    dive(at: number) { hiss(at, 'ambience', 'bandpass', 220, 2600, 0.9, 1.9, 0.28, 0, 0.7); },
    touchdown(at: number) { hiss(at, 'board', 'bandpass', 1800, 400, 0.8, 0.5, 0.2, 0, 0.02); for (const [i, n] of [12, 7, 0].entries()) tone(at + 0.1 + i * 0.09, 'pickups', hz(n), hz(n), 0.4, 0.09, 'triangle'); },
    // ----- 岛上 -----
    hurdleFall(at: number, pan = 0) { hiss(at, 'world', 'bandpass', 1300, 700, 3, 0.06, 0.45, pan); tone(at + 0.12, 'world', 240, 140, 0.09, 0.2, 'triangle', pan); hiss(at + 0.2, 'world', 'bandpass', 900, 500, 2, 0.08, 0.25, pan); },
    crateKnock(at: number, pan = 0) { tone(at, 'world', 130, 70, 0.14, 0.45, 'triangle', pan); hiss(at, 'world', 'lowpass', 700, 250, 1, 0.12, 0.35, pan); tone(at + 0.16, 'world', 100, 60, 0.12, 0.25, 'triangle', pan); },
    splash(at: number) { hiss(at, 'world', 'bandpass', 1800, 500, 0.8, 0.4, 0.4, 0, 0.01); hiss(at + 0.05, 'world', 'highpass', 4000, 4000, 0.7, 0.3, 0.12); },
    gullCry(at: number, pan = 0) { for (let k = 0; k < 3; k++) { const t = at + k * 0.24 + Math.random() * 0.05; tone(t, 'world', 1500 + Math.random() * 200, 950, 0.2, 0.09, 'sawtooth', pan, 0.03); tone(t, 'world', 2250, 1500, 0.16, 0.035, 'sine', pan, 0.03); } },
    /** 岛民打招呼：一声短短的「嘿」，没有词。 */
    greet(at: number, pan = 0, gain = 1, pitch = 1) { tone(at, 'world', 300 * pitch, 420 * pitch, 0.1, 0.13 * gain, 'triangle', pan, 0.02); tone(at + 0.07, 'world', 420 * pitch, 330 * pitch, 0.18, 0.11 * gain, 'triangle', pan, 0.02); },
    bell(at: number, pan = 0, gain = 1) { for (const [m, g] of [[1, 0.2], [2.76, 0.09], [5.4, 0.05]]) tone(at, 'world', 880 * m, 880 * m, 1.6 / m ** 0.5, g * gain, 'sine', pan, 0.002); },
    horn(at: number) { tone(at, 'world', 98, 98, 2.2, 0.1, 'sawtooth', -0.4, 0.3); tone(at, 'world', 147, 147, 2.2, 0.06, 'sawtooth', -0.4, 0.3); },
    whoom(at: number, pan = 0, gain = 1) { tone(at, 'world', 70, 48, 1.4, 0.2 * gain, 'sine', pan, 0.4); hiss(at, 'world', 'lowpass', 300, 120, 0.7, 1.2, 0.07 * gain, pan, 0.4); },
    // ----- 提示音（走音乐那一路的音色，但不受音乐开关影响：接在收集上） -----
    sting(at: number, kind: 'start' | 'landmark' | 'all' | 'S' | 'A' | 'B' | 'C') {
      duck(at);
      const notes: Record<typeof kind, number[]> = { start: [0, 7, 12], landmark: [7, 12], all: [0, 4, 7, 12, 16, 19, 24], S: [0, 4, 7, 12, 16, 24], A: [0, 4, 7, 12], B: [0, 4, 7], C: [4, 0] };
      const soft = kind === 'landmark';
      notes[kind].forEach((s, i) => tone(at + i * (soft ? 0.14 : 0.1), 'pickups', hz(s - 12), hz(s - 12), soft ? 0.7 : 0.6, soft ? 0.07 : 0.12, 'triangle', 0, 0.01));
    },
  };

  /** 把一件事变成声音（实时、自动巡游、离线渲染都走这里）。pan：发生在左边还是右边。 */
  function play(e: Ev, at: number, plan: Plan, pan = 0) {
    if (solo === 'roll') return;
    if (solo === 'coins' && e.type !== 'coin') return;
    switch (e.type) {
      case 'start': sfx.push(at); sfx.sting(at + 0.05, 'start'); break;
      case 'jump': sfx.ollie(at); break;
      case 'land': sfx.land(at, e.k ?? 0.5); break;
      case 'flip': sfx.flip(at); break;
      case 'trick': sfx.trick(at); break;
      case 'duck': sfx.duck(at); break;
      case 'lane': sfx.lane(at, e.k ?? 0); break;
      case 'coin': sfx.coin(at, e.k ?? 1); break;
      case 'coinMiss': sfx.coinBreak(at); break;
      case 'pencil': sfx.pencil(at, plan.stops.findIndex((s) => s.id === plan.pencils[e.i ?? 0]?.stop)); break;
      case 'allPencils': sfx.sting(at + 0.5, 'all'); break;
      case 'item': sfx.item(at, e.kind ?? ''); break;
      case 'itemTick': sfx.itemTick(at); break;
      case 'itemEnd': sfx.itemEnd(at); break;
      case 'boost': sfx.boost(at); break;
      case 'spring': sfx.spring(at); break;
      case 'shield': sfx.shieldPop(at); (e.kind === 'crate' ? sfx.crateKnock : sfx.hurdleFall)(at, pan); break;
      case 'hit': sfx.stumble(at); if (e.kind === 'crate') sfx.crateKnock(at, pan); else if (e.kind === 'gull') sfx.gullCry(at, pan); else sfx.hurdleFall(at, pan); break;
      case 'clear': sfx.clear(at); break;
      case 'slide': sfx.splash(at); break;
      case 'gulls': sfx.gullCry(at, pan); break;
      case 'wings': sfx.wings(at); sfx.gullCry(at + 1.6, 0.5); break;
      case 'takeoff': sfx.takeoff(at); break;
      case 'ring': sfx.ring(at, e.k ?? 6); break;
      case 'bounce': sfx.bounce(at); break;
      case 'touchdown': sfx.touchdown(at); break;
      case 'cloud': sfx.cloud(at); break;
      case 'dragon': sfx.dragon(at, plan.dragon.kind === 'ride' ? 1 : 0.55, pan, plan.dragon.kind !== 'ride'); break;
      case 'board': sfx.board(at); break;
      case 'dive': sfx.dive(at); break;
      case 'hop': sfx.ollie(at); sfx.dragon(at + 0.5, 0.7, 0.4); break;
      // 龙环：连着穿，音一个比一个高；错过一个只是断了
      case 'dring': sfx.ring(at, (e.k ?? 1) * 6); if (e.kind !== 'ring') sfx.clear(at + 0.08); break;
      case 'dmiss': sfx.coinBreak(at); break;
      case 'stop': {
        const id = plan.stops[e.i ?? 0]?.id;
        sfx.sting(at, 'landmark');
        if (id === 'press') sfx.bell(at + 0.6, pan, 0.8);
        if (id === 'next' || id === 'pencil') sfx.horn(at + 1.2);
        if (id === 'lighthouse') sfx.whoom(at + 0.8, pan);
        break;
      }
      default: break;
    }
  }

  /** 音乐：马林巴似的分解和弦、一层长音、低音，连击高了加一层高八度和沙锤；刚踉跄过就只剩长音。 */
  let musicBeat = 0, musicNext = -1;
  function music(from: number, until: number, t0: number, info: (t: number) => { combo: number; hurt: boolean; speed: number; fly?: boolean; dragon?: boolean }) {
    if (!opts.music || (solo && solo !== 'music')) return;
    if (musicNext < 0) musicNext = t0;
    while (musicNext < until) {
      const at = musicNext, n = musicBeat++, k = info(at - t0);
      // 速度松松地带着节拍走：骑得快（加速带）拍子快一点，踉跄时慢下来
      const beat = 60 / (BPM * (0.9 + 0.1 * Math.min(1.5, Math.max(0.5, k.speed)))) / 2; // 八分音符
      musicNext += beat;
      if (at < from - 0.05) continue;
      const chord = CHORDS[Math.floor(n / 8) % CHORDS.length], step = n % 8;
      if (step === 0) { for (const s of chord) tone(at, 'music', hz(s - 12), hz(s - 12), beat * 8.5, 0.05, 'sine', 0, 0.5); tone(at, 'music', hz(chord[0] - 24), hz(chord[0] - 24), beat * 3.5, 0.12, 'sine', 0, 0.02); }
      // 飞起来：长音升一个八度，多一层高高的分解和弦——音乐「抬」起来
      if (k.fly) { if (step === 0) for (const sm of chord) tone(at, 'music', hz(sm), hz(sm), beat * 8.5, 0.04, 'sine', 0, 0.4); tone(at, 'music', hz(chord[[2, 1, 0, 1, 2, 0, 1, 2][step]] + 12), hz(chord[[2, 1, 0, 1, 2, 0, 1, 2][step]] + 12), 0.4, 0.07, 'triangle', step % 2 ? -0.3 : 0.3, 0.003); }
      // 骑在龙背上：再抬一层——低音沉一个八度的长音托着，上面一条慢慢走的五声音阶旋律（C D E G A），一小节两个音
      if (k.dragon) {
        if (step === 0) tone(at, 'music', hz(chord[0] - 36), hz(chord[0] - 36), beat * 8.5, 0.07, 'sine', 0, 0.6);
        if (step % 4 === 0) { const MEL = [12, 14, 16, 19, 21, 19, 16, 14, 12, 9, 12, 16, 19, 21, 24, 21], m = MEL[Math.floor(n / 4) % MEL.length]; tone(at, 'music', hz(m), hz(m), beat * 3.6, 0.055, 'triangle', 0, 0.06); tone(at, 'music', hz(m + 12), hz(m + 12), beat * 2.4, 0.018, 'sine', 0, 0.06); }
      }
      if (k.hurt) continue;
      const arp = [0, 1, 2, 1, 0, 2, 1, 2][step];
      tone(at, 'music', hz(chord[arp]), hz(chord[arp]), 0.32, 0.09, 'sine', step % 2 ? 0.25 : -0.25, 0.003);
      if (step === 4) tone(at, 'music', hz(chord[0] - 24), hz(chord[0] - 24), beat * 2, 0.08);
      if (k.combo >= 10 && step % 2 === 0) tone(at, 'music', hz(chord[(arp + 1) % 3] + 12), hz(chord[(arp + 1) % 3] + 12), 0.2, 0.045, 'triangle', 0.4);
      if (k.combo >= 20 || k.speed > 1.25) hiss(at, 'music', 'highpass', 6500, 6500, 0.7, 0.035, step % 2 ? 0.02 : 0.035);
    }
  }

  let lastSeam = 0, lastWhoom = -99;
  /** 各层底噪跟上现在的状态。at：上下文时间；s：骑到第几米（算木板、接缝的节奏）；rideT：这一圈第几秒。 */
  function bed(at: number, b: Bed, s: number, rideT: number, lighthouse: { pan: number; gain: number }) {
    const v = Math.min(1.6, b.speed), g = b.grounded ? 1 : 0, tc = 0.07;
    // 每种地面一个音色：沙发闷、塑胶跑道顺滑、铺地带一点颗粒、木头空一些
    const tone4: Record<Surface, [number, number, number, number]> = {
      sand: [190, 0.026, 700, 0.002], track: [330, 0.022, 1500, 0.002], paving: [420, 0.026, 2300, 0.006], grass: [200, 0.02, 800, 0.003], pier: [260, 0.03, 1100, 0.003], ramp: [230, 0.032, 900, 0.0025],
    };
    const [bodyHz, bodyGain, gritHz, gritGain] = tone4[b.surface];
    rollTone.frequency.setTargetAtTime(bodyHz * (0.7 + v * 0.5), at, 0.1);
    rollBody.gain.setTargetAtTime(g * bodyGain * (0.3 + v * 0.7), at, tc);
    gritTone.frequency.setTargetAtTime(gritHz * (0.8 + v * 0.3), at, 0.1);
    rollGrit.gain.setTargetAtTime(g * (gritGain * v + b.carve * 0.02), at, tc); // 压弯时多一点刮擦
    const every = b.surface === 'pier' ? 1.3 : b.surface === 'paving' ? 2.1 : b.surface === 'ramp' ? 0.9 : 0;
    if (every && g && Math.floor(s / every) !== Math.floor(lastSeam / every)) sfx.seam(at, b.surface);
    lastSeam = s;
    sea.gain.setTargetAtTime(0.1 + b.coast * 0.55, at, 0.7);
    const r = b.rush ?? 0;
    wind.gain.setTargetAtTime((0.012 + v * v * 0.035 + (b.boost ? 0.05 : 0)) * (1 - 0.45 * r), at, 0.25);
    rush.gain.setTargetAtTime(r * 0.11, at, 0.6);
    windTone.frequency.setTargetAtTime(380 + v * 380, at, 0.3);
    crickets.gain.setTargetAtTime(Math.max(0, b.night - 0.4) * 0.03 * (1 - b.coast * 0.6), at, 1);
    murmur.gain.setTargetAtTime(b.market.gain * 0.5, at, 0.3);
    sizzle.gain.setTargetAtTime(b.market.gain * b.market.gain * 0.05, at, 0.3);
    marketPan?.pan.setTargetAtTime(b.market.pan, at, 0.2);
    flutter.gain.setTargetAtTime(b.cinema.gain * 0.09, at, 0.3);
    cinemaPan?.pan.setTargetAtTime(b.cinema.pan, at, 0.2);
    // 天擦黑后灯塔的灯每转一圈低低地「呜」一声
    if (b.night > 0.45 && rideT - lastWhoom > 6.5 && lighthouse.gain > 0.08 && !solo) { lastWhoom = rideT; sfx.whoom(at, lighthouse.pan, lighthouse.gain); }
    if (rideT < lastWhoom) lastWhoom = -99;
  }
  /** 全部底噪收到没有（片头、终点卡、暂停）。 */
  function hush(at: number) { for (const g of [rollBody, rollGrit, murmur, sizzle, flutter, rush]) g.gain.setTargetAtTime(0, at, 0.1); wind.gain.setTargetAtTime(0.012, at, 0.3); }

  return { ctx, master, bus, sfx, play, bed, hush, music, resetMusic() { musicBeat = 0; musicNext = -1; } };
}
export type Mix = ReturnType<typeof createMix>;

const KEY = 'skate-volume';
/** 页面上用的那一套：第一次按键或点屏才建声音上下文；音量记在本机。 */
export function createSound(music: boolean) {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  let mix: Mix | null = null, muted = false, volume = 0.8;
  try { const v = Number(localStorage.getItem(KEY)); if (v > 0 && v <= 1) volume = v; } catch (e) { console.warn('[skate] 读不到上次的音量', e); }
  const apply = () => { if (mix) mix.master.gain.setTargetAtTime(muted ? 0 : MASTER * volume, mix.ctx.currentTime, 0.05); };
  document.addEventListener('visibilitychange', () => {
    const c = mix?.ctx as AudioContext | undefined;
    if (!c) return;
    (document.hidden ? c.suspend() : c.resume()).catch((e) => console.warn('[skate] 声音暂停/恢复失败', e));
  });
  return {
    available: !!AC,
    get mix() { return mix; },
    get muted() { return muted; },
    get volume() { return volume; },
    /** 现在的上下文时间（还没建就是 0）。 */
    now: () => mix?.ctx.currentTime ?? 0,
    unlock() {
      if (!AC) return;
      if (mix) { const c = mix.ctx as AudioContext; if (c.state === 'suspended' && !document.hidden) c.resume().catch((e) => console.warn('[skate] 声音恢复失败', e)); return; }
      mix = createMix(new AC(), { music });
      apply();
    },
    setMuted(m: boolean) { muted = m; apply(); },
    setVolume(v: number) {
      volume = Math.min(1, Math.max(0.05, v));
      try { localStorage.setItem(KEY, String(volume)); } catch (e) { console.warn('[skate] 音量没存上', e); }
      apply();
    },
  };
}
export type Sound = ReturnType<typeof createSound>;

const db = (x: number) => (x > 0 ? +(20 * Math.log10(x)).toFixed(1) : -120);
/**
 * 量响度：把机器人骑的那一圈离线渲染出来（不出声），返回峰值、均方根和按 K 计权算的响度（近似 LUFS，没做门限）。
 * only：只渲染某一路，或只渲染轮子的底噪 / 只渲染金币。
 */
export async function measureLap(route: Route, plan: Plan, opts: { music: boolean; only?: Bus | 'roll' | 'coins'; coastAt: (s: number) => number; nightAt: (s: number) => number; nominal: number }) {
  const sr = 44100, dur = plan.lapSeconds + 1.5;
  const ctx = new OfflineAudioContext(2, Math.ceil(sr * dur), sr), mix = createMix(ctx, { music: opts.music, only: opts.only });
  let e = 0;
  const snap = (t: number) => plan.demo[Math.min(plan.demo.length - 1, Math.round(t * 120))];
  for (let t = 0; t < plan.lapSeconds; t += 1 / 30) {
    const p = snap(t), at = t + 0.05;
    route.at(p.s, P, D);
    const lh = spatial(P.x, P.z, Math.atan2(D.x, D.z), PLACES_XZ.lighthouse[0], PLACES_XZ.lighthouse[1], 10);
    mix.bed(at, bedFor(route, plan, p, opts.nightAt(p.s), opts.coastAt(p.s), opts.nominal), p.s, t, lh);
    for (; e < plan.demoLog.length && plan.demoLog[e].t <= t; e++) mix.play(plan.demoLog[e], plan.demoLog[e].t + 0.05, plan);
  }
  mix.music(0.05, plan.lapSeconds, 0.05, (t) => { const p = snap(t); return { combo: p.combo, hurt: t - p.tHit < RULES.stumble, speed: p.v / opts.nominal, fly: p.f >= 0, dragon: p.f >= 0 && plan.dragon.riding(p.f) > 0.5 }; });
  mix.hush(plan.lapSeconds + 0.1);
  const buf = await ctx.startRendering();
  // K 计权：高架 +4 dB、38 Hz 高通，再算均方
  const k = new OfflineAudioContext(2, buf.length, sr), src = k.createBufferSource(), shelf = k.createBiquadFilter(), hp = k.createBiquadFilter();
  src.buffer = buf; shelf.type = 'highshelf'; shelf.frequency.value = 1500; shelf.gain.value = 4; hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.5;
  src.connect(shelf).connect(hp).connect(k.destination);
  src.start();
  const weighted = await k.startRendering();
  let peak = 0, sum = 0, ksum = 0, clipped = 0;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c), w = weighted.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; if (a >= 0.999) clipped++; sum += d[i] * d[i]; ksum += w[i] * w[i]; }
  }
  const n = buf.length * 2;
  return { peakDb: db(peak), rmsDb: db(Math.sqrt(sum / n)), lufs: +(-0.691 + 10 * Math.log10(Math.max(1e-12, ksum / buf.length))).toFixed(1), clippedSamples: clipped, seconds: +dur.toFixed(1) };
}
