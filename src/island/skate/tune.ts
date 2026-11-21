/**
 * 手感参数：速度、起跳、换道，和每个机位的距离、高度、视野、迟滞、前瞻。
 * 默认值是我们调好的一版；网址带 ?tune=1 会出一个滑杆面板，拖动立刻生效，可以把整套数值复制成 JSON。
 */
export type RigId = 'street' | 'runner' | 'follow' | 'cine' | 'drone';
export const RIG_IDS: RigId[] = ['street', 'runner', 'follow', 'cine', 'drone'];
export const RIG_NAMES: Record<RigId, string> = { street: '街景', runner: '俯跟', follow: '跟随', cine: '低机位', drone: '侧飞' };

/**
 * 一个机位：身后多远、多高、顺着路往前看多远（只决定视线往弯里偏多少）、男孩放在画面中线以下多少（占画面高，0.2 就是下三分之一）、
 * 视野（度）、迟滞（秒）、拐弯时歪多少（0 不歪）、往侧面让多远（只有侧飞用）。
 * pitch：写了它，镜头就固定按这个角度（度，正的是微微仰着）平视，不再按 low 去凑——街景机位用，天空才占得到画面上半边。
 */
export interface Rig { back: number; up: number; ahead: number; low: number; fov: number; lag: number; roll: number; side: number; pitch?: number }

export interface Tune {
  /** 两种玩法的速度倍率（1 = 一圈约 84 秒）。 */
  speedTour: number;
  speedChallenge: number;
  /** 起跳初速（米/秒）与三段重力：按住上升、松手后上升、下落（米/秒²）。 */
  jumpV: number;
  gRise: number;
  gCut: number;
  gFall: number;
  /** 换道大约多少秒到位、冲过头多少（0–0.3）。 */
  laneTime: number;
  laneOvershoot: number;
  rigs: Record<RigId, Rig>;
}

export const TUNE: Tune = {
  speedTour: 1, speedChallenge: 1.16,
  jumpV: 6.3, gRise: 17.5, gCut: 50, gFall: 27,
  laneTime: 0.14, laneOvershoot: 0.06,
  rigs: {
    // 街景（默认）：贴着地、在他肩膀的高度从身后跟，广角、微微仰着：路从脚下往后冲，房子在两边立着，上半个画面是天
    street: { back: 3.5, up: 1.1, ahead: 7, low: 0.05, fov: 84, lag: 0.35, roll: 0.9, side: 0, pitch: 2 },
    // 俯跟：高、远，三条道和前面二十多米的东西一目了然，男孩在下三分之一，身高占画面 17% 上下；不歪
    runner: { back: 9.0, up: 4.9, ahead: 9, low: 0.2, fov: 50, lag: 0.3, roll: 0, side: 0 },
    // 跟随：近一点的身后视角，男孩占画面 22% 上下
    follow: { back: 6.6, up: 3.15, ahead: 6, low: 0.13, fov: 56, lag: 0.4, roll: 0.3, side: 0 },
    // 低机位：贴地、广角，拐弯时轻轻歪，逛岛和拍片用
    cine: { back: 3.9, up: 1.5, ahead: 6, low: 0.06, fov: 68, lag: 0.6, roll: 1, side: 0 },
    // 侧飞：从海那一侧斜着跟拍，开阔的路段好看
    drone: { back: 2.2, up: 3.0, ahead: 1.5, low: 0.04, fov: 44, lag: 0.7, roll: 0, side: 7.5 },
  },
};

export const cloneTune = (t: Tune = TUNE): Tune => JSON.parse(JSON.stringify(t)) as Tune;
/** 满按一次跳：升到最高点用时、最高多高、整个腾空多久。 */
export function jumpShape(t: Tune, boost = 1) {
  const v = t.jumpV * boost, rise = v / t.gRise, height = (v * v) / (2 * t.gRise), fall = Math.sqrt((2 * height) / t.gFall);
  return { rise, height, fall, air: rise + fall };
}
