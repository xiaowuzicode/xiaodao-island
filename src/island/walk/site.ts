/**
 * 小岛邮差：少年要撞的「世界」（纯计算，不碰 DOM）：地面（ground.ts）+ 看得见的东西都撞得到（照滑板页 solid.ts 的做法把岛再搭一遍筛进网格，
 * 外加邮差页自己的木梯和街面小物件）+ 房子的占地（放映台前那片木椅的整块占地不算，椅子一把把各自挡人）。
 * 页面、找路、检查脚本用同一份。
 */
import { FOOTPRINTS, type Footprint } from '@/island/layout';
import { hideVillage, resetVillage } from '@/island/village';
import { buildSolids, type Solids } from '@/island/skate/solid';
import { initGround, keepPathsClear, nearNotch, onClimb, terrainTop, walkGround } from '@/island/walk/ground';
import { buildWalkDecor } from '@/island/walk/decor';
import { buildLadders } from '@/island/walk/ladders';
import type { MoverWorld } from '@/island/walk/mover';

/**
 * 封掉的夹缝：房子后墙和别的东西之间只有一人宽的死胡同，走路控制器挤得进去、找路网格（0.25 米一格）认不出来——
 * 走进去以后点地面就没反应。轴对齐的矩形 [x0, z0, x1, z1]。
 * - 中街东侧一栋房子的后墙和商店之间（3.6–4.4, 5.7–8.6）：check:walk 第 4 条乱走的种子 7 走进去过。
 */
const SEALED: [number, number, number, number][] = [[3.6, 5.7, 4.4, 8.6]];
const sealed = (x: number, z: number, r: number) => SEALED.some(([x0, z0, x1, z1]) => x > x0 - r && x < x1 + r && z > z0 - r && z < z1 + r);

/** 邮差页不摆的村里小景（照常占地，见 village.ts 的 hideVillage）：后巷空地上的大榕树。页面搭岛之前也要调一次（main.ts）。 */
export const WALK_HIDES_VILLAGE = ['banyan'] as const;

/** 房子占地的栅格：0.1 米一格，盖住岛心周围 ±48 米。 */
const FP = { cell: 0.1, half: 48, n: 960 } as const;

export interface Site extends MoverWorld {
  solid: Solids;
  /** (x, z) 周围 r 米内有没有房子（占地）。 */
  walled(x: number, z: number, r: number): boolean;
}

function rasterFootprints(): Uint8Array {
  const grid = new Uint8Array(FP.n * FP.n);
  const inFp = (f: Footprint, x: number, z: number) => {
    if (f.r !== undefined) return Math.hypot(x - f.x, z - f.z) < f.r;
    const c = Math.cos(f.rot ?? 0), s = Math.sin(f.rot ?? 0), dx = x - f.x, dz = z - f.z;
    return Math.abs(dx * c - dz * s) < (f.w ?? 0) / 2 && Math.abs(dx * s + dz * c) < (f.d ?? 0) / 2;
  };
  for (const f of FOOTPRINTS) {
    if (f.id === 'cinema-chairs') continue;
    const reach = f.r ?? Math.hypot(f.w ?? 0, f.d ?? 0) / 2;
    const i0 = Math.max(0, Math.floor((f.x - reach + FP.half) / FP.cell)), i1 = Math.min(FP.n - 1, Math.floor((f.x + reach + FP.half) / FP.cell));
    const j0 = Math.max(0, Math.floor((f.z - reach + FP.half) / FP.cell)), j1 = Math.min(FP.n - 1, Math.floor((f.z + reach + FP.half) / FP.cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (inFp(f, i * FP.cell - FP.half + FP.cell / 2, j * FP.cell - FP.half + FP.cell / 2)) grid[j * FP.n + i] = 1;
  }
  return grid;
}

/** 搭一遍（页面里在 buildWorld 之后调：先清掉村里小景的摆放记录，第二遍才摆得和画面里一样）。 */
export function buildSite(): Site {
  initGround();
  resetVillage();
  hideVillage(...WALK_HIDES_VILLAGE);
  // 地面高度：站不了人的地方（码头台阶口子两侧、台地倒边）按看得见的地面算——原来给 null，立在那儿的东西整个不进网格
  // （试玩第 2 轮：码头台阶口那根灯柱镜头不知道，开场双人机位隔着它拍，从正中把画面劈开；人也能穿过去）
  const floor = (x: number, z: number) => { const g = walkGround(x, z); if (g !== null) return g; const t = terrainTop(x, z); return Number.isFinite(t) ? t : null; };
  const solid = buildSolids(null, floor, keepPathsClear, (mats, root) => { buildLadders(mats, root); buildWalkDecor(mats, root, { solids: true }); }, nearNotch);
  const fp = rasterFootprints();
  const walled = (x: number, z: number, r: number) => {
    const i0 = Math.floor((x - r + FP.half) / FP.cell), i1 = Math.floor((x + r + FP.half) / FP.cell), j0 = Math.floor((z - r + FP.half) / FP.cell), j1 = Math.floor((z + r + FP.half) / FP.cell);
    if (i0 < 0 || j0 < 0 || i1 >= FP.n || j1 >= FP.n) return false;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (!fp[j * FP.n + i]) continue;
      const cx = Math.max(i * FP.cell - FP.half, Math.min(x, (i + 1) * FP.cell - FP.half)), cz = Math.max(j * FP.cell - FP.half, Math.min(z, (j + 1) * FP.cell - FP.half));
      if ((cx - x) ** 2 + (cz - z) ** 2 < r * r) return true;
    }
    return false;
  };
  return { solid, walled, ground: walkGround, climb: onClimb, blocked: (x, z, r) => solid.blocks(x, z, r) || walled(x, z, r) || sealed(x, z, r) };
}
