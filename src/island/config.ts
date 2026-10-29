/** 小岛 3D 首页的全部可调参数。改观感、改手感、改性能预算都先来这里。 */

/** 软陶 · 海岛色：圆角粘土质感 + 海玻璃绿 / 沙滩黄 / 灯塔红白。 */
export const PALETTE = {
  sand: '#f1dfb6',
  sandWet: '#e3cd9c',
  grass: '#a7cf96',
  upper: '#97c387',
  path: '#efe2c4',
  rock: '#c9c0aa',
  mountain: '#85b27b',
  mountain2: '#74a36d',
  tree: ['#5f9a6a', '#7db57a', '#4f8a64', '#f0b8b0'],
  trunk: '#8a6a4a',
  wall: '#fbf5e8',
  wallWarm: '#f6e7cf',
  roofRed: '#d65a4a',
  roofBlue: '#3f88a6',
  roofYellow: '#e9b350',
  roofGreen: '#5aa58c',
  trim: '#2f5d55',
  seaShallow: '#35d2cb',
  seaMid: '#17a3c8',
  seaDeep: '#1c5fbf',
  foam: '#ffffff',
  /** 水下：海底细沙、礁石、海草（暗/亮）、礁石上的珊瑚两色、鹿角珊瑚（根/梢）、海星两色、夜光浪花；水下生物（蝠鲼、礁鲨身/鳍尖、鹞鲼、蓝点魟底/蓝点、金黄水母伞/条纹/触手、蝠鲼肩斑和鹞鲼白点、鱼群、海豚、水母伞/四叶环）。 */
  seabed: '#ead6a5',
  reefRock: '#5b7470',
  seagrass: ['#2f7a52', '#7fc077'],
  coral: ['#c98a7c', '#9c8fbf'],
  branchCoral: ['#2c6a64', '#8fd0c0'],
  starfish: ['#f08a4b', '#3d7fd6'],
  manta: '#24323c',
  shark: ['#c4cfcd', '#1d2328'],
  eagleRay: '#26323d',
  stingray: ['#b5a65e', '#3a92ea'],
  goldJelly: ['#f39a45', '#c9552c', '#f7c09a'],
  creaturePale: '#e8eeee',
  fishSchool: '#4f7484',
  dolphin: '#6c8ca4',
  jelly: ['#f4fbff', '#e6a3c4'],
  seaGlow: '#3fe6cc',
  lhWhite: '#fbf5e8',
  lhRed: '#d65a4a',
  wood: '#b58a5e',
  woodDark: '#8a6845',
  hull: '#fbf5e8',
  sail: '#fffdf6',
  glass: '#4f6d70',
  glow: '#ffcf87',
  paper: '#fffaf0',
  cloud: '#ffffff',
  stone: '#d8cdb4',
  soil: '#7a5a3e',
  flowers: ['#d65a4a', '#e9b350', '#f0b8b0', '#b58ad6', '#fffaf0'],
} as const;

/** 主岛轮廓半径（米）。岛的所有坐标都按它设计，改了要同步改地点坐标。 */
export const ISLAND_RADIUS = 30;
/** 三层台地的顶面高度：沙滩 / 草地 / 上层台地。 */
export const LEVEL = { sand: 0.9, grass: 2.0, upper: 4.6 } as const;
/** 上层台地相对主岛的缩放与中心。 */
export const UPPER = { s: 0.42, cx: -6, cz: -6 } as const;

/** 相机：只改目标值，每帧用 1-exp(-k·dt) 追过去（帧率无关的指数平滑）。 */
export const CAMERA = {
  /** 竖直视场角（度）。窄屏会自动加大，让横向能放下整座岛。 */
  fov: 32,
  /** 横屏按 1.6 的宽高比保视野；竖屏只按 1.0 补（再补岛就太小）；两者之间平滑过渡。 */
  fovRefAspect: 1.6,
  fovRefAspectPortrait: 1.0,
  fovBlend: [0.8, 1.2] as const,
  /** 平滑系数：约 0.55 秒追上 95%。数值越大越跟手，越小越"飘"。 */
  smoothing: 5.5,
  /** 开场俯冲用更慢的平滑系数，约 2 秒落到全岛。 */
  introSmoothing: 1.6,
  /** 松手惯性的衰减率（1/秒）：约等于 60fps 下每帧保留 90%。 */
  inertiaDamping: 6.3,
  /** 松手前这么多毫秒内还在拖，才保留惯性。 */
  inertiaReleaseMs: 80,
  /** 惯性速度上限（弧度/秒），防止一次猛甩转好几圈。 */
  inertiaMax: 6,
  rotatePerPx: 0.006,
  tiltPerPx: 0.004,
  tiltMin: 0.1,
  tiltMax: 1.38,
  distMin: 16,
  distMax: 240,
  /** 注视点离岛心的最大水平距离，防止拖进空海里；高度上限同理。 */
  lookRadiusMax: 80,
  lookYMax: 12,
  /** 位移超过这么多像素才算拖动，否则算点击。 */
  clickSlopPx: 6,
  /** 滚轮：单次增量上限（像素）、普通滚轮与触控板捏合的缩放灵敏度。 */
  wheelClampPx: 120,
  wheelZoom: 0.0014,
  pinchZoom: 0.01,
  /** 键盘：方向键每次转多少、+/- 每次缩放倍率。 */
  keyRotate: 0.15,
  keyTilt: 0.08,
  keyZoom: 0.85,
} as const;

/** 渲染与性能预算。 */
export const RENDER = {
  pixelRatioDesktop: 1.5,
  pixelRatioMobile: 1.25,
  shadowMapDesktop: 2048,
  shadowMapMobile: 1024,
  /** 无交互多少秒后进入省电模式（降到约 30fps）。 */
  idleSeconds: 8,
  /** 连续多少秒平均帧率低于该值就自动降一档画质。取 24 而不是 40：
   *  iOS 低电量和 Safari 省电会把刷新率锁到 30，不能误判成性能差。 */
  degradeFps: 24,
  degradeWindowSeconds: 3,
  /** 太阳方向变化超过这个角度（弧度）才重算一次静态阴影。 */
  shadowRefreshAngle: 0.02,
} as const;

/** 夜间发光强度系数（乘以 night 0–1）。 */
export const NIGHT_GLOW = { window: 3.2, bulb: 4, lamp: 30, screenBase: 0.15, screen: 0.9 } as const;
/** 路灯里真正打光的只有前几盏（点光源对每个像素都有开销，手机上更少）。 */
export const LAMP_LIGHTS = { desktop: 6, mobile: 2 } as const;
/**
 * 点画布：点中的位置离某个地点多近（水平米数，约等于一栋房子的半宽）算点中它；
 * 远景里灯塔只有十几像素宽，容易点偏到背后的地面，所以屏幕上离楼身 screenPx 以内也算点中。
 * 都没点中就把镜头飞过去，每点一次拉近到当前距离的 zoom 倍，但不会比 distMin 更近（再近就看不全一栋房子）。
 */
export const TAP_FOCUS = { pickRadius: 5, screenPx: 40, zoom: 0.55, distMin: 26 } as const;
/** 跟随新文章船时的镜头距离与俯仰。 */
export const SHIP_FOLLOW = { dist: 42, tilt: 0.34 } as const;
/** 屏幕顶部被导航栏占住的高度（像素）：路牌躲开它，手机端聚焦时也按它算可见区域。 */
export const TOP_RESERVED_PX = 72;

/** 布局断点：窄于它按手机处理（卡片改底部抽屉、默认静态封面）。 */
export const MOBILE_MAX_WIDTH = 720;

/** 预设视角：注视点、距离、方位角、俯仰角。 */
export interface View { look: [number, number, number]; dist: number; az: number; tilt: number }
export const VIEWS: Record<'all' | 'harbor' | 'cape' | 'sea', View & { name: string }> = {
  all: { name: '全岛', look: [3, 3, 8], dist: 150, az: 0.62, tilt: 0.6 },
  harbor: { name: '港湾', look: [-2, 3, 17], dist: 72, az: 0.3, tilt: 0.46 },
  cape: { name: '灯塔岬', look: [24, 6, 2], dist: 52, az: 1.45, tilt: 0.3 },
  sea: { name: '群岛航线', look: [4, 2, 22], dist: 135, az: 2.75, tilt: 0.16 },
};
/** 竖屏（手机）的全岛视角：更近、更俯视，让主岛占满画面。 */
export const VIEW_ALL_PORTRAIT: View = { look: [5, 3, 5], dist: 128, az: 0.62, tilt: 0.86 };
/** 钓鱼视角：站在周伯身后、越过码头尽头看海。 */
export const FISH_VIEW: View = { look: [-0.6, 0.5, 46], dist: 25, az: Math.PI + 0.35, tilt: 0.4 };
/** 竖屏的钓鱼视角：退远一点、更正对着海，周伯和浮标都在画面里。 */
export const FISH_VIEW_PORTRAIT: View = { look: [-0.6, 0.5, 44], dist: 34, az: Math.PI + 0.12, tilt: 0.4 };
export const INTRO_FROM: View = { look: [0, 3, 0], dist: 230, az: -0.35, tilt: 1.15 };
