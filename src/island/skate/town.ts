/**
 * 滑板小游戏专用的街道拓宽：把路线两旁贴得太近的几栋房子、夜市的摊位往后挪一点，街面宽了，镜头才能留在街上、不用升到屋顶上面去拍。
 * 只在这个页面生效——这个文件只被滑板的代码引用，首页不加载它，岛的布局数据（layout.ts）本身一个字没改。
 * 做法：模块一加载就把布局里对应的那几项坐标改掉（民居、店铺、岛刊社、摊位，连同它们的占地和「不种树」的圈），
 * 之后建岛、算路线、查镜头读到的都是挪过的位置。挪过的房子有没有压路、悬空、撞到别的房子，check:skate 会查。
 */
import { FOOTPRINTS, HOMES, KEEP_CLEAR, PRESS_POS, SHOPS } from '@/island/layout';
import { LANE_DIR, MARKET_LANE, MARKET_STALLS } from '@/island/market-plan';

/** 民居（按 layout.HOMES 的序号）、店铺（按种类）各挪多少（dx, dz，米）；岛刊社往北退；摊位各往街外退。 */
const HOME_MOVES: Record<number, [number, number]> = { 5: [0, 1.3], 0: [0, -0.9], 4: [0, 0.8] };
const SHOP_MOVES: Record<string, [number, number]> = { bbq: [-0.6, 0], mart: [-0.75, -0.5] };
const PRESS_MOVE: [number, number] = [0, -0.7];
const STALL_BACK = 0.7;

/** 挪过的占地的名字（检查脚本逐个查它们）。 */
export const MOVED: string[] = [];
function shift(id: string, old: [number, number], dx: number, dz: number) {
  const f = FOOTPRINTS.find((x) => x.id === id);
  if (f) { f.x += dx; f.z += dz; MOVED.push(id); }
  for (const k of KEEP_CLEAR) if (Math.abs(k[0] - old[0]) < 1e-6 && Math.abs(k[1] - old[1]) < 1e-6) { k[0] += dx; k[1] += dz; }
}

let done = false;
/** 幂等：不管被引用多少次只挪一遍。 */
export function widenStreets() {
  if (done) return;
  done = true;
  for (const [i, [dx, dz]] of Object.entries(HOME_MOVES)) {
    const h = HOMES[+i], old: [number, number] = [h[0], h[1]];
    h[0] += dx; h[1] += dz;
    shift(`home${i}`, old, dx, dz);
  }
  for (const s of SHOPS) {
    const m = SHOP_MOVES[s[3]];
    if (!m) continue;
    const old: [number, number] = [s[0], s[1]];
    s[0] += m[0]; s[1] += m[1];
    shift(`shop-${s[3]}`, old, m[0], m[1]);
  }
  const old: [number, number] = [PRESS_POS[0], PRESS_POS[1]];
  PRESS_POS[0] += PRESS_MOVE[0]; PRESS_POS[1] += PRESS_MOVE[1];
  shift('press', old, PRESS_MOVE[0], PRESS_MOVE[1]);
  // 夜市：两排摊位各往外退，街面从三米七宽到五米出头
  const [fx, fz] = MARKET_LANE.from;
  for (const s of MARKET_STALLS) {
    const along = (s.x - fx) * LANE_DIR[0] + (s.z - fz) * LANE_DIR[1], px = fx + LANE_DIR[0] * along, pz = fz + LANE_DIR[1] * along;
    const len = Math.hypot(s.x - px, s.z - pz) || 1, dx = ((s.x - px) / len) * STALL_BACK, dz = ((s.z - pz) / len) * STALL_BACK;
    const was: [number, number] = [s.x, s.z];
    s.x += dx; s.z += dz;
    shift(`stall${s.slot}`, was, dx, dz);
  }
}
widenStreets();
