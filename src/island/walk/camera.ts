/**
 * 小岛邮差：镜头（纯计算，页面和检查脚本用同一份）。
 *
 * 跟随机位：贴在少年身后的低机位（略广角），方向用不过冲的弹簧慢半拍追「他往哪走」，角速度、角加速度都有上限，不甩不晕。
 * - 朝镜头走过来时镜头先不动（看他迎面走来）；这样走满一秒，才慢慢绕回他身后。站着不动时镜头不转。
 * - 躲东西：从他身后一步步往外探，碰到房子、树冠、屋檐、更高的台地就收到那儿（收近快、放远慢）；最近那一点也不空就往两边让。
 * - 窄处升高：被压到 2.6 米以内时镜头抬高（看的点不变，自然变成往下看），而不是贴在后脑勺上；但俯角（镜头在他胸口上方的仰角）有上限，
 *   不会变成只看得见头顶的俯视（M1 验收：竖屏两成时间俯角超过 50°）。收近以后看的点往下压，脚一直在画面里。
 * - 躲人：岛民挡在镜头和他之间（或者贴在镜头前），每 0.2 秒试几个往旁边转开、略抬高的机位，挑不挡的那个（M1 验收：夜市、开场被挡）。
 * - 高度跟着他平滑过的高度走，上下台阶不颠；左右前后直接跟插值过的位置，不另加弹簧（不抖）。
 * - 沿街轨道（M1 验收 r2：夜市街里镜头跟着他斜着走就钻进两边的摊位，被压近、抬到棚顶上往下看）：在街上时「他往哪走」按街的方向算
 *   （沿街两个方向里离他朝向近的那个，过了 100° 才换边），镜头往街中线收，于是一直在街心、固定高度顺着街跟拍。
 * - 不切地形（M1 验收 r2：山脚镜头贴到 1.3 米、山体三角面横切过他腰部）：镜头周围半米内的地形都要比镜头低；身后连最近那一点都被山挡住时，
 *   往两边转开的角度放宽到 ±2.5 弧度（绕到侧面、前面看），实在没地方才抬高。
 * 躲墙的探针照 skate/free.ts 的 createFreeCam 搬过来，去掉了滑板专用的分支（飞、侧身站、被推开时稳住）。
 */
import * as THREE from 'three';

export interface CamWorld {
  /** 看得见的地面顶在哪（台地边鼓出来的那一圈、山坡都算），海里 -Infinity。 */
  top(x: number, z: number): number;
  /** (x, z) 周围 r 米内，离地 at 米那一层有没有挡镜头的东西（树冠、屋檐、伞面、墙）。 */
  hides(x: number, z: number, r: number, at: number): boolean;
  /** (x, z) 周围 r 米内是不是房子。 */
  walled(x: number, z: number, r: number): boolean;
  /** 沿街轨道（夜市街这种两边摆满东西的窄街）：他在街上时给出街的方向和他离街中线多远；不在任何一条街上返回 null。不给就没有轨道。 */
  rail?(x: number, z: number): Rail | null;
}
/** 一条街：方向（单位向量）、他离中线多远（沿街方向的左手边为正）、镜头往中线收几成。 */
export interface Rail { dx: number; dz: number; side: number; pull: number }
/** 一个会挡镜头的人：位置、身体半径、头顶离脚多高。 */
export interface CamPerson { x: number; z: number; r: number; h: number }
/**
 * climb：在登山石阶上（镜头换成高一点、不躲山坡的机位：山坡挡在中间的那一截由网点淡掉）。
 * people：附近看得见的人（不含他自己）；不给就不躲人。
 */
export interface CamTarget { x: number; z: number; y: number; heading: number; speed: number; climb?: boolean; people?: readonly CamPerson[] }
export interface CamPose { pos: THREE.Vector3; look: THREE.Vector3; fov: number }

/** 机位：身后多远、离脚下多高、看的点（脚下往上多高、往镜头前方多远）、视野。竖屏退远一点、视野大一点。 */
export const RIG = {
  wide: { back: 4.4, up: 1.9, fov: 58, lookDrop: 0.15 },
  /**
   * 竖屏：画面又高又窄，弯曲又把地平线压到平视以下十来度——镜头平着看就是大半屏天（M1 验收：开场六成是天）。
   * 所以竖屏机位高一点、远一点、往下看多一点（他胸口往上的仰角约 25°，地平线落在画面上三分之一），不是半屏天。
   */
  tall: { back: 5.4, up: 3.3, fov: 70, lookDrop: 1.25 },
  lookUp: 1.15, lookAhead: 1.6,
  /** 方向的弹簧（每秒）、角速度上限、角加速度上限。 */
  omega: 5, maxRate: 2.2, maxAccel: 7.5,
  /** 朝镜头走：夹角超过这么多（弧度）算迎面；迎面走满几秒开始绕；绕的时候最快多少。 */
  facing: (110 * Math.PI) / 180, facingWait: 1, facingRate: 0.9,
  /** 最近贴多近、收近 / 放远的快慢。 */
  near: 1.3, inRate: 9, outRate: 2.2,
  /** 窄处：身后距离被压到这以内开始抬高，每少一米抬多少、最多抬多少。 */
  narrow: 2.8, liftPer: 1.0, liftMax: 2.4,
  /**
   * 俯角上限（镜头在他胸口上方的仰角，度）：平常 36°；他身后紧贴着墙、或者要从人头顶上看过去的时候放宽到 44°。
   * 脚在画面里：脚离画面下沿至少留这么多度。
   */
  maxEl: 36, maxElTight: 44, feetMargin: 5,
  /** 高度追得多快。 */
  yRate: 8,
} as const;
/**
 * 在街上镜头离脚多高（横屏 / 竖屏）：比平常低，从遮阳篷底下、街口牌坊的匾底下穿过去（篷檐最低 1.4 米、在离中线 0.8 米以外；匾底 2.4 米）。
 * M1 验收 r2：竖屏机位 3.3 米高，在街上就是从棚顶往下拍。
 */
const RAIL_UP = { wide: 1.6, tall: 1.75 } as const;
/**
 * 身后宽敞了以后镜头退回去多快：「想退多远」的抹平速率、距离弹簧的 ω。原来 3 / 2.4，从窄缝里走出来要两秒多才退开
 * （M3 验收 r1：后巷巷口往前走 1.3 秒构图还没恢复），改成 5 / 3.6，一秒左右退开；收近照旧快。
 */
const OUT = { want: 5, spring: 3.6 } as const;
/** 查挡镜头的东西时镜头高度往下挪多少（见 createWalkCam 里的 hides）。 */
const HIDE_SHIFT = 0.3;
/** 往身后探的时候，挡着的那一截不超过这么长（灯杆、晾衣绳的杆子、榕树的气根：一根细杆加上探针两边的半径）就当它是细杆，镜头可以停在它后面（网点淡掉它），不被一根杆子收到后脑勺。 */
const THIN = 0.61;
/** 镜头往下躲（从屋檐、横匾、树冠底下穿过去）最低到离脚多高。 */
const DUCK_MIN = 1.45;
/** 登山石阶上镜头多抬多高。 */
const CLIMB_UP = 1.9;
/** 镜头周围多大一圈地形要比镜头低（米）、低多少。 */
const TERRAIN_R = 0.5, TERRAIN_CLEAR = 0.4;
const RING = Array.from({ length: 8 }, (_, k) => [Math.cos((k * Math.PI) / 4) * TERRAIN_R, Math.sin((k * Math.PI) / 4) * TERRAIN_R] as const);
/** 沿街轨道：沿街方向和他朝向差多少才换边（弧度，100°）。 */
const RAIL_FLIP = (100 * Math.PI) / 180;
/** 在街上镜头最快转多少（弧度/秒）：转的同时还在往中线挪、往旁边让，画面实际转得比这快一点。 */
const RAIL_TURN = 1.8;
/** 身后挤的时候往两边各试几个角度（弧度）；连最近那一点都没有时多试几个大角度。 */
const BIAS_OFFS = [0.4, -0.4, 0.8, -0.8, 1.2, -1.2], BIAS_WIDE = [...BIAS_OFFS, 1.6, -1.6, 2.0, -2.0, 2.5, -2.5];
/** 往两边让：最多偏多少（tan 15°）。 */
const SIDE_MAX = Math.tan((15 * Math.PI) / 180);
/**
 * 前景的人（M2 验收：栈桥上送完信，镜头回到身后时码头工人的大脑袋占住半屏；船坞院子里一圈人头堵满前景）：
 * 离镜头 near 米以内、又落在画面里（水平视野内，按身子宽 body 放宽一点）的人算满一个「大脑袋」，far 米以外不算，中间按远近减。
 * 原来只算「站在视线上」和「贴在镜头一米内」的，侧前方一米多的人头不算挡，镜头就不躲。
 */
const FG = { near: 2.0, far: 3.2, body: 0.35 } as const;
/**
 * 跟随机位的俯角硬上限（度，从他胸口量）：高度弹簧追到哪都不超过它（原来是「贴墙那一档再加 4°」= 48°）；
 * 摆位置时再按他此刻的脚下兜一次底（再宽 2°，平时碰不到，只防弹簧和他上下台阶差的那一点）。M2 验收：船坞院子量到 52°。
 */
const FOLLOW_EL_MAX = 46;
/**
 * 双人机位（M2）：偏着两人连线多少度（横屏 50°，竖屏 28°：竖屏画面窄，从少年肩后看过去两人前后错开才装得下）、往两边再试几个角度、
 * （124°、144° 是反打：镜头到说话人那一侧、从他肩后看少年——窄街里少年这一侧怎么摆都把对方挡住时用，偏得多代价也大）、
 * 起步距离的几档（贴着墙时近一点）、俯角（low 是棚子底下那一档：夜市街两边全是遮阳篷，高机位的视线都穿棚顶）、两人在画面里离边多远（水平半视野的几成以内、竖直半视野的几成以内）。
 */
const SHOT = { th: { wide: 50, tall: 28 }, alts: [0, 20, -20, 40, -40, 62, -62, 85, -85, 124, 144], ks: [1, 0.78, 0.6], el: { wide: 22, tall: 26 }, low: 11, fill: 0.78, vfill: 0.84, boyH: 1.62 } as const;
const smooth01 = (a: number, b: number, x: number) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const toward = (rate: number, dt: number) => 1 - Math.exp(-dt * rate);
/** 临界阻尼的二阶弹簧（按 1/120 秒小步走）：o[k] 追 target，o[v] 是它的速度——速度连续，目标突然变了也不会「咔」地一跳。 */
function spring<T extends Record<string, number>>(o: T, k: keyof T, v: keyof T, target: number, w: number, dt: number) {
  const r = o as Record<string, number>, kk = k as string, vv = v as string;
  for (let left = Math.min(dt, 0.1); left > 1e-6; left -= 1 / 120) {
    const h = Math.min(left, 1 / 120);
    r[vv] += (w * w * (target - r[kk]) - 2 * w * r[vv]) * h;
    r[kk] += r[vv] * h;
  }
}

export function createWalkCam(world: CamWorld) {
  /**
   * 挡镜头的那一层按镜头高度查时，往下挪 HIDE_SHIFT 米再查（solid.ts 认「镜头往下 0.45、往上 0.55」以内有东西就算钻进去了）：
   * 镜头顶上留 0.25 米就够（近裁面才 0.1 米），底下多留一点。M3 验收 r1：后巷大榕树的树冠最低离地 2.2 米，横屏镜头离脚 1.9 米本来钻得过去，
   * 却按「往上 0.55」算进了树冠，一路被压到 1.3 米。
   */
  const hides = (x: number, z: number, r: number, at: number) => world.hides(x, z, r, at - HIDE_SHIFT);
  /** 站着也要转过去的方向（recenter）：null 是不用。 */
  let turnTo: number | null = null;
  const c = { yaw: 0, yv: 0, back: RIG.wide.back as number, y: 0, lift: 0, side: 0, facingT: 0, fov: RIG.wide.fov as number, dip: 0, bias: 0, biasWant: 0, biasT: 0, bv: 0, need: 0, want: RIG.wide.back as number, lv: 0, sv: 0, climb: 0, cv: 0, tight: 0, pYaw: 0, pYawWant: 0, pLift: 0, pLiftWant: 0, pT: 0, blockedBy: 0, hy: RIG.wide.up as number, hv: 0, crowd: 0, pBack: 1, pBackWant: 1, rdir: 0, rox: 0, roz: 0, ty: 0, tyv: 0, rk: 0, duck: 0, dv: 0 };
  const out: CamPose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: RIG.wide.fov };
  /** 画面宽高比（页面每次改尺寸时告诉镜头；检查脚本不告诉就按 16:10）：算「人在不在画面里」要用水平视野。 */
  let aspect = 1.6;
  /** 竖直视野 fovDeg 度时，水平半视野多少弧度。 */
  const halfH = (fovDeg: number) => Math.atan(Math.tan((fovDeg * Math.PI) / 360) * aspect);
  /** 镜头在 (cx, cz)、朝着 (lx, lz) 看：q 贴在镜头跟前、又落在画面里的程度（0–1，见 FG）。 */
  const fgOf = (q: CamPerson, cx: number, cz: number, lx: number, lz: number, half: number) => {
    const px = q.x - cx, pz = q.z - cz, dc = Math.hypot(px, pz);
    if (dc >= FG.far) return 0;
    if (dc > 0.3) {
      const fx = lx - cx, fz = lz - cz, cos = (px * fx + pz * fz) / (dc * (Math.hypot(fx, fz) || 1));
      if (Math.acos(Math.max(-1, Math.min(1, cos))) > half + Math.atan(FG.body / dc)) return 0;
    }
    return 1 - smooth01(FG.near, FG.far, dc);
  };

  /** 镜头放在 (cx, cz)、高 camY：碰不碰东西（地形比镜头还高、房子、离那儿地面 camY 高的那一层有树冠屋檐）。 */
  const blocked = (t: CamTarget, cx: number, cz: number, r: number, camY: number, ring = true) => {
    const top = world.top(cx, cz), floor = top > -1e9 ? top : t.y;
    if (t.climb) return world.walled(cx, cz, r + 0.15) || hides(cx, cz, r, camY - floor);
    return (ring ? topRing(cx, cz, top) : top) > camY - 0.35 || (camY - floor < 4.6 && world.walled(cx, cz, r + 0.15)) || hides(cx, cz, r, camY - floor);
  };
  /** 镜头周围 TERRAIN_R 米内地形最高到哪（近裁面不切地形：只看镜头正下方的话，贴着山坡时旁边的山体会横切进画面）。 */
  const topRing = (cx: number, cz: number, top = world.top(cx, cz)) => {
    let m = top;
    for (let k = 0; k < 8; k++) m = Math.max(m, world.top(cx + RING[k][0], cz + RING[k][1]));
    return m;
  };
  /** 从他身边到 (cx, cz) 中间有没有隔着东西（隔着墙的另一边就算空也不能去）。 */
  const through = (t: CamTarget, cx: number, cz: number, camY: number) => {
    const len = Math.hypot(cx - t.x, cz - t.z);
    for (let d = 0.45; d < len - 0.1; d += 0.2) {
      const k = d / len, y = t.y + 1.2 + (camY - t.y - 1.2) * k;
      if (blocked(t, t.x + (cx - t.x) * k, t.z + (cz - t.z) * k, 0.02, y, false)) return true;
    }
    return false;
  };
  /**
   * 沿身后一步步往外探（从他身边 0.5 米起，每 0.2 米一次；探的高度从他胸口按直线升到镜头高度——这样连他身后紧挨着的墙角、山坡也查得到）：
   * hard 是真要碰到之前的最远处，soft 是离东西还留着半米余量的最远处。
   */
  const probe = (t: CamTarget, yaw: number, want: number, camY: number) => {
    let soft = 0, softDone = false, hard = 0, run = 0;
    const sx = Math.sin(yaw), sz = Math.cos(yaw), chest = t.y + 1.2;
    for (let d = 0.5; d <= want + 1e-6; d += 0.2) {
      // 镜头周围一圈地形（topRing）只在镜头真能停的地方（RIG.near 以外）查：贴着他的那一截查的是视线，
      // 一圈半米会把他自己脚边的山坡也圈进去（站在山脚，四面八方第一步就算撞，镜头哪儿也去不了，只好抬到头顶往下拍）
      const cx = t.x - sx * d, cz = t.z - sz * d, y = chest + (camY - chest) * Math.min(1, d / RIG.near), ring = d >= RIG.near - 0.05;
      if (blocked(t, cx, cz, d < RIG.near ? 0.12 : 0.22, y, ring)) {
        // 挡着的这一截够短、后面又空了（细杆）：接着往外探；挡着的是墙、房子、地形就到此为止
        run += 0.2;
        if (run > THIN || hard < RIG.near - 0.05 || walledOrHill(t, cx, cz, y)) break;
        softDone = true;
        continue;
      }
      run = 0;
      hard = d;
      if (!softDone && !blocked(t, cx, cz, d < RIG.near ? 0.3 : 0.7, y, ring)) soft = d; else softDone = true;
    }
    return { soft, hard };
  };
  /** 挡着的是房子或者地形（不是细杆）。 */
  const walledOrHill = (t: CamTarget, cx: number, cz: number, y: number) => world.walled(cx, cz, 0.3) || topRing(cx, cz) > y - 0.35;
  /** 从镜头看他的腿（脚上 0.4 米）会不会被台地边、坡挡住（侧着看站在码头台阶上的人，草地边会把腿切掉）。 */
  const legsHidden = (t: CamTarget, cx: number, cz: number, camY: number) => {
    const len = Math.hypot(cx - t.x, cz - t.z), knee = t.y + 0.4;
    for (let d = 0.4; d < len; d += 0.25) {
      const k = d / len, top = world.top(t.x + (cx - t.x) * k, t.z + (cz - t.z) * k);
      if (top > knee + (camY - knee) * k) return true;
    }
    return false;
  };
  /** 最近那一点也不空时往两边让：返回让多少米（右正左负），找不到返回 null。 */
  const dodge = (t: CamTarget, yaw: number, camY: number, prefer: number) => {
    const sx = Math.sin(yaw), sz = Math.cos(yaw), order = prefer < 0 ? [-1, 1] : [1, -1];
    for (let o = 0.08; o <= RIG.near * SIDE_MAX + 1e-6; o += 0.08) for (const side of order) {
      const cx = t.x - sx * RIG.near + sz * o * side, cz = t.z - sz * RIG.near - sx * o * side;
      if (!blocked(t, cx, cz, 0.2, camY) && !through(t, cx, cz, camY)) return o * side;
    }
    return null;
  };

  /** 镜头离他脚下多高（想要的高度，压在俯角上限以内）。 */
  const wantHy = (rig: { up: number }) => Math.min(upOf(rig) + c.lift + c.pLift + c.climb * CLIMB_UP - c.duck, capY(Math.hypot(c.back, c.side)) - c.y);
  /** 镜头在 back 米外最高能放多高（俯角上限）：tight 是「身后紧贴着墙」的程度（0–1）。 */
  const capY = (back: number, crowd = c.crowd) => c.y + 1 + back * Math.tan(((RIG.maxEl + (RIG.maxElTight - RIG.maxEl) * Math.max(c.tight, crowd) + c.climb * 14) * Math.PI) / 180);
  /** 机位离脚多高：在街上（c.rk 是进街的程度，0–1）换成 RAIL_UP。 */
  const upOf = (rig: { up: number }) => rig.up + ((rig === RIG.tall ? RAIL_UP.tall : RAIL_UP.wide) - rig.up) * c.rk;

  function place(t: CamTarget, tall: boolean) {
    const rig = tall ? RIG.tall : RIG.wide, sx = Math.sin(c.yaw), sz = Math.cos(c.yaw);
    // 登山石阶上：镜头再抬高 CLIMB_UP、稍微往下看（山坡在身边，低机位只看得见一面山）
    const horiz = Math.hypot(c.back, c.side);
    out.pos.set(t.x - sx * c.back + sz * c.side + c.rox, c.y + c.hy + c.ty, t.z - sz * c.back - sx * c.side + c.roz);
    // 最后一道俯角上限：不管前面哪道抬高叠到哪，镜头都不高过从他胸口仰 48°（登山石阶上照旧放宽）
    {
      const hd = Math.hypot(out.pos.x - t.x, out.pos.z - t.z), maxY = t.y + 1 + hd * Math.tan(((FOLLOW_EL_MAX + 2 + c.climb * 14) * Math.PI) / 180);
      if (out.pos.y > maxY) out.pos.y = maxY;
    }
    out.look.set(t.x + sx * RIG.lookAhead + sz * c.side, c.y + RIG.lookUp - c.dip - c.lift * 0.35 + c.climb * 0.3 - rig.lookDrop, t.z + sz * RIG.lookAhead - sx * c.side);
    // 脚要在画面里：镜头收近以后，「看的点」不变的话脚会掉出画面下沿——把看的点往下压到脚离下沿还有 feetMargin 度
    const lookDist = Math.hypot(out.look.x - out.pos.x, out.look.z - out.pos.z), half = (c.fov * Math.PI) / 360, margin = (RIG.feetMargin * Math.PI) / 180;
    const lookDown = Math.atan2(out.pos.y - out.look.y, lookDist), feetDown = Math.atan2(out.pos.y - c.y, horiz);
    out.fov = c.fov;
    if (feetDown - lookDown > half - margin) {
      let down = feetDown - (half - margin);
      // 压完头顶又出了上沿（镜头贴得很近）：看头脚正中间，视野放宽到正好装下（最多宽 14°）
      const headDown = Math.atan2(out.pos.y - (c.y + 1.7), horiz);
      if (down - headDown > half - margin * 0.5) {
        down = (feetDown + headDown) / 2;
        out.fov = Math.min(c.fov + 14, Math.max(c.fov, ((feetDown - headDown) / 2 + margin) * (360 / Math.PI)));
      }
      out.look.y = out.pos.y - Math.tan(down) * lookDist;
    }
    return out;
  }

  /**
   * 人挡没挡（镜头在 (cx, camY, cz)）：站在镜头到他胸口的视线边上、头顶比视线高的人算挡；贴在镜头跟前（一米内、比镜头矮不了多少）的也算——
   * 那是半屏一个大脑袋。返回挡了几个。
   */
  const peopleIn = (t: CamTarget, cx: number, cz: number, camY: number) => {
    let n = 0;
    const ax = t.x - cx, az = t.z - cz, len2 = ax * ax + az * az, chest = t.y + 0.8, half = halfH(c.fov);
    if (!t.people || len2 < 1e-4) return 0;
    for (const q of t.people) {
      const px = q.x - cx, pz = q.z - cz, near = Math.hypot(px, pz);
      if (near < 0.95 + q.r && q.h > camY - 0.9) { n++; continue; }
      // 和他身子挨着的（0.6 米内，已经被挤开一点了）不算：本来就会叠一点，为它把镜头拧来拧去反而晃
      if (Math.hypot(q.x - t.x, q.z - t.z) < 0.6) continue;
      const s = (px * ax + pz * az) / len2;
      const lat = s > 0 ? Math.hypot(px - ax * s, pz - az * s) : Infinity, los = camY + (chest - camY) * s;
      if (lat < q.r + 0.16 && los < q.h + 0.05) { n++; continue; }
      // 不在视线上、但贴在镜头跟前又落在画面里：半屏一个大脑袋，也算（按远近算几成）
      // 只算半个：页面会把镜头跟前的路人整个淡掉（main.ts 的 ghostsFor），为它把镜头挤进墙角不划算
      n += 0.5 * fgOf(q, cx, cz, t.x, t.z, half);
    }
    return n;
  };
  /**
   * 被人挡了（站在视线上、或者贴在镜头跟前占了半屏）：每 0.2 秒在「往两边转开 × 略抬高」里挑一个代价最小的。
   * 转过去那个方向身后有多少地方也算进代价（转到墙跟前、只剩一米多的方向不如原地），不再「收近、从头顶往下拍」（M2 验收：船坞院子被挤到 2.2 米、俯角 52°）。
   * 没人挡就慢慢回到正后方。
   */
  const P_YAW = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4], P_LIFT = [0, 0.6, 1.2];
  function peopleDodge(t: CamTarget, dt: number, rig: { back: number; up: number }, camY: number) {
    c.pT -= dt;
    if (c.pT <= 0) {
      c.pT = 0.2;
      const base = c.yaw - c.pYaw;
      const rooms = new Map<number, number>();
      /** 往旁边转 off、抬高 lift：挡几个人（大脑袋按几成算）、身后退不开几米、划不划算。 */
      const at = (off: number, lift: number) => {
        const y = base + off;
        let room = rooms.get(off);
        if (room === undefined) { room = probe(t, y, rig.back, camY).hard; rooms.set(off, room); }
        if (off !== 0 && room < RIG.near) return Infinity;
        // 抬高是为了从人头顶上看过去：这时俯角上限放宽到「贴墙」那一档
        const back = Math.max(RIG.near, Math.min(rig.back, room - 0.25)), cx = t.x - Math.sin(y) * back, cz = t.z - Math.cos(y) * back, cy = Math.min(camY + lift, capY(back, lift > 0 ? 1 : 0));
        if (off !== 0 && (blocked(t, cx, cz, 0.22, cy) || through(t, cx, cz, cy) || legsHidden(t, cx, cz, cy))) return Infinity;
        return peopleIn(t, cx, cz, cy) * 10 + Math.abs(off) * 2.2 + lift * 1.4 + Math.max(0, rig.back - back) * 1.6;
      };
      const now = at(c.pYawWant, c.pLiftWant);
      c.blockedBy = Math.floor(now / 10);
      let best = now - 0.6, bo = c.pYawWant, bl = c.pLiftWant;
      // 正后方本来就没人挡：回正，不为「哪边地方大」转（那是躲墙那一套 bias 的事，两套一起转会打架）
      const back0 = Math.max(RIG.near, Math.min(rig.back, probe(t, base, rig.back, camY).hard - 0.25));
      if (peopleIn(t, t.x - Math.sin(base) * back0, t.z - Math.cos(base) * back0, camY) < 0.05) { bo = 0; bl = 0; }
      else for (const off of P_YAW) for (const lift of P_LIFT) { const v = at(off, lift); if (v < best) { best = v; bo = off; bl = lift; } }
      c.pYawWant = bo; c.pLiftWant = bl; c.pBackWant = 1;
    }
    const rate = 0.9 * dt;
    c.pYaw += Math.max(-rate, Math.min(rate, c.pYawWant - c.pYaw));
    c.pLift += (c.pLiftWant - c.pLift) * toward(3, dt);
    c.crowd += ((c.pLiftWant > 0 ? 1 : 0) - c.crowd) * toward(3, dt);
    c.pBack += (c.pBackWant - c.pBack) * toward(2.5, dt);
    void rig;
  }

  /**
   * 对话双人机位（M2）：镜头放在少年这一侧、偏着两人连线的方向（横屏偏 50°，竖屏偏 28°：竖屏画面窄，从少年肩后看过去两人前后错开才装得下），
   * 往两边各再试几个角度、离得近一点的几档，挑代价最小的。谈话中途只在被挡了、而且新机位明显更好时才换。
   * 构图（M2 验收：竖屏 11 次送达有 8 次少年身子中心离屏幕边只有 47–71 像素）：按真实的宽高比算水平视野，
   * 镜头的方向对准两个人方位角的正中间，两个人（连身子宽）都要落在水平半视野的 78% 以内、头脚都在竖直半视野的 84% 以内，装不下就往后退，退 4 米还装不下这个机位就不要。
   * 都不行（贴着墙、四面都是人）：不切过去，跟随机位转到少年身后、对着说话的人（不再「取正侧面交给网点淡掉」——那就是船坞里镜头在墙里、只看得见气泡）。
   * 「正面」机位（结尾一个人的时候）：站在少年前方偏一侧，看他和他身后。
   * 切过去、切回来都是 0.6 秒的平滑过渡（减少动态效果下 0.15 秒），跟随机位在底下照常算，切回来时直接接上。
   */
  const shot = { on: false, k: 0, side: 0, th: 0, kd: 1, low: false, none: false, other: new THREE.Vector3(), otherFoot: 0, front: false, pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 46, shift: 0, lift: 0, face: null as { x: number; z: number } | null };
  const shotTry = new THREE.Vector3(), shotLook = new THREE.Vector3();
  const shotFov = (tall: boolean) => (shot.front ? (tall ? 60 : 48) : tall ? 60 : 46);
  /**
   * 摆双人机位：side 哪一侧、alt 在基准角上再偏几度、kd 起步距离乘几。摆好返回比起步距离多退了几米；怎么退都装不下返回 Infinity。
   */
  const twoShotAt = (t: CamTarget, tall: boolean, side: number, alt: number, kd: number, outPos: THREE.Vector3, outLook: THREE.Vector3, low = false) => {
    const bx = t.x, bz = t.z;
    if (shot.front) {
      const a = t.heading + side * (0.45 + (alt * Math.PI) / 180), d = (tall ? 4.6 : 4.2) * kd;
      outPos.set(bx + Math.sin(a) * d, t.y + 1.9, bz + Math.cos(a) * d);
      outLook.set(bx, t.y + 1.0, bz);
      return 0;
    }
    const o = shot.other, of = shot.otherFoot, mx = (bx + o.x) / 2, mz = (bz + o.z) / 2;
    let ux = bx - o.x, uz = bz - o.z;
    const sep = Math.hypot(ux, uz) || 1;
    ux /= sep; uz /= sep;
    const th = ((((tall ? SHOT.th.tall : SHOT.th.wide) + alt) * Math.PI) / 180) * side, cs = Math.cos(th), sn = Math.sin(th);
    const dx = ux * cs - uz * sn, dz = ux * sn + uz * cs;
    const fov = shotFov(tall), half = halfH(fov) * SHOT.fill, vhalf = ((fov * Math.PI) / 360) * SHOT.vfill, el = Math.tan(((low ? SHOT.low : tall ? SHOT.el.tall : SHOT.el.wide) * Math.PI) / 180);
    const yMid = (t.y + of) / 2 + 0.9, d0 = Math.max(3.5, 1.5 * sep) * kd * (tall ? 1.12 : 1);
    // 两个人：脚、头顶（各加一点余量）
    const pts: [number, number, number, number][] = [[bx, bz, t.y, t.y + SHOT.boyH + 0.15], [o.x, o.z, of, o.y + 0.45]];
    for (let d = d0; d <= d0 + 4 + 1e-6; d += 0.25) {
      const cx = mx + dx * d, cz = mz + dz * d, cy = yMid + d * el;
      // 水平：对准两人方位角的正中间，看两边各离画面中线多远（连身子宽）
      const a1 = Math.atan2(bx - cx, bz - cz), a2 = Math.atan2(o.x - cx, o.z - cz), yaw = a1 + wrap(a2 - a1) / 2;
      let need = 0, top = Infinity, bot = -Infinity;
      for (const [px, pz, y0, y1] of pts) {
        const hd = Math.hypot(px - cx, pz - cz) || 1e-3;
        need = Math.max(need, Math.abs(wrap(Math.atan2(px - cx, pz - cz) - yaw)) + Math.atan(0.32 / hd));
        top = Math.min(top, Math.atan2(cy - y1, hd)); bot = Math.max(bot, Math.atan2(cy - y0, hd));
      }
      // shift / lift：两个人在画面里往一边、往上让多少（半个画面的几成；结尾明信片在右边 / 下面，把两人让到另一边）
      if (need + Math.abs(shot.shift) * half > half || (bot - top) / 2 + Math.abs(shot.lift) * vhalf > vhalf) continue;
      const pitch = (top + bot) / 2 + shot.lift * vhalf, yawL = yaw + shot.shift * half;
      outPos.set(cx, cy, cz);
      outLook.set(cx + Math.sin(yawL) * Math.cos(pitch) * 3, cy - Math.sin(pitch) * 3, cz + Math.cos(yawL) * Math.cos(pitch) * 3);
      return d - d0;
    }
    return Infinity;
  };
  /** 从 (cx, cy, cz) 看 (px, py, pz) 的视线上挡着几个人（两人自己不算）；贴在镜头跟前、落在画面里的大脑袋按几成算。 */
  const peopleOnLine = (t: CamTarget, cx: number, cy: number, cz: number, px: number, py: number, pz: number, half: number) => {
    let n = 0;
    const ax = px - cx, az = pz - cz, l2 = ax * ax + az * az || 1;
    for (const q of t.people ?? []) {
      if (Math.hypot(q.x - t.x, q.z - t.z) < 0.5 || Math.hypot(q.x - shot.other.x, q.z - shot.other.z) < 0.5) continue;
      const s = ((q.x - cx) * ax + (q.z - cz) * az) / l2;
      if (s > 0 && s < 1) {
        const lat = Math.hypot(q.x - cx - ax * s, q.z - cz - az * s), los = cy + (py - cy) * s;
        if (lat < q.r + 0.18 && los < q.h + 0.05) { n++; continue; }
      }
      n += fgOf(q, cx, cz, px, pz, half);
    }
    return n;
  };
  /** 从镜头看 (px, py, pz) 这一路上有没有挡着的东西（房子、树冠、屋檐、灯杆、地形）：每 0.2 米查一次，离镜头近的那一截查得宽一点。 */
  const lineBlocked = (cx: number, cy: number, cz: number, px: number, py: number, pz: number, t: CamTarget, stop = 0.45) => {
    const len = Math.hypot(px - cx, pz - cz), n = Math.max(2, Math.ceil(len / 0.2));
    // 查到离那个人 stop 米为止（原来少查最后两格 = 0.4–0.6 米：试玩第 2 轮开场，一根灯柱就立在少年身前半米，从正中把画面劈开）
    for (let i = 1; i < n && (1 - i / n) * len > stop; i++) {
      const k = i / n, x = cx + (px - cx) * k, z = cz + (pz - cz) * k, y = cy + (py - cy) * k, g = world.top(x, z), r = k < 0.35 ? 0.16 : 0.08;
      if (g > y - 0.15 || world.walled(x, z, r * 0.5) || hides(x, z, r, y - (g > -1e9 ? g : t.y))) return true;
    }
    return false;
  };
  /** 从镜头看这个人，身子左右两边（各偏 0.25 米）的膝、腰、肩三条视线上有几条被杆子、柱子、箱子挡着：挡一条就是画面上他身上竖着一截东西。 */
  const bodyCut = (cx: number, cy: number, cz: number, px: number, pz: number, y0: number, y1: number, t: CamTarget) => {
    const l = Math.hypot(px - cx, pz - cz) || 1, rx = (pz - cz) / l, rz = -(px - cx) / l;
    let n = 0;
    for (const side of [-0.25, 0.25]) for (const y of [y0 + 0.45, (y0 + y1) / 2, y1 - 0.25]) if (lineBlocked(cx, cy, cz, px + rx * side, y, pz + rz * side, t, 0.3)) n++;
    return n;
  };
  /** 这个机位划不划算：撞东西、隔着墙树、装不下两个人的不要；挡着人的每个算 10（大脑袋按几成）；两人叠在一起、退得远、离现在的镜头远、偏得多各有一点代价。 */
  const shotCost = (t: CamTarget, tall: boolean, side: number, alt: number, kd: number, low = false) => {
    const extra = twoShotAt(t, tall, side, alt, kd, shotTry, shotLook, low);
    if (extra === Infinity) return Infinity;
    const top = world.top(shotTry.x, shotTry.z), cy = shotTry.y;
    // 镜头身边半米内不能有东西（不然一根灯杆、一角遮阳篷糊满半屏）；镜头和墙之间也不能隔着墙（不能在墙那边）
    if (top > cy - 0.4 || world.walled(shotTry.x, shotTry.z, 0.45) || hides(shotTry.x, shotTry.z, 0.5, cy - (top > -1e9 ? top : t.y)) || hides(shotTry.x, shotTry.z, 0.5, cy - 0.6 - (top > -1e9 ? top : t.y))) return Infinity;
    if (lineBlocked(shotTry.x, cy, shotTry.z, t.x, t.y + 1.2, t.z, t, 0.3) || lineBlocked(shotTry.x, cy, shotTry.z, t.x, t.y + 0.5, t.z, t, 0.3)) return Infinity;
    const half = halfH(shotFov(tall));
    if (!shot.front && (lineBlocked(shotTry.x, cy, shotTry.z, shot.other.x, shot.other.y - 0.3, shot.other.z, t) || lineBlocked(shotTry.x, cy, shotTry.z, shot.other.x, shot.otherFoot + 0.6, shot.other.z, t))) return Infinity;
    // 两个人身上竖着一截杆子、柱子、箱子（身子左右两边的膝、腰、肩六条视线里被挡了几条）：不算挡死，但算贵（试玩第 2 轮：开场、送达那一刻少年被一根灯柱劈开）
    const cut = bodyCut(shotTry.x, cy, shotTry.z, t.x, t.z, t.y, t.y + SHOT.boyH, t) + (shot.front ? 0 : bodyCut(shotTry.x, cy, shotTry.z, shot.other.x, shot.other.z, shot.otherFoot, shot.other.y + 0.2, t));
    const people = shot.front ? peopleOnLine(t, shotTry.x, cy, shotTry.z, t.x, t.y + 1.1, t.z, half)
      : peopleOnLine(t, shotTry.x, cy, shotTry.z, t.x, t.y + 1.1, t.z, half) + peopleOnLine(t, shotTry.x, cy, shotTry.z, shot.other.x, shot.other.y - 0.4, shot.other.z, 0);
    // 两个人在画面上叠在一起（一个挡住另一个）也不要：两人方向夹角小于两人身子宽对应的角度算叠
    let overlap = 0;
    if (!shot.front) {
      const d1 = Math.hypot(t.x - shotTry.x, t.z - shotTry.z), d2 = Math.hypot(shot.other.x - shotTry.x, shot.other.z - shotTry.z);
      const a1 = Math.atan2(t.x - shotTry.x, t.z - shotTry.z), a2 = Math.atan2(shot.other.x - shotTry.x, shot.other.z - shotTry.z), da = Math.abs(wrap(a1 - a2));
      if (da < Math.atan(0.3 / d1) + Math.atan(0.3 / d2)) overlap = 25;
    }
    // 挡在视线上的路人页面会整个淡掉（main.ts 的 ghostsFor），两人叠在一起（少年挡住收信人）淡不掉，所以叠比挡贵
    // face：想让镜头朝着哪儿拍（结尾背后是海和灯塔，不是一面墙）：朝向偏得越多越贵
    let face = 0;
    if (shot.face && !shot.front) {
      const mx = (t.x + shot.other.x) / 2, mz = (t.z + shot.other.z) / 2, a1 = Math.atan2(mx - shotTry.x, mz - shotTry.z), a2 = Math.atan2(shot.face.x - mx, shot.face.z - mz);
      face = 12 * (1 - Math.cos(wrap(a1 - a2))) / 2;
    }
    // 反打（从收信人肩后拍）看不见收信人的脸（试玩第 2 轮：许婆那封只看得见她的后脑勺）：再加一点代价，只在别的机位都挡人时才用
    return people * 7 + overlap + cut * 3 + face + (Math.abs(alt) > 100 ? 3 : 0) + Math.abs(alt) * 0.04 + extra * 0.5 + (1 - kd) * 2 + (low ? 1.5 : 0) + shotTry.distanceTo(out.pos) * 0.15;
  };
  /** 挑机位：左右两侧 × 几个角度 × 几档距离里最划算的；都不行就不切过去（shot.none）。 */
  const pickSide = (t: CamTarget, tall: boolean) => {
    let best = Infinity;
    for (const low of [false, true]) {
      for (const kd of SHOT.ks) {
        for (const sd of [1, -1]) for (const alt of SHOT.alts) { const v = shotCost(t, tall, sd, alt, kd, low); if (v < best) { best = v; shot.side = sd; shot.th = alt; shot.kd = kd; shot.low = low; } }
        // 远的那一档有干净的就不试更近的
        if (best < 7) break;
      }
      if (best < 7) break;
    }
    shot.none = best === Infinity;
    if (shot.none) { shot.side = 1; shot.th = 0; shot.kd = 1; shot.low = false; }
    return best;
  };
  const shotBad = (t: CamTarget, tall: boolean) => shot.none || shotCost(t, tall, shot.side, shot.th, shot.kd, shot.low) >= 7;
  let shotCheck = 0;

  const api = {
    state: c,
    /** 调试：每个候选双人机位的代价（检查脚本、排查用）。 */
    shotCosts(t: CamTarget, tall: boolean) { const r: [number, number, number, boolean, number][] = []; for (const low of [false, true]) for (const kd of SHOT.ks) for (const sd of [1, -1]) for (const alt of SHOT.alts) r.push([sd, alt, kd, low, shotCost(t, tall, sd, alt, kd, low)]); return r; },
    /** 画面宽高比（页面改尺寸时调）。 */
    setAspect(a: number) { if (Number.isFinite(a) && a > 0) aspect = a; },
    /**
     * 换机位：{ other } 是和这个人说话的双人机位（头顶下一点的位置，foot 是他脚下多高，不给就按站着的人估）；{ front: true } 是一个人的正面机位；null 回到身后跟随。
     */
    setShot(s: { other: { x: number; y: number; z: number; foot?: number }; shift?: number; lift?: number; face?: { x: number; z: number } } | { front: true } | null) {
      if (!s) { shot.on = false; shot.shift = 0; shot.lift = 0; shot.face = null; return; }
      shot.front = 'front' in s;
      if ('other' in s) { shot.shift = s.shift ?? 0; shot.lift = s.lift ?? 0; if (!shot.on || !s.face !== !shot.face) shot.face = s.face ?? null; }
      if ('other' in s) { shot.other.set(s.other.x, s.other.y, s.other.z); shot.otherFoot = s.other.foot ?? s.other.y - 1.42; }
      if (!shot.on) { shot.on = true; shot.side = 0; }
    },
    /** 镜头「本来」朝哪（去掉为了躲人、躲墙偏开的那一点角度）：方向键、摇杆按它算前后左右，偏开的那点不把人带歪。 */
    get baseYaw() { return wrap(c.yaw - c.pYaw - c.bias); },
    /** 站着不动时转到 yaw 方向的身后（走起来就不管了）。 */
    recenter(yaw: number) { turnTo = Number.isFinite(yaw) ? yaw : null; },
    /** 这一回谈话找不到能把两个人都装下的机位（镜头留在少年身后、对着说话的人）。 */
    get shotNone() { return shot.on && shot.none; },
    /** 调试：这一回选中的双人机位（哪一侧、偏几度、距离几档、是不是低机位）。 */
    get shotPick() { return { side: shot.side, th: shot.th, kd: shot.kd, low: shot.low }; },
    /** 直接切到双人 / 正面机位（开场第一帧）。 */
    snapShot() { if (shot.on) shot.k = 1; },
    /** 别的人在动（走着的人被叫住会再挪一点）：只更新他的位置，不重挑侧。 */
    moveOther(x: number, y: number, z: number) { shot.other.set(x, y, z); shot.otherFoot = y - 1.42; },
    get shotting() { return shot.on || shot.k > 0.001; },
    /** 机位过渡到几成（0 是跟随，1 是双人 / 正面）。 */
    get shotK() { return shot.k; },
    /** 一出现就在该在的地方（传送、读档之后）：方向对着他的朝向，距离直接收到不钻墙的那一点。 */
    reset(t: CamTarget, tall: boolean) {
      const rig = tall ? RIG.tall : RIG.wide;
      Object.assign(c, { yaw: t.heading, yv: 0, y: t.y, lift: 0, side: 0, facingT: 0, fov: rig.fov, dip: 0, bias: 0, biasWant: 0, biasT: 0, bv: 0, need: 0, want: rig.back, lv: 0, sv: 0, climb: t.climb ? 1 : 0, cv: 0, tight: 0, pYaw: 0, pYawWant: 0, pLift: 0, pLiftWant: 0, pT: 0, blockedBy: 0, hy: rig.up, hv: 0, crowd: 0, pBack: 1, pBackWant: 1, rdir: 0, rox: 0, roz: 0, ty: 0, tyv: 0, rk: world.rail?.(t.x, t.z) ? 1 : 0, duck: 0, dv: 0 });
      c.back = Math.max(RIG.near, probe(t, c.yaw, rig.back, t.y + rig.up).hard);
      // 一出现就躲开挡着的人（开场邮差和小狗就在他身边）：直接摆到挑好的机位，不慢慢转过去
      if (t.people?.length) { peopleDodge(t, 0, rig, t.y + rig.up); c.pYaw = c.pYawWant; c.pLift = c.pLiftWant; c.crowd = c.pLiftWant > 0 ? 1 : 0; c.pBack = c.pBackWant; c.yaw += c.pYaw; c.back = Math.max(RIG.near, Math.min(rig.back * c.pBack, probe(t, c.yaw, rig.back, t.y + rig.up).hard)); }
      c.hy = wantHy(rig); c.hv = 0;
      // 在街上：一出现就顺着街（离他朝向近的那一头）
      const rail = world.rail?.(t.x, t.z);
      if (rail) { const ax = Math.atan2(rail.dx, rail.dz); c.yaw = Math.abs(wrap(t.heading - ax)) <= Math.PI / 2 ? ax : wrap(ax + Math.PI); }
      // 站着把弹簧走一秒，摆到稳下来的机位（不然传送后第一帧是「探到哪算哪」的近机位：M1 验收 r2 的站位扫描两成半贴在 2 米内就是这个）
      // 双人机位过渡到几成照原样留着（开场结束时传送转身，镜头从双人机位慢慢回到身后，不是一刀切）
      const k0 = shot.k, on0 = shot.on;
      place(t, tall);
      for (let i = 0; i < 60; i++) api.update({ ...t, speed: 0 }, 1 / 60, tall, true);
      shot.k = k0; shot.on = on0;
      return out;
    },
    /** 每帧：t 是少年插值过的样子，moving 是不是在走（有没有输入），still 是「减少动态效果」。 */
    update(t: CamTarget, dt: number, tall: boolean, still: boolean) {
      const rig = tall ? RIG.tall : RIG.wide;
      // 沿街轨道：「他往哪走」按街的方向算（离他朝向近的那一头，差过 100° 才换边）；镜头往街中线收
      const rail = world.rail?.(t.x, t.z) ?? null;
      let heading = t.heading, roxWant = 0, rozWant = 0;
      if (rail) {
        const ax = Math.atan2(rail.dx, rail.dz);
        if (c.rdir === 0) c.rdir = Math.abs(wrap(c.yaw - ax)) <= Math.PI / 2 ? 1 : -1;
        const cur = c.rdir > 0 ? ax : wrap(ax + Math.PI);
        if (t.speed > 0.3 && Math.abs(wrap(t.heading - cur)) > RAIL_FLIP) c.rdir = -c.rdir;
        heading = c.rdir > 0 ? ax : wrap(ax + Math.PI);
        // 他离中线 side 米：镜头往中线挪 pull 成（街的左手法向是 (-dz, dx)）。
        // 只在镜头已经顺着街的时候挪（按对齐程度的平方）：刚拐进街、镜头还横在他侧面时往中线挪，等于把镜头推到他身上（贴到 0.9 米、俯角 55°）
        const align = Math.max(0, Math.cos(wrap(c.yaw - heading))) ** 2;
        roxWant = rail.dz * rail.side * rail.pull * align; rozWant = -rail.dx * rail.side * rail.pull * align;
      } else c.rdir = 0;
      const rk = toward(3, dt);
      c.rox += (roxWant - c.rox) * rk; c.roz += (rozWant - c.roz) * rk;
      c.rk += ((rail ? 1 : 0) - c.rk) * toward(2.5, dt);
      // 说着话、又找不到双人机位：跟随机位转到少年身后、对着说话的人（不等「迎面走来先不追」那一秒）
      const aim = shot.on && shot.none && !shot.front;
      if (aim) heading = Math.atan2(shot.other.x - t.x, shot.other.z - t.z);
      for (let left = Math.min(dt, 0.1); left > 1e-6; left -= 1 / 120) {
        const h = Math.min(left, 1 / 120);
        // 方向：走着才追他的朝向；迎面走来先不追，满一秒再慢慢绕
        // 在街上站着也顺着街摆（送完信、说完话镜头还横在摊位那边时，转回顺着街：M2 验收竖屏夜市送完后贴在后脑勺 1.7 米）
        const d = wrap(heading - c.yaw), moving = t.speed > 0.3 || aim || (!!rail && !shot.on && turnTo === null);
        if (t.speed > 0.3) turnTo = null;
        let target = c.yaw, rateCap: number = RIG.maxRate;
        if (moving) {
          // 在街上不等：街的方向已经按他朝哪走选好了那一头，镜头横在侧面只会是刚拐进来，直接转到他身后
          if (Math.abs(d) > RIG.facing && !rail && !aim) { c.facingT += h; if (c.facingT > RIG.facingWait) { target = heading + c.bias + c.pYaw; rateCap = RIG.facingRate; } }
          else { c.facingT = 0; target = heading + c.bias + c.pYaw; if (rail) rateCap = RAIL_TURN; }
        } else if (turnTo !== null && !shot.on) {
          // 说完话、送完信、拨完钟：站着也慢慢转回身后（朝下一个要去的方向），不停在少年正面（试玩第 1 轮）
          c.facingT = 0; target = turnTo + c.bias + c.pYaw; rateCap = RIG.facingRate * 1.6;
          if (Math.abs(wrap(target - c.yaw)) < 0.03) turnTo = null;
        } else { c.facingT = 0; if (Math.abs(c.bias - c.biasWant) > 1e-3 || Math.abs(c.biasWant) > 0 || Math.abs(c.pYawWant - c.pYaw) > 1e-3) target = c.yaw + (c.biasWant - c.bias) + (c.pYawWant - c.pYaw); }
        // 往旁边转开的那一点角度慢慢变（每秒最多 0.7 弧度；身后紧挨着就有东西时快一点，1.6），不跳
        const br = c.want < RIG.near + 0.2 ? 1.6 : 0.7;
        c.bias += Math.max(-br * h, Math.min(br * h, c.biasWant - c.bias));
        const dd = wrap(target - c.yaw), w = RIG.omega;
        const acc = Math.max(-RIG.maxAccel, Math.min(RIG.maxAccel, -2 * w * c.yv + w * w * dd));
        c.yv = Math.max(-rateCap, Math.min(rateCap, c.yv + acc * h));
        if (!moving && Math.abs(dd) < 1e-3) c.yv *= 1 - toward(10, h);
        c.yaw = wrap(c.yaw + c.yv * h);
        // 高度：跟着他（平滑过）的脚下走
        c.y += (t.y - c.y) * toward(RIG.yRate, h);
      }
      spring(c, 'climb', 'cv', t.climb ? 1 : 0, 2.5, dt);
      // 距离：探身后能退多远；收近快、放远慢；底线是不钻进去
      const camY = c.y + upOf(rig) + c.climb * CLIMB_UP;
      // 在街上镜头往中线挪过：探身后、往旁边让都从挪过的那条线上探（不然他靠着摊位走时，探针擦着遮阳篷就算撞，镜头被压近抬高）
      const tp = rail ? { ...t, x: t.x + c.rox, z: t.z + c.roz } : t;
      let p = probe(tp, c.yaw, rig.back, camY);
      // 身后在镜头那个高度被挡（夜市街口的牌坊横匾、屋檐），低一截却退得开：镜头降下来从底下穿过去，不贴在后脑勺上
      // （M2 验收：竖屏夜市送完信，镜头贴在少年脑后 1.7 米）。降多少用弹簧追，不一跳
      // 竖屏机位高（离脚 3.3 米），降 1.4 米还在树冠里（M3 验收 r1：后巷大榕树的树冠离地 2.2–6 米，竖屏镜头一路被压到 1.3 米）：再试一档贴着树冠底下（离脚 1.45 米）
      let duck = 0;
      if (!t.climb && p.hard < RIG.narrow) {
        for (const low of new Set([Math.max(c.y + DUCK_MIN, camY - 1.4), c.y + DUCK_MIN])) {
          const pl = probe(tp, c.yaw, rig.back, low);
          if (pl.hard > p.hard + 1.2) { duck = camY - low; p = pl; break; }
        }
      }
      spring(c, 'duck', 'dv', duck, duck > c.duck ? 6 : 2.5, dt);
      // 往下躲了以后，往两边转、往旁边让、抬高都按躲下来的那个高度探（不然竖屏在树冠里按原来的高度探，哪边都没地方，镜头被拧到侧面去）
      const camAt = camY - Math.max(duck, c.duck);
      peopleDodge(t, dt, rig, camAt);
      // 身后被房子、树挡得只剩一点：每 0.25 秒往两边各探两个角度，哪边空得多就把镜头往那边转开一点（最多 0.8 弧度），宽敞了再转回来
      c.biasT -= dt;
      if (c.biasT <= 0 || (p.hard < RIG.near && c.biasT < 0.17)) {
        c.biasT = 0.25;
        const base = c.yaw - c.bias;
        let best = 0, bestRoom = probe(tp, base, rig.back, camAt).hard;
        // 连最近那一点都没有（身后紧贴着山、墙）：放宽到绕到侧面、前面
        if (bestRoom < rig.back - 0.8 && !rail) for (const off of bestRoom < RIG.near ? BIAS_WIDE : BIAS_OFFS) {
          const room = probe(tp, base + off, rig.back, camAt).hard;
          if (room > bestRoom + 1.0 + Math.abs(off) * 0.5) { bestRoom = room; best = off; }
        }
        // 已经转开了、原来那个方向仍然挤：保持（不左右来回）
        c.biasWant = best !== 0 ? best : bestRoom < rig.back - 0.8 && Math.abs(c.biasWant) > 0 && !rail && probe(tp, base + c.biasWant, rig.back, camAt).hard > bestRoom + 0.6 ? c.biasWant : 0;
      }
      // 距离：二阶的弹簧（收近快、放远慢），速度是连续的，路过一棵树不会「咔」地一下贴上来；真要钻进去了才每帧最多再收 0.15 米
      // 想退多远也先抹平一下（探针是 0.2 米一格的，贴着一排东西走时会一格一格地跳）
      const raw = Math.max(RIG.near, Math.min(rig.back, Math.max(p.soft, p.hard - 0.25)));
      c.want += (raw - c.want) * toward(raw < c.want ? 10 : OUT.want, dt);
      const want = c.want;
      // 目标不超过真要碰到的那一点（抹平只管往外放，往里收以 hard 为底线）
      const floor = Math.max(RIG.near, p.hard), target = Math.max(RIG.near, Math.min(want * c.pBack, floor));
      for (let left = Math.min(dt, 0.1); left > 1e-6; left -= 1 / 120) {
        const h = Math.min(left, 1 / 120), w = target < c.back ? 8 : OUT.spring;
        c.bv += (w * w * (target - c.back) - 2 * w * c.bv) * h;
        c.back += c.bv * h;
      }
      c.back = Math.max(RIG.near * 0.85, c.back);
      // 最近那一点也不空：往两边让；没事了慢慢回到正后方
      let side = 0;
      if (p.hard < RIG.near && blocked(tp, tp.x - Math.sin(c.yaw) * RIG.near, tp.z - Math.cos(c.yaw) * RIG.near, 0.2, camAt)) side = dodge(tp, c.yaw, camAt, c.side) ?? c.side;
      spring(c, 'side', 'sv', side, Math.abs(side) > Math.abs(c.side) ? 7 : 2.5, dt);
      // 窄处升高：身后距离被压短了抬高一点；他身后紧挨着就有东西（隔着墙角、山坡看不见他）就抬到看得见为止。
      // 抬起来那一点也要不在树冠、屋檐里，不然就不抬，交给网点淡掉
      // 在街上固定高度跟拍：身后近了也不抬（抬就抬到棚顶上了），只有身后紧挨着就看不见他时才抬
      let lift = rail ? 0 : Math.min(RIG.liftMax, Math.max(0, (RIG.narrow - c.back) * RIG.liftPer));
      if (p.hard < RIG.near) for (let up = 0.4; up <= 2.4; up += 0.4) if (probe(tp, c.yaw, RIG.near, camAt + up).hard >= RIG.near - 1e-6) { lift = Math.max(lift, up); break; }
      if (lift > 0) {
        const cx = tp.x - Math.sin(c.yaw) * c.back, cz = tp.z - Math.cos(c.yaw) * c.back;
        while (lift > 0.05 && hides(cx, cz, 0.3, upOf(rig) - Math.max(duck, c.duck) + lift)) lift -= 0.2;
        lift = Math.max(0, lift);
      }
      // 他站在矮一截的地方（码头台阶上、台地边下面），从这儿看过去腿被前面的地面边挡住：再抬一点，抬到看得见腿（俯角上限照旧管着）
      {
        const cx = t.x - Math.sin(c.yaw) * c.back, cz = t.z - Math.cos(c.yaw) * c.back, base = camY + c.pLift;
        if (legsHidden(t, cx, cz, base + lift)) for (let up = 0.3; up <= 1.8; up += 0.3) if (!legsHidden(t, cx, cz, base + lift + up)) { lift += up; break; }
      }
      spring(c, 'lift', 'lv', lift, lift > c.lift ? 5 : 2.2, dt);
      c.tight += ((p.hard < RIG.near ? 1 : 0) - c.tight) * toward(4, dt);
      // 高度也用二阶弹簧追（俯角上限跟着距离变，距离一收高度就得跟着降；直接跟会一顿一顿的）
      const hyWant = wantHy(rig);
      spring(c, 'hy', 'hv', hyWant, hyWant < c.hy ? 9 : 4, dt);
      // 硬上限：距离收得比高度降得快（竖屏机位高，山上、窄处一下被压到 1.6 米），弹簧跟不上的那几帧俯角会冲到 50–65°（M1 验收 r3 小问题 6）——
      // 不管弹簧追到哪，镜头都不高过 FOLLOW_EL_MAX
      const hyMax = 1 + Math.hypot(c.back, c.side) * Math.tan(((FOLLOW_EL_MAX + c.climb * 14) * Math.PI) / 180);
      if (c.hy > hyMax) { c.hy = hyMax; c.hv = Math.min(0, c.hv); }
      // 站在高处（山顶、台地边）往前看：前面的地面低下去多少，看的点就往下压一点（不然满屏是天）
      let drop = 0;
      for (const d of [5, 9, 14, 20]) { const g = world.top(t.x + Math.sin(c.yaw) * d, t.z + Math.cos(c.yaw) * d); drop = Math.max(drop, t.y - (g > -1e9 ? g : 0)); }
      c.dip += (Math.min(1.3, Math.max(0, drop - 1.2) * 0.18) - c.dip) * toward(1.5, dt);
      const fovWant = Math.min(86, rig.fov + (still ? 0 : Math.max(0, t.speed - 2.4) * 1.6));
      c.fov += (fovWant - c.fov) * toward(3, dt);
      // 最后一道：镜头周围半米的地形比镜头还高（哪儿都躲不开时）就抬起来（抬得快、放得慢，不切地形）
      {
        const sx = Math.sin(c.yaw), sz = Math.cos(c.yaw), cx = t.x - sx * c.back + sz * c.side + c.rox, cz = t.z - sz * c.back - sx * c.side + c.roz;
        const need = t.climb ? 0 : Math.max(0, topRing(cx, cz) + TERRAIN_CLEAR - (c.y + c.hy));
        spring(c, 'ty', 'tyv', need, need > c.ty ? 14 : 2.5, dt);
        if (c.ty < need - 0.15) c.ty = need - 0.15;
        // 抬也不抬过俯角硬上限：走到山脚、点进山坡里（路停在坡脚）时镜头被山压到 1.4 米内，再为躲身边的坡抬 1.2 米就成了 60° 往下扎（M1 验收 r3 小问题 6，竖屏）。
        // 宁可让镜头身边那一点坡（在镜头侧后方，网点淡掉）近一点
        const hyMax = 1 + Math.hypot(c.back, c.side) * Math.tan(((FOLLOW_EL_MAX + c.climb * 14) * Math.PI) / 180);
        if (c.hy + c.ty > hyMax) { c.ty = Math.max(0, hyMax - c.hy); c.tyv = Math.min(0, c.tyv); }
      }
      place(t, tall);
      // 双人 / 正面机位：在跟随机位上按过渡的进度插值（位置、看的点、视野一起）；找不到能装下两个人的机位时不切过去（shot.none）
      const rate = dt / (still ? 0.15 : 0.6);
      shot.k = Math.max(0, Math.min(1, shot.k + (shot.on && !shot.none ? rate : -rate)));
      if (shot.on) {
        if (shot.side === 0 || (shotCheck -= dt) <= 0) {
          shotCheck = 0.6;
          // 中途被挡了（有人走进来、人挪了装不下）才重挑；重挑的结果要明显更好才换（不来回跳）
          if (shot.side === 0) pickSide(t, tall);
          else if (shotBad(t, tall)) {
            const keep = { side: shot.side, th: shot.th, kd: shot.kd, low: shot.low, none: shot.none }, now = keep.none ? Infinity : shotCost(t, tall, keep.side, keep.th, keep.kd, keep.low);
            if (pickSide(t, tall) > now - 7) Object.assign(shot, keep);
          }
        }
        if (!shot.none && twoShotAt(t, tall, shot.side, shot.th, shot.kd, shot.pos, shot.look, shot.low) === Infinity) shotCheck = 0;
        shot.fov = shotFov(tall);
      }
      if (shot.k > 0) {
        // 过渡按「绕着他转」插值（方位角走短的那边、水平距离和高度各自线性），不走直线：两个机位在他两侧时，直线插值会从他头顶上穿过去，
        // 中途贴到 1.6 米、俯角 51°（M2 验收：船坞送完信转身走开那一下）
        const e = shot.k * shot.k * (3 - 2 * shot.k);
        const a0 = Math.atan2(out.pos.x - t.x, out.pos.z - t.z), a1 = Math.atan2(shot.pos.x - t.x, shot.pos.z - t.z);
        const r0 = Math.hypot(out.pos.x - t.x, out.pos.z - t.z), r1 = Math.hypot(shot.pos.x - t.x, shot.pos.z - t.z);
        const a = a0 + wrap(a1 - a0) * e, r = r0 + (r1 - r0) * e;
        out.pos.set(t.x + Math.sin(a) * r, out.pos.y + (shot.pos.y - out.pos.y) * e, t.z + Math.cos(a) * r);
        out.look.lerp(shot.look, e); out.fov += (shot.fov - out.fov) * e;
      }
      if (!shot.on && shot.k === 0) shot.side = 0;
      return out;
    },
    /** 镜头实际朝哪（方向键、摇杆按这个算「前」；沿街轨道把镜头往中线挪过，和 c.yaw 差一点）。 */
    get yaw() { return Math.atan2(out.look.x - out.pos.x, out.look.z - out.pos.z); },
  };
  return api;
}
export type WalkCam = ReturnType<typeof createWalkCam>;
