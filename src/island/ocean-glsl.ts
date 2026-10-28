/**
 * 海面着色器片段（注入到 MeshStandardMaterial，见 ocean.ts）。
 * 思路照热带浅海的样子来：透过水看得见海底（沙纹、海草、珊瑚礁石），阳光在海底打出焦散，
 * 越深越被水"吃掉"红光、只剩蓝绿；水面细浪给太阳碎闪和折射晃动；夜里浪花和游过的生物泛蓝绿荧光。
 * 水下生物（蝠鲼、礁鲨、鱼群、水母、海豚）的形状在 creatures-glsl.ts。
 * 全部在一个 pass 里算完，不多渲染一遍场景。手机定义 OCEAN_LITE：省掉珊瑚礁石和太阳碎闪这两块最贵的
 *（2560×1600 实测完整版比旧海面每帧多约 1.8ms）。
 */
import { CREATURES_HEAD } from '@/island/creatures-glsl';
import { HULL_ASPECT } from '@/island/sea-surface';

/** 同时能看见几圈点水面的涟漪（再点就顶掉最早那圈）。 */
export const TAP_RIPPLES = 3;
/** 着色器里最多画几个浮物的接触白沫、几条船的尾迹（ocean.ts 超出会报错）。 */
export const FLOATER_SLOTS = 24;
export const WAKE_SLOTS = 6;

/**
 * 浮物接触白沫：f = (x, z, 朝向角, 尺寸)，尺寸 > 0 是圆（半径），< 0 是船身（半长），0 表示这一格没东西。
 * 船尾迹：w = (x, z, 航向角, 航速 米/秒)；两道开尔文 V 形浪臂（半角约 20°）+ 船尾中间一道碎白浪，越往后越淡。
 */
const FLOATERS = /* glsl */ `
float contactFoam(vec2 p){
  float f = 0.;
  for (int i = 0; i < ${FLOATER_SLOTS}; i++) {
    vec4 c = uFloaters[i];
    if (c.w == 0.) continue;
    vec2 q = toLocal(p, vec4(c.xy, c.z, 0.));
    float L = abs(c.w), W = c.w > 0. ? L : L * ${HULL_ASPECT.toFixed(2)};
    if (abs(q.x) > L + 1.2 || abs(q.y) > W + 1.2) continue;
    float d = (length(q / vec2(L, W)) - 1.) * W, n = oNoise(p * 3. + uTime * .8);
    // 船身：船头推起的浪最白最宽，船尾只剩一点；圆的（浮标、桩子）一圈均匀
    float bow = c.w > 0. ? 1. : .35 + .65 * smoothstep(-.6, .9, q.x / L);
    f = max(f, (1. - smoothstep(0., (.2 + .35 * n) * (.6 + .6 * bow), d)) * smoothstep(-.25, 0., d) * bow * (.7 + .3 * n));
  }
  return f; }
float boatWakes(vec2 p){
  float f = 0.;
  for (int i = 0; i < ${WAKE_SLOTS}; i++) {
    vec4 b = uWakes[i];
    if (b.w < .05) continue;
    vec2 q = toLocal(p, vec4(b.xy, b.z, 0.));
    float back = -q.x - 1.2, len = 5. + b.w * 4.5;
    if (back < -2.5 || back > len || abs(q.y) > .9 + max(back, 0.) * .4) continue;
    float fade = exp(-max(back, 0.) / len * 2.8), broken = smoothstep(.3, .62, oNoise(p * 2.4 + uTime * .4));
    float arms = (1. - smoothstep(.06, .28, abs(abs(q.y) - (.55 + max(back, 0.) * .36)))) * smoothstep(-.5, .6, back)
      * smoothstep(.25, .55, oNoise(vec2(back * 1.3 - uTime * .5, q.y * 2.)));
    float trail = (1. - smoothstep(.25, .55 + max(back, 0.) * .05, abs(q.y))) * smoothstep(-.6, .2, back);
    f = max(f, (arms * .75 + trail * broken) * fade * clamp(b.w / 2.5, 0., 1.));
  }
  return f; }
`;

/** 值噪声与分形噪声：海底花纹、浪花破碎都用它。 */
const NOISE = /* glsl */ `
float oHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 oHash2(vec2 p){ float h = oHash(p); return vec2(h, oHash(p + h * 17.13 + 3.1)); }
float oNoise(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(oHash(i), oHash(i + vec2(1, 0)), u.x), mix(oHash(i + vec2(0, 1)), oHash(i + vec2(1, 1)), u.x), u.y); }
float oFbm(vec2 p){ return oNoise(p) * .55 + oNoise(p * 2.07 + 7.3) * .3 + oNoise(p * 4.3 + 1.7) * .15; }
`;

/** 离岸距离 → 水深（米）：近岸一片缓坡浅滩，16 米外是礁缘陡坎，再往外是深海。 */
const DEPTH = /* glsl */ `
float seaDepth(float d){ return .2 + d * .38 + smoothstep(8., 17., d) * 9. + max(d - 17., 0.) * .8; }
`;

/** 水面细浪的坡度（不位移顶点，只给法线和折射用）。 */
const RIPPLES = /* glsl */ `
vec2 rippleGrad(vec2 p, float t){
  p += vec2(oNoise(p * .23), oNoise(p * .23 + 5.2)) * 2.5;
  vec2 k1 = vec2(4.6, 1.3), k2 = vec2(-1.9, 3.7), k3 = vec2(2.4, -2.9), k4 = vec2(-6.3, -3.1);
  return k1 * cos(dot(k1, p) - t * 2.1) * .012 + k2 * cos(dot(k2, p) - t * 1.7) * .015
       + k3 * cos(dot(k3, p) - t * 1.9) * .013 + k4 * cos(dot(k4, p) - t * 2.6) * .006; }
`;

/**
 * 点水面的涟漪：从点击处一圈圈往外推（每秒 3.2 米），4 秒内衰减完；
 * 往 grad 里加径向坡度（折射、碎闪跟着晃），返回外沿浪峰的白度（夜里就是一圈荧光）。
 */
const TAP_RING = /* glsl */ `
float tapRings(vec2 p, inout vec2 grad){
  float crest = 0.;
  for (int i = 0; i < ${TAP_RIPPLES}; i++) {
    float age = uTime - uTaps[i].z;
    if (age < 0. || age > 4.) continue;
    vec2 dv = p - uTaps[i].xy;
    float r = length(dv), front = age * 3.2;
    if (r > front + .5) continue;
    float env = exp(-age * .9) * smoothstep(front + .3, front - .3, r) * smoothstep(0., .4, r) * exp(-max(front - r, 0.) * .35);
    float w = sin(r * 5. - age * 16.) * env;
    grad += dv / max(r, .001) * w * .6;
    crest += smoothstep(.35, .9, w) * smoothstep(front - 2.2, front, r) + (1. - smoothstep(.0, .25, abs(r - front))) * env * .8;
  }
  return crest; }
`;

/** 焦散：三层斜着错开的格子取最近距离，叠出会流动的亮网。 */
const CAUSTICS = /* glsl */ `
float caustics(vec2 p, float t){
  const mat3 m = mat3(-2., -1., 2., 3., -2., 1., 1., 2., 2.);
  vec3 a = m * vec3(p * .62, t * .5) * .5, b = m * a * .4, c = m * b * .3;
  return pow(min(min(length(.5 - fract(a)), length(.5 - fract(b))), length(.5 - fract(c))), 7.) * 25.; }
`;

/**
 * 海底：沙纹 + 近岸碎石打底；大片海草床（一缕缕顺着水流的草叶，边缘压一圈暗影，像比沙地高一截）；
 * 每 2.6 米一格最多一件东西：礁石（带接触阴影和斑点）、鹿角珊瑚（放射状分叉、梢头发亮）或小海星。
 */
const SEABED = /* glsl */ `
vec3 grassBed(vec2 p){
  float a = oNoise(p * .05) * 1.6 + .4, blade = 0.;
  for (int k = 0; k < 2; k++) {
    float ak = a + float(k) * .45;
    vec2 dir = vec2(cos(ak), sin(ak)), q = vec2(dot(p, dir), dot(p, vec2(-dir.y, dir.x)));
    float row = q.y * (15. + float(k) * 5.), id = floor(row);
    float seg = oNoise(vec2(q.x * 3.5 + id * 7.3, id * 1.7 + float(k) * 9.));
    blade = max(blade, (1. - smoothstep(.12, .42, abs(fract(row) - .5))) * smoothstep(.32, .5, seg) * (.7 + .3 * oHash(vec2(id, float(k)))));
  }
  float clumps = smoothstep(.2, .8, oNoise(p * 2.6) * .7 + oNoise(p * 6.) * .3);
  return mix(uGrass[0] * .8, uGrass[1], blade * (.5 + .5 * clumps)) * (.85 + .25 * oNoise(p * .5)); }
vec3 sandBed(vec2 p, float depth){
  vec3 sand = uSand * mix(1., .84, oNoise(p * .17));
  sand *= 1. + sin(dot(p, vec2(.8, .6)) * 3.1 + oFbm(p * .3) * 7.) * .09;
  vec2 pc = floor(p * 3.), pf = fract(p * 3.) - .5;
  float peb = step(.86, oHash(pc + 7.)) * (1. - smoothstep(.07, .14, length(pf - (oHash2(pc) - .5) * .5)));
  return mix(sand, uSand * vec3(.58, .54, .48), peb * .85 * (1. - smoothstep(1., 3., depth))); }
/** 一格里的一件东西，叠到 col 上；to 是像素相对它中心的偏移（米），reef 控制只在礁区出现。 */
vec3 reefItem(vec3 col, vec2 p, vec2 to, vec2 id, float reef){
  vec2 h = oHash2(id);
  float kind = oHash(id + 3.7), d = length(to), a = atan(to.y, to.x);
  if (kind < .55) {
    float R = (.35 + h.y * .6) * (1. + .1 * sin(a * 3. + h.y * 30.) + .06 * sin(a * 7. + h.y * 51.));
    col *= 1. - (1. - smoothstep(R * .9, R + .4, d)) * .45 * reef;
    float dome = clamp(1. - d / R, 0., 1.), spots = smoothstep(.45, .8, oNoise(p * 4.5 + id * 3.));
    vec3 c = mix(uRock, oHash(id + 5.) < .5 ? uCoral[0] : uCoral[1], step(.7, oHash(id + 6.)) * .55);
    c *= (.5 + .5 * sqrt(dome) - .22 * dot(to / max(R, .01), vec2(.6, .5))) * (.85 + .3 * spots);
    return mix(col, c, (1. - smoothstep(R - .03, R + .01, d)) * reef);
  }
  if (kind < .87) {
    float R = .65 + h.y * .6, rr = d / R;
    col *= 1. - (1. - smoothstep(.5, 1.25, rr)) * .3 * reef;
    if (rr > 1.1) return col;
    float N = 7. + floor(h.y * 4.);
    float w1 = abs(fract(a * N / 6.2832 + oNoise(vec2(rr * 3., id.x)) * .35) - .5) * 6.2832 / N * d;
    float w2 = abs(fract(a * N / 3.1416 + .25 + oNoise(vec2(rr * 4., id.y)) * .4) - .5) * 3.1416 / N * d;
    float m = max(1. - smoothstep(.04, .07, w1 - .07 * (1. - rr)), (1. - smoothstep(.025, .05, w2 - .03 * (1. - rr))) * smoothstep(.4, .55, rr));
    m = max(m * (1. - smoothstep(.92, 1.05, rr)), 1. - smoothstep(.08, .14, d));
    return mix(col, mix(uBranch[0], uBranch[1], smoothstep(.35, 1., rr)), m * reef);
  }
  float arm = .5 + .5 * cos(a * 5. + h.y * 6.), rs = .2 * (.35 + .65 * arm * arm * arm);
  return mix(col, oHash(id + 8.) < .5 ? uStar[0] : uStar[1], (1. - smoothstep(rs - .02, rs, d)) * reef); }
vec3 seabed(vec2 p, float depth){
  vec3 col = sandBed(p, depth);
  float g = oFbm(p * .07 + 3.1) + (oNoise(p * 1.4) - .5) * .05;
  float grassZone = smoothstep(.6, 1.3, depth) * (1. - smoothstep(8., 11., depth));
  col *= 1. - smoothstep(.44, .52, g) * (1. - smoothstep(.52, .55, g)) * .4 * grassZone;
  col = mix(col, grassBed(p), smoothstep(.52, .55, g) * grassZone);
#ifdef OCEAN_LITE
  return col; }
#else
  float reef = smoothstep(1.2, 2.2, depth) * (1. - smoothstep(13., 16., depth));
  if (reef <= 0.) return col;
  const float CELL = 2.6;
  vec2 cell = floor(p / CELL), fp = fract(p / CELL);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 id = cell + vec2(i, j);
    if (oHash(id + 1.9) < .5) continue;
    col = reefItem(col, p, (fp - vec2(i, j) - .2 - oHash2(id + 9.1) * .6) * CELL, id, reef);
  }
  return col; }
#endif
`;

/** 片元着色器的全局声明（插在 #include <common> 后面）。 */
export const FRAG_HEAD = /* glsl */ `
uniform float uTime; uniform float uExtent; uniform float uNight; uniform sampler2D uShore;
uniform vec3 uShallow; uniform vec3 uMid; uniform vec3 uDeep; uniform vec3 uFoam; uniform vec3 uGlow;
uniform vec3 uSand; uniform vec3 uRock; uniform vec3 uGrass[2]; uniform vec3 uCoral[2]; uniform vec3 uBranch[2]; uniform vec3 uStar[2];
uniform vec3 uAbsorb; uniform vec3 uSunDir; uniform vec4 uTaps[${TAP_RIPPLES}];
uniform vec4 uFloaters[${FLOATER_SLOTS}]; uniform vec4 uWakes[${WAKE_SLOTS}];
varying vec3 vWPos;
${NOISE}${DEPTH}${RIPPLES}${TAP_RING}${CAUSTICS}${SEABED}${CREATURES_HEAD}${FLOATERS}
`;

/** 水体颜色：海底 × 透过率 + 水本身的散射色；再叠浪花。替换 diffuseColor 那一行。 */
export const FRAG_COLOR = (maxDist: number) => /* glsl */ `
vec2 suv = vWPos.xz / uExtent * .5 + .5;
float inside = step(0., suv.x) * step(0., suv.y) * step(suv.x, 1.) * step(suv.y, 1.);
float oD = mix(${maxDist.toFixed(1)}, texture2D(uShore, suv).r * ${maxDist.toFixed(1)}, inside);
float oDepth = seaDepth(max(oD, 0.));
vec3 oView = cameraPosition - vWPos;
float oCamDist = length(oView), oCos = clamp(oView.y / oCamDist, .05, 1.);
float oDetail = 1. - smoothstep(70., 180., oCamDist);
vec2 oGrad = rippleGrad(vWPos.xz, uTime) * oDetail;
float oTapCrest = tapRings(vWPos.xz, oGrad);
float oPath = 1. / sqrt(1. - (1. - oCos * oCos) / 1.77);
vec3 oScatter = mix(mix(uShallow, uMid, smoothstep(.5, 4., oDepth)), uDeep, smoothstep(4., 18., oDepth));
vec3 col = oScatter;
float oLife = 0., oWake = 0.;
if (oDepth < 22.) {
  vec2 bp = vWPos.xz + oGrad * min(oDepth, 4.) * .12;
  vec3 bed = seabed(bp, oDepth);
  float sunAmt = (1. - uNight) * smoothstep(.0, .25, uSunDir.y);
  float oCaust = clamp(caustics(bp, uTime), 0., 2.) * sunAmt * exp(-oDepth * .08);
  bed = bed * (1. + oCaust * .45) + vec3(.9, 1., .95) * oCaust * .4;
  bed *= 1. - creatureShadow(bp, -uSunDir.xz / max(uSunDir.y, .35), oDepth) * .4 * sunAmt;
  vec3 trans = exp(-uAbsorb * oDepth * oPath);
  col = bed * trans + oScatter * (1. - trans);
}
col = drawCreatures(col, oScatter, vWPos.xz + oGrad * .25, oPath, oLife, oWake);
col *= 1. + .14 * smoothstep(.55, 1., sin(dot(vWPos.xz, vec2(.32, .21)) - uTime * 1.1 + oNoise(vWPos.xz * .2) * 3.)) * (1. - smoothstep(10., 25., oD)) * (1. - uNight);
float oBreak = oNoise(vWPos.xz * .7 + uTime * .15);
float bands = sin(oD * 1.6 - uTime * 1.3 + oNoise(vWPos.xz * .15) * 2.5) * .5 + .5;
float foam = smoothstep(.86, 1., bands) * (1. - smoothstep(1.5, 7., oD)) * .7 * smoothstep(.25, .55, oBreak);
foam += 1. - smoothstep(.15, 1. + oBreak * .8, oD);
foam += oWake * .85 + oTapCrest * .9 + contactFoam(vWPos.xz) * .85 + boatWakes(vWPos.xz) * .8;
foam = clamp(foam, 0., 1.);
float oFres = .02 + .98 * pow(1. - oCos, 5.);
col = mix(col, uFoam, foam * .8) * (1. - oFres * .6);
vec4 diffuseColor = vec4(col, opacity);
`;

/** 细浪扰动法线：太阳在浪尖上碎成一片闪光。插在 #include <normal_fragment_maps> 后面。 */
export const FRAG_NORMAL = /* glsl */ `
normal = normalize(normal + mat3(viewMatrix) * vec3(-oGrad.x, 0., -oGrad.y));
`;

/** 自发光：远处掠射角反射天光；夜里浪花、水下生物和零星浮游生物泛蓝绿荧光。插在 #include <emissivemap_fragment> 后面。 */
export const FRAG_EMISSIVE = /* glsl */ `
#ifdef USE_FOG
totalEmissiveRadiance += fogColor * oFres * .3;
#endif
#ifndef OCEAN_LITE
vec3 oN = normalize(vec3(-oGrad.x * 2.2, 1., -oGrad.y * 2.2));
float oSpec = max(dot(reflect(-oView / oCamDist, oN), uSunDir), 0.);
// 阳光碎闪：满海面一颗颗细小亮点各自闪烁，朝着太阳反射方向的更亮
vec2 oGc = floor(vWPos.xz * 2.2), oGf = fract(vWPos.xz * 2.2) - .5 - (oHash2(oGc) - .5) * .7;
float oTw = .5 + .5 * sin(uTime * (2.5 + oHash(oGc) * 4.) + oHash(oGc + 3.) * 30.);
float oGlint = (1. - smoothstep(.04, .11, length(oGf))) * step(.6, oHash(oGc + 9.)) * oTw * oTw * oTw * (.35 + pow(oSpec, 10.) * 2.5);
oGlint += pow(oSpec, 120.) * smoothstep(.7, .92, oNoise(vWPos.xz * 6.5 + vec2(uTime * 1.3, -uTime * .9))) * .6;
oGlint *= oDetail * (1. - foam) * smoothstep(.0, 3., oD);
totalEmissiveRadiance += vec3(1., .97, .9) * oGlint * 1.5 * (1. - uNight) * smoothstep(.0, .2, uSunDir.y);
#endif
vec2 oCell = floor(vWPos.xz * 1.4);
float oSpark = step(.975, oHash(oCell)) * (.5 + .5 * sin(uTime * 2.6 + oHash(oCell + 1.3) * 40.))
  * (1. - smoothstep(.05, .3, length(fract(vWPos.xz * 1.4) - .5))) * (1. - smoothstep(1., 9., oD)) * oDetail;
float oPulse = .75 + .25 * sin(uTime * 1.7 + oD * 2.);
// 夜光是一粒粒的：浪花和生物身上的荧光乘上细颗粒噪声
float oGrain = .3 + 1.1 * smoothstep(.5, .8, oNoise(vWPos.xz * 11. + uTime * .4)) * (.6 + .4 * oNoise(vWPos.xz * 3.));
totalEmissiveRadiance += uGlow * uNight * ((foam * oPulse * .9 + oLife) * oGrain + oSpark * 1.4);
`;
