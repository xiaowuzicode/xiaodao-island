/**
 * 钓鱼的物种表：码头前能钓上来的每种东西——在哪一圈、什么时候出没、多稀有、影子什么形状、换几枚贝壳、钓上来怎么收场。
 * 还有「今日鱼讯」（按本地日期挑一种稀有生物，当天出现得多）和三种特饵（引来特定的生物）。
 * 这里只有数据和挑选规则，不碰场景；fishing.ts 按这张表放鱼影、算咬钩、开卡片，fishing-book.ts 按它画图鉴。
 */
import type { Materials } from '@/island/geo';
import type { Creature } from '@/island/creature-models';
import { goldfishModel } from '@/island/creature-models';
import { bottleModel, crabModel, lanternfishModel, marlinModel, octopusModel, pufferModel, turtleModel } from '@/island/fishing-models';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legend' | 'junk';
export const RARITY_NAME: Record<Rarity, string> = { common: '常见', uncommon: '少见', rare: '稀有', legend: '传说', junk: '杂项' };
/** 水面影子的形状（fishing.ts 按形状画贴图）；bottle 不画影子，直接漂在水面上。 */
export type ShadowShape = 'fish' | 'round' | 'crab' | 'turtle' | 'octopus' | 'long' | 'bottle';
export type BaitKey = 'shrimp' | 'glow' | 'big';

export interface Species {
  id: string;
  name: string;
  rarity: Rarity;
  /** 平时待在离码头尽头多远的一圈（米）。 */
  band: readonly [number, number];
  /** 什么时候出没：night 只在夜里，day 只在白天。 */
  when: 'any' | 'day' | 'night';
  /** 新游进来时挑中它的权重（同一时刻满足条件的物种之间比）。 */
  weight: number;
  shadow: ShadowShape;
  /** 影子长度（米）、游速倍数（螃蟹、海龟慢）。 */
  len: number;
  speed: number;
  /** 钓上来时模型放多大、厘米区间、换几枚贝壳。 */
  scale: number;
  cm: readonly [number, number];
  shells: number;
  /** 咬钩后要拉扯几下才拉得上来（0 = 点一下就上来）。 */
  pulls: number;
  /** 钓上来怎么收场：进鱼桶，还是放生回海里。 */
  keep: boolean;
  /** 卡片上的一句话；图鉴里没钓到过时显示的出没提示。 */
  say: string;
  hint: string;
  model: (mats: Materials) => Creature;
  /** 在鱼桶里怎么摆：绕 z 转多少（头朝 +x 的模型转 -90° 就头朝下、尾巴翘出来）、多大、往上抬多少。 */
  bucket: { tilt: number; scale: number; lift: number };
  /** 拉上来时鼓成球（河豚）。 */
  puff?: boolean;
}

const HEAD_DOWN = { tilt: -Math.PI / 2 + 0.25, scale: 0.3, lift: -0.02 } as const;

export const SPECIES: readonly Species[] = [
  { id: 'goldfish-s', name: '小金鱼', rarity: 'common', band: [6, 15], when: 'any', weight: 35, shadow: 'fish', len: 1.3, speed: 1, scale: 0.7, cm: [12, 20], shells: 1, pulls: 0, keep: true,
    say: '码头边最常见的小家伙。', hint: '近处，随时都有', model: goldfishModel, bucket: HEAD_DOWN },
  { id: 'goldfish', name: '金鱼', rarity: 'common', band: [11, 22], when: 'any', weight: 25, shadow: 'fish', len: 1.8, speed: 1, scale: 1, cm: [20, 32], shells: 3, pulls: 0, keep: true,
    say: '中等个头，尾巴甩得很有劲。', hint: '中圈，随时都有', model: goldfishModel, bucket: HEAD_DOWN },
  { id: 'goldfish-l', name: '大金鱼', rarity: 'uncommon', band: [19, 30], when: 'any', weight: 14, shadow: 'fish', len: 2.6, speed: 1, scale: 1.35, cm: [32, 48], shells: 6, pulls: 0, keep: true,
    say: '外圈的大个子，鱼线够长才够得着。', hint: '外圈，鱼线要够长', model: goldfishModel, bucket: HEAD_DOWN },
  { id: 'crab', name: '螃蟹', rarity: 'common', band: [4.5, 9], when: 'any', weight: 14, shadow: 'crab', len: 1.1, speed: 0.45, scale: 0.8, cm: [8, 16], shells: 2, pulls: 0, keep: true,
    say: '码头桩边横着走，夹住鱼饵就不撒手。', hint: '码头桩边的浅水', model: crabModel, bucket: { tilt: 0.5, scale: 0.42, lift: 0.04 } },
  { id: 'puffer', name: '河豚', rarity: 'rare', band: [11, 22], when: 'day', weight: 4, shadow: 'round', len: 1.2, speed: 0.8, scale: 1, cm: [18, 30], shells: 8, pulls: 2, keep: true,
    say: '一拉出水就气鼓鼓地胀成了一个球。', hint: '白天，中圈', model: pufferModel, bucket: HEAD_DOWN, puff: true },
  { id: 'lantern', name: '灯笼鱼', rarity: 'rare', band: [14, 28], when: 'night', weight: 5, shadow: 'fish', len: 1.6, speed: 0.9, scale: 1, cm: [24, 40], shells: 8, pulls: 2, keep: true,
    say: '头顶挑着一盏小灯，夜里在水下一闪一闪。', hint: '夜里，外圈', model: lanternfishModel, bucket: HEAD_DOWN },
  { id: 'octopus', name: '章鱼', rarity: 'rare', band: [19, 30], when: 'night', weight: 4, shadow: 'octopus', len: 1.7, speed: 0.7, scale: 1, cm: [40, 70], shells: 10, pulls: 2, keep: true,
    say: '八条腿缠住了鱼饵，进桶还要伸出一条来张望。', hint: '夜里，外圈', model: octopusModel, bucket: { tilt: -Math.PI / 2, scale: 0.36, lift: 0.02 } },
  { id: 'turtle', name: '海龟', rarity: 'rare', band: [19, 30], when: 'any', weight: 3, shadow: 'turtle', len: 2.2, speed: 0.5, scale: 1.1, cm: [60, 90], shells: 12, pulls: 2, keep: false,
    say: '桶装不下它，放生了——它游远之前回头看了你一眼。', hint: '外圈，游得很慢', model: turtleModel, bucket: HEAD_DOWN },
  { id: 'marlin', name: '旗鱼', rarity: 'legend', band: [25, 30], when: 'any', weight: 1.5, shadow: 'long', len: 3.4, speed: 1.3, scale: 1.3, cm: [150, 240], shells: 20, pulls: 3, keep: true,
    say: '背上一面大帆，是这片海里最快的鱼。', hint: '最外圈，鱼线要升到很长', model: marlinModel, bucket: { tilt: -Math.PI / 2 + 0.15, scale: 0.22, lift: 0.02 } },
  { id: 'bottle', name: '漂流瓶', rarity: 'junk', band: [8, 26], when: 'any', weight: 3, shadow: 'bottle', len: 0.8, speed: 0.15, scale: 1.4, cm: [30, 30], shells: 2, pulls: 0, keep: true,
    say: '瓶子里塞着一卷纸，是岛上写过的一篇文章。', hint: '海面上漂着，甩到瓶子边上就能勾住', model: bottleModel, bucket: { tilt: Math.PI / 2 - 0.3, scale: 0.55, lift: 0 } },
];

export const byId = (id: string) => SPECIES.find((s) => s.id === id);
export const isRare = (s: Species) => s.rarity === 'rare' || s.rarity === 'legend';

/** 今日鱼讯从这几种里挑。 */
const FEATURED = ['puffer', 'lantern', 'octopus', 'turtle', 'marlin'] as const;
/** 今日鱼讯点名的那种出现权重翻几倍；装上对路的特饵翻几倍。 */
const FEATURED_BOOST = 2;
const BAIT_BOOST = 3;

/** 本地日期 YYYY-MM-DD（跨过本地零点就换一天）。 */
export function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 今日鱼讯：按日期算一个固定的序号，同一天谁打开都一样。 */
export function featured(day: string): Species {
  let h = 0;
  for (const ch of day) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return byId(FEATURED[h % FEATURED.length])!;
}

export function featuredNews(day: string, night: boolean) {
  const s = featured(day);
  const where = s.band[0] + s.band[1] >= 38 ? '外圈' : '中圈';
  if (s.when === 'night' && !night) return `今日鱼讯：今晚${where}有${s.name}出没`;
  if (s.when === 'day' && night) return `今日鱼讯：${s.name}白天才出来，明早${where}见`;
  return `今日鱼讯：今天${where}${s.name}多`;
}

export interface Bait { key: BaitKey; name: string; price: number; targets: readonly string[]; say: string }
export const BAITS: readonly Bait[] = [
  { key: 'shrimp', name: '虾饵', price: 3, targets: ['crab', 'octopus'], say: '螃蟹、章鱼爱吃' },
  { key: 'glow', name: '亮饵', price: 4, targets: ['lantern'], say: '夜里引灯笼鱼' },
  { key: 'big', name: '大饵', price: 5, targets: ['goldfish-l', 'marlin'], say: '引大金鱼、旗鱼' },
];
export const baitTargets = (b: BaitKey | null) => (b ? BAITS.find((x) => x.key === b)!.targets : []);

/** 物种平时待的那一圈的中点落在 zone（离码头尽头多远，米）里，就算这一圈的。 */
export const inZone = (s: Species, zone: readonly [number, number]) => { const c = (s.band[0] + s.band[1]) / 2; return c >= zone[0] && c < zone[1]; };

/**
 * 新游进来一条：在这一圈（zone）、满足时段条件的物种里按权重挑（每一圈都有常见的兜底，挑不空）。鱼塘里已经有稀有/传说的就不再来第二条，漂流瓶同理；
 * 今日鱼讯点名的、对上特饵的，权重加倍。
 */
export function pickSpecies(o: { zone: readonly [number, number]; night: boolean; day: string; bait: BaitKey | null; hasRare: boolean; hasBottle: boolean; rnd?: () => number }): Species {
  const hot = featured(o.day).id, lure = baitTargets(o.bait);
  const pool = SPECIES.filter((s) => inZone(s, o.zone) && (s.when === 'any' || (s.when === 'night') === o.night) && !(o.hasRare && isRare(s)) && !(o.hasBottle && s.id === 'bottle'));
  const w = pool.map((s) => s.weight * (s.id === hot ? FEATURED_BOOST : 1) * (lure.includes(s.id) ? BAIT_BOOST : 1));
  let r = (o.rnd ?? Math.random)() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) if ((r -= w[i]) < 0) return pool[i];
  return pool[0];
}
