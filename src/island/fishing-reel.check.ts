/**
 * 收线手感检查：bun run check:fishing
 * 用固定的随机数模拟几种玩法，确认张力条的难度没被改坏：
 * - 小鱼一直按着就能拉上来（不冲、不断线）；
 * - 稀有的一直按着不松会断线；冲的时候松手、冲完再按，能拉上来；
 * - 传说的旗鱼手感满级、会松手也能拉上来；
 * - 上钩后一直不按，过一会儿鱼溜掉。
 */
import { SPECIES, byId, type Species } from '@/island/fishing-species';
import { TENSION, startReel, stepReel, surging, type ReelResult } from '@/island/fishing-reel';

const DT = 1 / 60;
const LIMIT = 30;
const problems: string[] = [];

/** 固定种子的伪随机（mulberry32），每次检查结果一样。 */
function seeded(seed: number) {
  let a = seed;
  return (lo: number, hi: number) => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return lo + (((t ^ (t >>> 14)) >>> 0) / 4294967296) * (hi - lo);
  };
}

/** 按 policy 决定每一帧按不按，跑到出结果；返回结果和用时（秒）。反应慢 react 秒：看见冲了才松手、冲完才再按。 */
function play(sp: Species, level: number, policy: 'hold' | 'smart' | 'idle', seed: number, react = 0.2): [ReelResult, number] {
  const rng = seeded(seed);
  const r = startReel(sp, level, rng);
  let seen = 0;
  for (let t = 0; t < LIMIT; t += DT) {
    const s = surging(r);
    // seen > 0：冲了多久；seen < 0：冲完多久（冲一开始、一结束都从 0 计）
    seen = s ? Math.max(0, seen) + DT : Math.min(0, seen) - DT;
    const holding = policy === 'hold' ? true : policy === 'idle' ? false : !(s ? seen > react : seen > -react);
    const res = stepReel(r, DT, holding, rng);
    if (res !== 'go') return [res, r.t];
  }
  return ['go', LIMIT];
}

const expect = (what: string, got: ReelResult, want: ReelResult) => { if (got !== want) problems.push(`${what}：应该 ${want}，实际 ${got}`); };

for (const sp of SPECIES.filter((s) => TENSION.surge.force[s.rarity] === 0)) {
  for (let seed = 1; seed <= 20; seed++) {
    const [res, t] = play(sp, 0, 'hold', seed);
    expect(`${sp.name} 一直按着（种子 ${seed}）`, res, 'landed');
    if (t > 3) problems.push(`${sp.name} 一直按着要 ${t.toFixed(1)} 秒，小鱼太费劲`);
  }
}
for (const id of ['puffer', 'lantern', 'octopus', 'turtle', 'marlin']) {
  const sp = byId(id)!;
  let snapped = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const [res] = play(sp, 0, 'hold', seed);
    if (res === 'snapped') snapped++;
    // 反应 0.2 秒内松手：手感 0 级也要能拉上来（大鱼按满级算，传说的本来就该先升级）
    const level = sp.rarity === 'legend' ? 4 : 0;
    expect(`${sp.name} 冲时松手（手感 ${level + 1} 级，种子 ${seed}）`, play(sp, level, 'smart', seed)[0], 'landed');
  }
  if (snapped < 18) problems.push(`${sp.name} 一直按着不松，20 次里只断了 ${snapped} 次——冲得不够狠`);
}
expect('上钩后一直不按', play(byId('goldfish')!, 0, 'idle', 1)[0], 'slack');

if (problems.length) {
  console.error(`收线检查发现 ${problems.length} 处问题：\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('收线检查通过：小鱼按住就上来，稀有的要会松手，一直不按会溜');
