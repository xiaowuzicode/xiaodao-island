/**
 * 小岛邮差：街面小物件摆在哪（纯计算，页面、碰撞、检查脚本用同一份）。只在邮差页有，首页、滑板页不摆。
 * 三处「主角区」：码头（台阶上下、栈桥、两侧沙滩）、码头广场和东街开头、岛刊社背后的后巷。每样东西：种类、位置、朝向（局部 +x 是它的长边）。
 * 自检规则（check:walk 第 21 条）：不在房子占地里、不在海里（水里的木桩反过来）；挡人的不压路面；离岛民的站位、按日程走的路、老岛民的路线、
 * 干活的人都留出空当（岛民不会绕开东西走，压在他们路上就会穿模）；摆完以后全岛照样走得通（第 2、3 条）。
 */
export type DecorZone = 'dock' | 'plaza' | 'lane';
export type DecorKind =
  | 'crate' | 'crates' | 'basket' | 'baskets' | 'rope' | 'bollard' | 'barrel' | 'buoys' | 'netRack' | 'lobsterPot' | 'lobsterPots' | 'bike' | 'mailbox'
  | 'chalkboard' | 'cat' | 'bucket' | 'potS' | 'potM' | 'potL' | 'aSign' | 'newsRack' | 'cafe' | 'manhole' | 'bin' | 'broom' | 'planter' | 'laundry'
  | 'papers' | 'carton' | 'mop' | 'fishTray' | 'meter' | 'jar' | 'stool' | 'pile' | 'lifebuoy' | 'oars' | 'catOnCrate' | 'bunting';

/**
 * 每种东西的「占地」：r 是半径（长条的是半宽），len 是长边全长（沿局部 x）。
 * low：整个都矮于 0.45 米（不挡人，一步跨过去；低档画质不画）。wall：挂在墙上的（不查站位、不查地面）。water：立在水里的（反过来要求脚下是海）。
 * road：可以压在路面上（井盖）。poles：只有两头落地（彩旗、晾衣绳的两根杆子），中间悬空（晾衣绳拉在 2.75 米、衣服最低垂到 2.2 米，人从底下走过去，横屏镜头也从底下过）。
 */
export interface KindInfo { r: number; len?: number; low?: boolean; wall?: boolean; water?: boolean; road?: boolean; poles?: boolean }
export const KINDS: Record<DecorKind, KindInfo> = {
  crate: { r: 0.36 }, crates: { r: 0.36, len: 0.62 }, basket: { r: 0.26, low: true }, baskets: { r: 0.28, len: 0.5 }, rope: { r: 0.26, low: true }, bollard: { r: 0.16, low: true },
  barrel: { r: 0.3 }, buoys: { r: 0.32, low: true }, netRack: { r: 0.22, len: 2.1 }, lobsterPot: { r: 0.26, len: 0.36, low: true }, lobsterPots: { r: 0.3, len: 0.36 },
  bike: { r: 0.2, len: 1.5 }, mailbox: { r: 0.22 }, chalkboard: { r: 0.32 }, cat: { r: 0.16, low: true }, bucket: { r: 0.18, low: true },
  potS: { r: 0.2, low: true }, potM: { r: 0.28 }, potL: { r: 0.36 }, aSign: { r: 0.32 }, newsRack: { r: 0.25, len: 0.8 }, cafe: { r: 0.85 },
  manhole: { r: 0.36, low: true, road: true }, bin: { r: 0.26 }, broom: { r: 0.15 }, planter: { r: 0.22, len: 1.3 }, laundry: { r: 0.25, len: 3, poles: true },
  papers: { r: 0.28, low: true }, carton: { r: 0.32 }, mop: { r: 0.25 }, fishTray: { r: 0.4, len: 1.3 }, meter: { r: 0.2, wall: true }, jar: { r: 0.36 },
  stool: { r: 0.2, low: true }, pile: { r: 0.15, water: true }, lifebuoy: { r: 0.3, wall: true }, oars: { r: 0.2, len: 1.6, low: true },
  catOnCrate: { r: 0.36 },
  // 彩旗：两头各一根细旗杆，中间的绳子和小旗挂在 2.4 米以上（只查两根杆子落脚的地方）
  bunting: { r: 0.12, poles: true },
};

/** 一样东西：种类、位置、朝向（弧度，局部 +x 转到哪）、属于哪个区；len 可以改长条的长度（晾衣绳）。 */
export interface Decor { kind: DecorKind; x: number; z: number; rot: number; zone: DecorZone; len?: number; v?: number }

const d = (zone: DecorZone, kind: DecorKind, x: number, z: number, rot = 0, extra: Partial<Decor> = {}): Decor => ({ zone, kind, x, z, rot, ...extra });
const PI = Math.PI, H = PI / 2;

/**
 * 码头：台阶顶东边那一溜草地（信箱、鱼价黑板、木箱、鱼筐）、台阶顶西边的小草地（龙虾笼、桨、木桶、自行车）、
 * 栈桥根两侧的沙滩（晾网架、浮球、龙虾笼、缆绳、木箱上的猫）、栈桥两边（系船桩、缆绳、木箱、救生圈、水桶）、水里几根拴船的木桩。
 */
const DOCK: Decor[] = [
  d('dock', 'mailbox', 2.95, 21.0, PI), d('dock', 'chalkboard', 6.0, 21.1, PI - 0.25), d('dock', 'crates', 7.05, 21.1, 0.05),
  d('dock', 'baskets', 8.3, 21.2, 0), d('dock', 'bike', -4.65, 19.75, 0.1),
  d('dock', 'lobsterPots', -3.2, 20.5, 0.5), d('dock', 'oars', -4.55, 20.95, 0.1), d('dock', 'barrel', -2.95, 19.75),
  d('dock', 'netRack', 3.55, 25.55, 0.05), d('dock', 'buoys', 5.35, 25.6), d('dock', 'lobsterPot', 6.45, 25.6, 0.1), d('dock', 'rope', 1.9, 25.4),
  d('dock', 'crate', -2.7, 25.35, -0.2), d('dock', 'catOnCrate', -3.5, 25.15, 0.6),
  // 栈桥上：贴着两边（局部 |x| ≥ 1.15），中间留 1.4 米宽的走道；避开站着看海的人（站位在 ±0.9）和桥边的立柱（±1.4，每 3.6 米一根）
  d('dock', 'bollard', 1.25, 25.35), d('dock', 'rope', 1.18, 26.6), d('dock', 'bucket', 1.2, 27.45),
  d('dock', 'crate', -1.2, 27.5, 0.2), d('dock', 'basket', -1.18, 29.0), d('dock', 'lobsterPot', -1.2, 30.0, H),
  d('dock', 'rope', 1.18, 30.4), d('dock', 'basket', 1.18, 31.05), d('dock', 'rope', -1.18, 32.4), d('dock', 'crates', -1.22, 33.95, 1.4),
  d('dock', 'crate', 1.2, 35.85, -0.25), d('dock', 'bollard', 1.25, 36.9), d('dock', 'bucket', -1.2, 36.4), d('dock', 'baskets', 1.18, 38.05, 0.3),
  d('dock', 'lifebuoy', 1.58, 31.7, -H), d('dock', 'lifebuoy', -1.58, 28.1, H),
  d('dock', 'pile', 2.45, 27.3), d('dock', 'pile', 2.6, 33.4), d('dock', 'pile', -2.5, 31.6), d('dock', 'pile', -2.35, 36.4),
];

/**
 * 码头广场和东街开头：岛刊社东边那块草地（花盆、自行车、报刊架、立式招牌、木箱）、中街东边的报刊架、
 * 东街南边临崖的草地（花盆、招牌、咖啡小桌、长条花槽、猫），路面上的井盖。
 * （东街北边贴着放映台的木椅，按日程的人从那儿进进出出，摆不下东西。）
 */
const PLAZA: Decor[] = [
  d('plaza', 'potM', 1.75, 13.75), d('plaza', 'bike', 2.3, 12.55, H + 0.05), d('plaza', 'potS', 1.55, 11.65), d('plaza', 'newsRack', 0.95, 14.75, H),
  d('plaza', 'aSign', 2.95, 11.8, -0.4), d('plaza', 'potL', 1.3, 12.6),
  d('plaza', 'newsRack', 5.95, 13.3, H),
  d('plaza', 'potM', 6.95, 17.95), d('plaza', 'aSign', 8.15, 18.2, PI - 0.3), d('plaza', 'potS', 9.15, 17.85), d('plaza', 'cafe', 10.25, 18.95, 0.2),
  d('plaza', 'planter', 9.95, 20.9, 0), d('plaza', 'cat', 11.3, 20.4, -0.6), d('plaza', 'potL', 11.5, 18.5), d('plaza', 'potM', 11.5, 19.45), d('plaza', 'bike', 9.3, 20.1, 0.05),
  d('plaza', 'bunting', 3.95, 17.08, Math.atan2(-(19.75 - 14.4), 6.75 - 1.15), { len: Math.hypot(6.75 - 1.15, 19.75 - 14.4) }),
  d('plaza', 'bunting', 9.18, 19.88, Math.atan2(-(20.0 - 19.75), 11.6 - 6.75), { len: Math.hypot(11.6 - 6.75, 20.0 - 19.75), v: 1 }),
  d('plaza', 'manhole', 8.0, 16.5), d('plaza', 'manhole', 11.2, 15.55), d('plaza', 'manhole', 1.9, 18.55),
];

/**
 * 后巷：岛刊社北墙外（纸箱、旧报纸捆、电表箱、靠墙的自行车、扫帚）、烧烤店背墙边（木桶、木箱上的猫、纸箱、拖把桶、花盆）、电表箱底下（垃圾桶）、
 * 中间那片空地（两道晾衣绳、晒鱼干的架子、水缸、小板凳、花盆）、西头巷口（木箱、水桶、大花盆）。
 * 东头（岛刊社和烧烤店之间那道一米多宽的缝）空着：从中街穿过去就进后巷（M3 验收 r1：原来报刊架和两个垃圾桶把缝两头堵死了，
 * 后巷只能从西街绕进来，「后巷」那个验收机位站在一个四面不通的小角落里）。
 */
const LANE: Decor[] = [
  d('lane', 'carton', -6.45, 10.55, 0.1), d('lane', 'papers', -5.75, 10.6, 0.15), d('lane', 'papers', -5.15, 10.62, -0.2), d('lane', 'meter', -4.3, 11.02, PI),
  d('lane', 'bike', -3.35, 10.55, 0.02), d('lane', 'broom', -2.25, 10.8, 0), d('lane', 'bin', -4.6, 10.62),
  d('lane', 'barrel', -1.18, 9.45), d('lane', 'catOnCrate', -1.2, 8.6, -H), d('lane', 'carton', -1.18, 7.75, -H + 0.2), d('lane', 'mop', -1.25, 6.95), d('lane', 'potM', -1.3, 6.3),
  d('lane', 'laundry', -8.05, 8.75, 0.06, { len: 3.0 }), d('lane', 'laundry', -4.2, 7.55, -0.05, { len: 2.6, v: 1 }),
  d('lane', 'fishTray', -9.85, 6.95, 0.15), d('lane', 'crate', -7.3, 7.25, 0.3), d('lane', 'jar', -10.55, 9.85), d('lane', 'stool', -4.35, 9.35), d('lane', 'stool', -3.55, 9.6), d('lane', 'bucket', -9.1, 9.95),
  d('lane', 'potS', -6.3, 7.0), d('lane', 'potM', -5.6, 6.85), d('lane', 'potS', -2.6, 6.75), d('lane', 'cat', -6.7, 9.1, 1.2), d('lane', 'barrel', -11.0, 8.6),
  d('lane', 'crates', -11.9, 10.4, 0.3), d('lane', 'potM', -12.3, 7.25), d('lane', 'bucket', -11.45, 11.0),
];

export const DECOR: Decor[] = [...DOCK, ...PLAZA, ...LANE];
/** 三个主角区各自的采样点（检查「镜头里随时有十来样」用）：位置、看的方向（弧度，atan2(dx, dz)；0 朝南 +z）——都是玩家走在这一区时自然会朝的方向。 */
export const DECOR_SAMPLES: Record<DecorZone, [number, number, number][]> = {
  dock: [[1.1, 19.4, 0], [0, 23.5, 0], [0, 27, 0], [0, 31, PI], [0, 35, PI], [0, 22.5, PI]],
  plaza: [[3.2, 18.6, PI], [4, 14.6, PI], [4.4, 12, -H], [5.2, 16.2, H], [7.5, 16.5, 1.0], [9.5, 16.4, -H]],
  lane: [[-0.5, 10.5, -H], [-3, 9, -H], [-6, 8.2, -H], [-9.5, 9, H], [-5, 8.2, H], [-11.5, 9.2, H]],
};

/** 长条的东西沿局部 x 的两个端点（世界坐标）。 */
export function decorEnds(o: Decor): [[number, number], [number, number]] {
  const len = o.len ?? KINDS[o.kind].len ?? 0, c = Math.cos(o.rot), s = Math.sin(o.rot), hx = (len / 2) * c, hz = -(len / 2) * s;
  return [[o.x - hx, o.z - hz], [o.x + hx, o.z + hz]];
}
/** 点到这样东西占地的距离（减去半径；在里面为负）。 */
export function decorDist(o: Decor, x: number, z: number) {
  const [[ax, az], [bx, bz]] = decorEnds(o), vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
  const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * vx + (z - az) * vz) / l2)) : 0;
  return Math.hypot(x - ax - vx * t, z - az - vz * t) - KINDS[o.kind].r;
}
