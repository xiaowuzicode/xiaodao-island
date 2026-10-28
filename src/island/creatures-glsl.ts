/**
 * 水下生物的着色器片段：俯视剪影 + 透过水的颜色 + 落在海底的影子 + 夜光。
 * 每只的局部坐标 q.x 朝前、q.y 朝侧面（米）；离得远的先用包围半径早退，省掉大部分像素的开销。
 * 位置都来自 uniform：蝠鲼/鹞鲼/魟/鲨鱼/鱼群/水母见 swimmers.ts，海豚见 whales.ts 的 podAt。
 */
import { SWIMMERS } from '@/island/swimmers';
import { POD_SIZE } from '@/island/whales';

export const COUNTS = {
  manta: SWIMMERS.manta.members.length,
  shark: SWIMMERS.shark.members.length,
  school: SWIMMERS.school.members.length,
  jelly: SWIMMERS.jelly.members.length,
  eagle: SWIMMERS.eagle.members.length,
  stingray: SWIMMERS.stingray.members.length,
  goldJelly: SWIMMERS.goldJelly.members.length,
  dolphin: POD_SIZE,
} as const;

/** 各种生物离水面多深（米）：越深颜色越被水吃掉；海豚、礁鲨贴着水面，蓝点魟贴着海底。 */
const SWIM_DEPTH = { manta: 0.8, eagle: 0.9, stingray: 1.1, dolphin: 0.6, school: 0.7, shark: 0.45, jelly: 0.3, goldJelly: 0.35 } as const;
const f = (n: number) => n.toFixed(2);

const SHAPES = /* glsl */ `
vec2 toLocal(vec2 p, vec4 r){ vec2 q = p - r.xy; float c = cos(r.z), s = sin(r.z); return vec2(c * q.x + s * q.y, -s * q.x + c * q.y); }
float sdTri(vec2 p, vec2 a, vec2 b, vec2 c){
  vec2 e0 = b - a, e1 = c - b, e2 = a - c, v0 = p - a, v1 = p - b, v2 = p - c;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0., 1.);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0., 1.);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0., 1.);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
               vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y); }
/** 纺锤形身体：x 在 [tail, nose] 之间，最宽 w 处靠前，尾柄收到 neck。返回到轮廓的近似距离（米，里面为负）。 */
float sdBody(vec2 q, float tail, float nose, float w, float neck){
  float s = clamp((q.x - tail) / (nose - tail), 0., 1.);
  float hw = neck + w * pow(s, .6) * pow(1. - s, .4) * 1.9;
  return max(abs(q.y) - hw, max(tail - q.x, q.x - nose)); }

/** 蝠鲼（阿氏前口蝠鲼）：头部圆钝、前缘斜着掠向翼尖、后缘内凹，带一根细尾巴，背上两块白色肩斑；r.w 是扇翅相位。 */
float manta(vec2 p, vec4 r, out float shoulder){
  shoulder = 0.;
  vec2 q = toLocal(p, r);
  if (dot(q, q) > 7.) return 0.;
  float span = 1.5 * (.82 + .18 * sin(r.w)), w = abs(q.y) / span;
  float front = .62 * (1. - pow(w, 1.15)) - .38 * w;
  float back = mix(-.55, -.38, w) + .28 * w * (1. - w);
  float edge = min(min(front - q.x, q.x - back) * span, (1. - w) * span * .5);
  float tail = (1. - smoothstep(.025, .06, abs(q.y))) * step(-2.3, q.x) * step(q.x, -.3);
  float body = smoothstep(0., .06, edge);
  // 白肩斑：顺着翅膀前缘的一道长条，边缘很软
  vec2 sq = vec2(q.x, abs(q.y)) - vec2(.12, .55);
  sq = vec2(.87 * sq.x + .5 * sq.y, -.5 * sq.x + .87 * sq.y);
  shoulder = (1. - smoothstep(.5, 1., length(sq / vec2(.13, .4)))) * body * .7;
  return max(body, tail); }

/** 黑鳍礁鲨：身体往后越摆越大；tip 返回鳍尖（黑色）的覆盖度。r.w 是摆尾相位。 */
float shark(vec2 p, vec4 r, out float tip){
  tip = 0.;
  vec2 q = toLocal(p, r);
  if (dot(q, q) > 2.2) return 0.;
  q.y -= sin(q.x * 2.4 + r.w) * .1 * smoothstep(.4, -1.1, q.x);
  vec2 m = vec2(q.x, abs(q.y));
  float body = sdBody(q, -.82, .92, .1, .025);
  float fin = sdTri(m, vec2(.38, .08), vec2(.12, .08), vec2(-.06, .44));
  float caudal = min(sdTri(q, vec2(-.74, 0.), vec2(-1.12, .3), vec2(-.98, 0.)), sdTri(q, vec2(-.74, 0.), vec2(-1.04, -.2), vec2(-.96, 0.)));
  float d = min(body, min(fin, caudal));
  tip = (1. - smoothstep(.07, .1, length(m - vec2(-.04, .41)))) + (1. - smoothstep(.07, .1, length(q - vec2(-1.09, .28))));
  tip *= step(d, 0.);
  return smoothstep(.015, -.015, d); }
/** 鲨鱼背鳍露出水面，身后拖出 V 形白浪（不受摆尾影响，用原始局部坐标）。 */
float sharkWake(vec2 p, vec4 r){
  vec2 q = toLocal(p, r);
  float b = .15 - q.x;
  if (b < 0. || b > 4.5 || abs(q.y) > 2.2) return 0.;
  return (1. - smoothstep(.02, .09, abs(abs(q.y) - b * .4))) * exp(-b * .6) * smoothstep(0., .25, b); }

/** 小鱼群：在鱼群自己的坐标里错位排格子，每格一条小鱼，各自轻轻摆头。r.w 让整群慢慢打转。 */
float school(vec2 p, vec4 r){
  vec2 q = toLocal(p, r);
  if (dot(q, q) > 9.) return 0.;
  float c = cos(sin(r.w) * .5), s = sin(sin(r.w) * .5);
  q = vec2(c * q.x + s * q.y, -s * q.x + c * q.y);
  vec2 e = q / vec2(2.3, 1.4);
  const vec2 cell = vec2(.44, .3);
  float row = floor(q.y / cell.y);
  vec2 g = vec2(q.x / cell.x + mod(row, 2.) * .5, q.y / cell.y);
  vec2 id = floor(g), fp = fract(g) - .5;
  float h = oHash(id + 17.);
  if (h < .3 || dot(e, e) > 1. - h * .35) return 0.;
  vec2 fq = (fp - (oHash2(id + 4.2) - .5) * .2) * cell;
  float a = sin(uTime * 2.3 + h * 30.) * .22, ca = cos(a), sa = sin(a);
  fq = vec2(ca * fq.x + sa * fq.y, -sa * fq.x + ca * fq.y);
  float d = min((length(fq / vec2(.12, .036)) - 1.) * .036, sdTri(fq, vec2(-.1, 0.), vec2(-.18, .048), vec2(-.18, -.048)));
  return smoothstep(.012, -.012, d); }

/** 海月水母：一张一缩的伞盖，花边伞缘，中间四个环（月水母的标志）。返回 (伞, 伞缘, 四叶环)。 */
vec3 jelly(vec2 p, vec4 r){
  vec2 q = p - r.xy;
  float d = length(q);
  if (d > .8) return vec3(0.);
  float R = .5 * (1. + .1 * sin(r.w)), edge = R * (1. + .035 * sin(atan(q.y, q.x) * 16.));
  float bell = smoothstep(edge, edge - .03, d);
  float rim = bell * smoothstep(edge - .09, edge - .02, d);
  float ring = 9.;
  for (int k = 0; k < 4; k++) {
    float a = float(k) * 1.5708 + .785;
    ring = min(ring, abs(length(q - vec2(cos(a), sin(a)) * R * .3) - R * .15));
  }
  return vec3(bell, rim, (1. - smoothstep(.012, .03, ring)) * bell); }

/** 海豚在两跳之间的水下身影；r.w 是可见度（跳出水面时为 0，那时画的是 3D 模型）。 */
float dolphin(vec2 p, vec4 r){
  if (r.w <= 0.) return 0.;
  vec2 q = toLocal(p, r);
  if (dot(q, q) > 2.6) return 0.;
  q.y -= sin(q.x * 2. + uTime * 4.) * .04 * smoothstep(.2, -.8, q.x);
  vec2 m = vec2(q.x, abs(q.y));
  float body = sdBody(q, -.78, .88, .11, .02);
  float beak = max(abs(q.y) - .035, max(.8 - q.x, q.x - 1.1));
  float fin = sdTri(m, vec2(.38, .09), vec2(.16, .09), vec2(.04, .32));
  float fluke = sdTri(m, vec2(-.7, 0.), vec2(-.98, .3), vec2(-.88, 0.));
  return smoothstep(.015, -.015, min(min(body, beak), min(fin, fluke))) * r.w; }

/** 斑点鹞鲼：翼尖更尖、往后掠得更狠，鸭嘴似的吻部，深色背上撒白点，鞭子一样的长尾巴。spots 返回白点覆盖度。 */
float eagleRay(vec2 p, vec4 r, out float spots){
  spots = 0.;
  vec2 q = toLocal(p, r);
  if (dot(q, q) > 9.) return 0.;
  float span = 1.1 * (.8 + .2 * sin(r.w)), w = abs(q.y) / span;
  float front = .42 * (1. - pow(w, .9)) - .5 * w, back = mix(-.36, -.5, w) + .1 * w * (1. - w);
  float body = smoothstep(0., .04, min(min(front - q.x, q.x - back) * span, (1. - w) * span * .4));
  float snout = 1. - smoothstep(.07, .1, length((q - vec2(.48, 0.)) / vec2(1.4, 1.)));
  float ty = q.y - sin(q.x * 2. + uTime * 2.) * .06 * smoothstep(-.4, -2., q.x);
  float tail = (1. - smoothstep(.01, .025, abs(ty))) * step(-2.7, q.x) * step(q.x, -.3);
  vec2 g = q * 9., id = floor(g);
  spots = (1. - smoothstep(.1, .18, length(fract(g) - .5 - (oHash2(id) - .5) * .4))) * step(.3, oHash(id + 2.)) * body;
  return max(max(body, snout), tail); }

/** 蓝点魟：贴着海底慢慢滑的椭圆圆盘，边缘一波一波地起伏，黄褐底撒亮蓝点，粗尾巴带蓝纹。返回 (覆盖, 蓝点)。 */
vec2 stingray(vec2 p, vec4 r){
  vec2 q = toLocal(p, r) / 1.5;
  if (dot(q, q) > 2.2) return vec2(0.);
  float a = atan(q.y, q.x);
  float m = 1. - smoothstep(-.06, .06, length(q / vec2(.42, .33)) - 1. - .05 * sin(a * 6. - r.w * 2.));
  float tw = .045 * smoothstep(-1.3, -.35, q.x);
  float tail = (1. - smoothstep(tw, tw + .015, abs(q.y))) * step(-1.3, q.x) * step(q.x, -.3);
  vec2 g = q * 14., id = floor(g);
  float spot = (1. - smoothstep(.14, .24, length(fract(g) - .5))) * step(.5, oHash(id + 4.)) * m;
  spot = max(spot, tail * step(.5, fract(q.x * 5.)) * step(-1., q.x));
  return vec2(max(m, tail), spot); }

/** 金黄水母：橙色伞盖带放射条纹，一张一缩，身后拖四根长触手随水摆。返回 (伞, 条纹, 触手)。 */
vec3 goldJelly(vec2 p, vec4 r){
  vec2 q = toLocal(p, r);
  if (dot(q, q) > 9.) return vec3(0.);
  float R = .4 * (1. + .1 * sin(r.w)), d = length(q), a = atan(q.y, q.x);
  float bell = 1. - smoothstep(R * (1. + .03 * sin(a * 16.)) - .02, R + .01, d);
  float stripes = bell * smoothstep(.55, .9, abs(sin(a * 8.))) * smoothstep(R * .3, R * .6, d);
  float tent = 0.;
  for (int k = 0; k < 4; k++) {
    float fk = float(k), yy = (fk - 1.5) * .12 + sin(q.x * 3. + uTime * 1.5 + fk * 1.7) * .1 * smoothstep(0., -2.5, q.x);
    tent = max(tent, (1. - smoothstep(.008, .022, abs(q.y - yy))) * step(-2.7, q.x) * step(q.x, -R * .4));
  }
  return vec3(bell, stripes, tent); }
`;

/** uniform 声明 + 形状函数 + 合成函数；插在海面片元着色器的全局区。 */
export const CREATURES_HEAD = /* glsl */ `
uniform vec4 uMantas[${COUNTS.manta}]; uniform vec4 uSharks[${COUNTS.shark}]; uniform vec4 uSchools[${COUNTS.school}];
uniform vec4 uJellies[${COUNTS.jelly}]; uniform vec4 uDolphins[${COUNTS.dolphin}];
uniform vec4 uEagles[${COUNTS.eagle}]; uniform vec4 uStingrays[${COUNTS.stingray}]; uniform vec4 uGoldJellies[${COUNTS.goldJelly}];
uniform vec3 uMantaCol; uniform vec3 uSharkCol; uniform vec3 uSharkTip; uniform vec3 uFishCol; uniform vec3 uDolphinCol;
uniform vec3 uJellyCol; uniform vec3 uJellyRing; uniform vec3 uEagleCol; uniform vec3 uRayCol[2]; uniform vec3 uGoldCol[3]; uniform vec3 uPale;
${SHAPES}
vec3 seen(vec3 col, vec3 scatter, vec3 c, float mask, float z, float path){
  vec3 tr = exp(-uAbsorb * z * path);
  return mix(col, c * tr + scatter * (1. - tr), mask); }

/** 海底上的影子：每种生物沿太阳方向往下投（off 是每米水深的水平偏移）。返回 0–1 的遮挡量。 */
float creatureShadow(vec2 p, vec2 off, float depth){
  float s = 0., tip, x;
  for (int i = 0; i < ${COUNTS.manta}; i++) s = max(s, manta(p - off * max(depth - ${f(SWIM_DEPTH.manta)}, 0.), uMantas[i], x));
  for (int i = 0; i < ${COUNTS.eagle}; i++) s = max(s, eagleRay(p - off * max(depth - ${f(SWIM_DEPTH.eagle)}, 0.), uEagles[i], x));
  for (int i = 0; i < ${COUNTS.stingray}; i++) s = max(s, stingray(p - off * max(depth - ${f(SWIM_DEPTH.stingray)}, 0.), uStingrays[i]).x);
  for (int i = 0; i < ${COUNTS.shark}; i++) s = max(s, shark(p - off * max(depth - ${f(SWIM_DEPTH.shark)}, 0.), uSharks[i], tip));
  for (int i = 0; i < ${COUNTS.school}; i++) s = max(s, school(p - off * max(depth - ${f(SWIM_DEPTH.school)}, 0.), uSchools[i]) * .7);
  for (int i = 0; i < ${COUNTS.dolphin}; i++) s = max(s, dolphin(p - off * max(depth - ${f(SWIM_DEPTH.dolphin)}, 0.), uDolphins[i]));
  return s; }

/** 由深到浅把生物叠到水色上；glow 累加夜光，wake 累加鲨鱼尾迹白浪。 */
vec3 drawCreatures(vec3 col, vec3 sc, vec2 p, float path, inout float glow, inout float wake){
  float m, tip, mark;
  for (int i = 0; i < ${COUNTS.stingray}; i++) {
    vec2 st = stingray(p, uStingrays[i]);
    col = seen(col, sc, mix(uRayCol[0], uRayCol[1], st.y), st.x * .92, ${f(SWIM_DEPTH.stingray)}, path); glow += st.x * .3 + st.y * .8; }
  for (int i = 0; i < ${COUNTS.eagle}; i++) {
    m = eagleRay(p, uEagles[i], mark);
    col = seen(col, sc, mix(uEagleCol, uPale, mark), m * .92, ${f(SWIM_DEPTH.eagle)}, path); glow += m * .3 + mark * .6; }
  for (int i = 0; i < ${COUNTS.manta}; i++) {
    m = manta(p, uMantas[i], mark);
    col = seen(col, sc, mix(uMantaCol, uPale, mark * .85), m * .92, ${f(SWIM_DEPTH.manta)}, path); glow += m * .35; }
  for (int i = 0; i < ${COUNTS.dolphin}; i++) { m = dolphin(p, uDolphins[i]); col = seen(col, sc, uDolphinCol, m * .9, ${f(SWIM_DEPTH.dolphin)}, path); glow += m * .4; }
  for (int i = 0; i < ${COUNTS.school}; i++) {
    m = school(p, uSchools[i]);
    col = seen(col, sc, uFishCol * (.85 + .3 * oNoise(p * 9.)), m * .85, ${f(SWIM_DEPTH.school)}, path); glow += m * .6; }
  for (int i = 0; i < ${COUNTS.shark}; i++) {
    m = shark(p, uSharks[i], tip);
    col = seen(col, sc, mix(uSharkCol, uSharkTip, clamp(tip, 0., 1.)), m * .92, ${f(SWIM_DEPTH.shark)}, path);
    glow += m * .3; wake += sharkWake(p, uSharks[i]); }
  for (int i = 0; i < ${COUNTS.jelly}; i++) {
    vec3 j = jelly(p, uJellies[i]);
    col = seen(col, sc, uJellyCol, j.x * .42 + j.y * .4, ${f(SWIM_DEPTH.jelly)}, path);
    col = seen(col, sc, uJellyRing, j.z * .85, ${f(SWIM_DEPTH.jelly)}, path);
    glow += j.y * 1.6 + j.x * .4 + j.z * .8; }
  for (int i = 0; i < ${COUNTS.goldJelly}; i++) {
    vec3 j = goldJelly(p, uGoldJellies[i]);
    col = seen(col, sc, uGoldCol[2], j.z * .6, ${f(SWIM_DEPTH.goldJelly)}, path);
    col = seen(col, sc, mix(uGoldCol[0], uGoldCol[1], j.y), j.x * .82, ${f(SWIM_DEPTH.goldJelly)}, path);
    glow += j.x * .9 + j.z * .7; }
  return col; }
`;
