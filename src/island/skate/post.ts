/**
 * 后期：先把场景画进一张高动态范围的图，再合成一遍——
 * 朝太阳方向泛暖的远景薄雾、柔光（整幅画面的多级模糊按比例混回去，亮的地方自然晕开）、太阳眩光、
 * 色调映射和一点冷暗暖亮的调色、暗角、防色带的抖动；最上面是招牌的彩铅画风：
 * 铅笔勾边、顺着一个方向的笔触和露白、暗部排线、纸纹、画纸留边。
 * 画风叠在光影之上，可以单独关掉；机器吃力时整套后期都能关（直接画到屏幕）。
 */
import * as THREE from 'three';

const VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

/** 降采样：四个双线性采样点取平均（等于 4×4 的盒式滤波）。 */
const DOWN = /* glsl */ `uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uClamp; varying vec2 vUv;
void main(){ vec3 c = vec3(0.);
  for (int i = 0; i < 4; i++) { vec2 o = vec2(i < 2 ? -1. : 1., mod(float(i), 2.) < .5 ? -1. : 1.) * uTexel;
    vec3 s = texture2D(tSrc, vUv + o).rgb;
    if (isnan(s.r) || isnan(s.g) || isnan(s.b)) s = vec3(0.); // 个别材质（灯塔光锥的锥尖）会算出非数，在浮点画布上会变成一圈亮点
    c += uClamp > 0. ? min(s, vec3(uClamp)) : s; }
  gl_FragColor = vec4(c * .25, 1.); }`;
/** 升采样：把更模糊的一级叠回来。 */
const UP = /* glsl */ `uniform sampler2D tSrc; uniform sampler2D tLow; uniform vec2 uTexel; varying vec2 vUv;
void main(){ vec3 l = vec3(0.);
  for (int i = 0; i < 4; i++) { vec2 o = vec2(i < 2 ? -.5 : .5, mod(float(i), 2.) < .5 ? -.5 : .5) * uTexel; l += texture2D(tLow, vUv + o).rgb; }
  gl_FragColor = vec4(mix(texture2D(tSrc, vUv).rgb, l * .25, .6), 1.); }`;

const COMPOSITE = /* glsl */ `
uniform sampler2D tScene, tDepth, tBloom;
uniform vec2 uRes; uniform float uDpr, uTime, uNear, uFar;
uniform float uPencil, uBloom, uVignette, uExposure, uHaze, uBoil, uFade, uSpeed, uMist;
uniform vec3 uMistCol;
uniform vec3 uSunDir, uSunCol, uHazeCol, uPaper;
uniform vec3 uSunUv;
uniform mat4 uInvProj, uCamWorld;
varying vec2 vUv;

float hash12(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1., 0.)), f.x), mix(hash12(i + vec2(0., 1.)), hash12(i + vec2(1., 1.)), f.x), f.y); }
float luma(vec3 c){ return dot(c, vec3(.2126, .7152, .0722)); }
float linZ(float d){ float z = d * 2. - 1.; return 2. * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

vec3 rrt(vec3 v){ vec3 a = v * (v + .0245786) - .000090537; vec3 b = v * (.983729 * v + .4329510) + .238081; return a / b; }
vec3 aces(vec3 c){
  const mat3 inM = mat3(vec3(.59719, .07600, .02840), vec3(.35458, .90834, .13383), vec3(.04823, .01566, .83777));
  const mat3 outM = mat3(vec3(1.60475, -.10208, -.00327), vec3(-.53108, 1.10813, -.07276), vec3(-.07367, -.00605, 1.07602));
  return clamp(outM * rrt(inM * (c * uExposure / .6)), 0., 1.); }
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.)), vec3(1. / 2.4)) - .055, step(vec3(.0031308), c)); }

void main(){
  vec2 px = gl_FragCoord.xy / uDpr;                 // CSS 像素：画风的线宽、纸纹不随屏幕密度变
  float boil = floor(uTime * 8.) * uBoil;          // 每秒 8 格的手绘抖动
  // 画风：采样位置轻轻晃一下，轮廓像手画的不那么直
  vec2 wob = (vec2(vnoise(px * .035 + boil * 3.1), vnoise(px * .035 + 41. + boil * 1.7)) - .5) * 1.4 * uPencil * uDpr / uRes;
  vec2 uv = vUv + wob;
  vec3 col = texture2D(tScene, uv).rgb;
  if (isnan(col.r) || isnan(col.g) || isnan(col.b)) col = texture2D(tScene, uv + vec2(2., 2.) * uDpr / uRes).rgb;
  if (isnan(col.r) || isnan(col.g) || isnan(col.b)) col = vec3(0.);
  // 速度感：画面边上顺着「从中心往外」的方向拉出一点残影，越快、越靠边越长（中间的男孩和前面的路保持清楚）
  if (uSpeed > .01) {
    vec2 c0 = vUv - .5;
    vec2 pull = c0 * dot(c0, c0) * uSpeed * .22;
    vec3 acc = col; float wsum = 1.;
    for (int i = 1; i <= 4; i++) { vec3 smp = texture2D(tScene, uv - pull * float(i)).rgb; if (!isnan(smp.r)) { float w = 1. - float(i) * .17; acc += smp * w; wsum += w; } }
    col = acc / wsum;
  }
  float d = texture2D(tDepth, uv).x, z = linZ(d);
  float sky = step(.99999, d);

  // 远景薄雾：越远越淡，朝太阳那边泛暖
  vec4 vp = uInvProj * vec4(vUv * 2. - 1., 1., 1.);
  vec3 ray = normalize((uCamWorld * vec4(vp.xyz / vp.w, 0.)).xyz);
  float toSun = pow(max(dot(ray, uSunDir), 0.), 5.);
  float haze = (1. - exp(-max(z - 14., 0.) * uHaze)) * (1. - sky);
  col = mix(col, uHazeCol * (1. + toSun * .9) + uSunCol * toSun * .22, haze * (.75 + .25 * toSun));

  // 柔光 + 太阳眩光（被挡住就没有）
  vec3 bloom = texture2D(tBloom, vUv).rgb;
  col = mix(col, bloom, uBloom) + max(bloom - 1., 0.) * uBloom * 1.5;
  vec2 asp = vec2(uRes.x / uRes.y, 1.);
  float r = length((vUv - uSunUv.xy) * asp);
  float sunSeen = 0.;
  for (int i = 0; i < 5; i++) { vec2 so = vec2(i == 1 ? -1. : i == 2 ? 1. : 0., i == 3 ? -1. : i == 4 ? 1. : 0.) * .012;
    sunSeen += step(.99999, texture2D(tDepth, clamp(uSunUv.xy + so, 0., 1.)).x) * .2; }
  col += uSunCol * (.018 / (r * r * 9. + .02) + .1 * exp(-r * 3.4)) * uSunUv.z * (.25 + .75 * sunSeen);

  // 色调映射：地上的东西走电影曲线；天空本来就是按屏幕调的颜色，只压一下过亮的部分
  vec3 lit = aces(col);
  vec3 skyc = col * uExposure; skyc = mix(skyc, 1. - exp(-skyc * 1.25), smoothstep(.75, 1.5, max(skyc.r, max(skyc.g, skyc.b))));
  // 按距离平滑过渡（云、远处的海也算进「天空」那一侧）：只按深度是否为空来分，物体轮廓上会出一圈碎点
  col = mix(lit, clamp(skyc, 0., 1.), smoothstep(70., 150., z));
  // 调色：暗部偏一点青、亮部偏暖，轻轻的 S 曲线，饱和度提一点
  float l = luma(col);
  col *= mix(vec3(.95, 1., 1.05), vec3(1.05, 1., .94), smoothstep(.05, .6, l));
  col = mix(col, col * col * (3. - 2. * col), .14);
  col = mix(vec3(luma(col)), col, 1.08);
  col = toSRGB(clamp(col, 0., 1.));
  // 镜头在云里：整幅画面蒙上一层云色，一缕一缕往后掠（穿过云顶那一下）
  if (uMist > .001) {
    float wisp = vnoise(px * .006 + vec2(uTime * .35, -uTime * 1.1)) * .6 + vnoise(px * .017 + vec2(-uTime * .7, -uTime * 2.3)) * .4;
    col = mix(col, uMistCol * (.95 + .08 * wisp), clamp(uMist * (.8 + .32 * wisp), 0., 1.));
  }

  if (uPencil > .001) {
    // 1 勾边：深度的二阶差分（平面上不出线）+ 颜色反差
    // 深度图是按最近的像素取的：三个采样点必须落在像素正中、左右对称，否则斜着看的大平面（海面）差不干净，海平线下面会冒出深色团块
    vec2 o = max(1., floor(1.15 * uDpr + .5)) / uRes, uc = (floor(uv * uRes) + .5) / uRes;
    float zc = linZ(texture2D(tDepth, uc).x);
    float zl = linZ(texture2D(tDepth, uc - vec2(o.x, 0.)).x), zr = linZ(texture2D(tDepth, uc + vec2(o.x, 0.)).x);
    float zu = linZ(texture2D(tDepth, uc + vec2(0., o.y)).x), zd = linZ(texture2D(tDepth, uc - vec2(0., o.y)).x);
    float eDepth = smoothstep(.006, .03, (abs(zl + zr - 2. * zc) + abs(zu + zd - 2. * zc)) / zc) * (1. - sky);
    float ll = luma(texture2D(tScene, uv - vec2(o.x, 0.)).rgb), lr = luma(texture2D(tScene, uv + vec2(o.x, 0.)).rgb);
    float lu = luma(texture2D(tScene, uv + vec2(0., o.y)).rgb), ld = luma(texture2D(tScene, uv - vec2(0., o.y)).rgb);
    float eCol = smoothstep(.22, .55, abs(ll - lr) / (ll + lr + .06) + abs(lu - ld) / (lu + ld + .06)) * (1. - sky * .7);
    float edge = max(eDepth, eCol * .55) * (1. - smoothstep(45., 150., z)) * (1. - sky);
    float graphite = .5 + .5 * vnoise(px * 1.3 + boil * 5.);
    col = mix(col, mix(vec3(.26, .22, .2), col * .4, .35), edge * graphite * .82 * uPencil);

    float lum = luma(col);
    // 2 笔触：顺着一个方向的细长纹理；浓的地方颜色深一点，淡的地方露出画纸
    vec2 q = rot(.62) * px;
    float tooth = vnoise(vec2(q.x * .8, q.y * .11) + boil * 2.3) * .6 + vnoise(vec2(q.x * .3 + 9., q.y * .06)) * .4;
    col = mix(col, uPaper, uPencil * smoothstep(.58, .95, tooth) * (.05 + .17 * smoothstep(.2, .9, lum)) * (1. - sky * .55));
    col *= 1. - uPencil * .06 * smoothstep(.46, .12, tooth);
    // 3 暗部排线：一层斜线，再暗的地方交叉一层
    vec2 h1 = rot(-.78) * px, h2 = rot(.5) * px;
    float w1 = (vnoise(h1 * .04 + boil) - .5) * .5, w2 = (vnoise(h2 * .04 + 7.) - .5) * .5;
    float line1 = 1. - smoothstep(.16, .3, abs(fract(h1.x / 5.2 + w1) - .5));
    float line2 = 1. - smoothstep(.14, .28, abs(fract(h2.x / 6.1 + w2) - .5));
    float gap = .55 + .45 * vnoise(h1 * vec2(.5, .03));
    float near = (1. - sky) * (1. - smoothstep(50., 160., z));   // 远处的海和山不排线，不然海平线上一串黑团
    float dark = smoothstep(.4, .14, lum) * near, darker = smoothstep(.22, .05, lum) * near;
    col *= 1. - uPencil * (dark * line1 * gap * .22 + darker * line2 * .2);
    // 4 纸纹与纸色
    float grain = vnoise(px * 1.9) * .6 + vnoise(px * .42 + 5.) * .4;
    col *= 1. - uPencil * .07 * (grain - .5) * 2.;
    col = mix(col, col * uPaper, uPencil * .3);
    // 5 留边：画到纸边就停，边缘毛毛糙糙
    float border = min(min(px.x, uRes.x / uDpr - px.x), min(px.y, uRes.y / uDpr - px.y));
    float fade = smoothstep(20., 5., border + (vnoise(px * .08) - .5) * 16. + (tooth - .5) * 6.);
    col = mix(col, uPaper * (1. - .05 * (grain - .5)), fade * uPencil);
  }

  // 暗角
  vec2 c = (vUv - .5) * vec2(asp.x, 1.);
  float vr = smoothstep(.12, 1.05, dot(c, c) / (.25 * (asp.x * asp.x + 1.)));
  col *= 1. - uVignette * vr * vr * (3. - 2. * vr) * (1. - uPencil * .55);
  col = mix(col, uPaper, uFade);
  // 抖动：天空的渐变不出色带
  col += (hash12(gl_FragCoord.xy * 1.37 + 11.) + hash12(gl_FragCoord.xy * .71 + 3.) - 1.) / 255.;
  gl_FragColor = vec4(col, 1.);
}`;

export interface PostOptions { bloom: boolean; msaa: boolean }

export function createPost(renderer: THREE.WebGLRenderer, opts: PostOptions) {
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const pass = (frag: string, uniforms: Record<string, THREE.IUniform>) =>
    new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false });

  const scene = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: opts.msaa ? 4 : 0, depthBuffer: true });
  scene.depthTexture = new THREE.DepthTexture(4, 4);
  const LEVELS = 4;
  const mk = () => new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const downs = Array.from({ length: LEVELS }, mk), ups = Array.from({ length: LEVELS - 1 }, mk);
  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  black.needsUpdate = true;

  const down = pass(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uClamp: { value: 0 } });
  const up = pass(UP, { tSrc: { value: null }, tLow: { value: null }, uTexel: { value: new THREE.Vector2() } });
  const u = {
    tScene: { value: scene.texture }, tDepth: { value: scene.depthTexture }, tBloom: { value: black as THREE.Texture },
    uRes: { value: new THREE.Vector2(1, 1) }, uDpr: { value: 1 }, uTime: { value: 0 }, uNear: { value: 0.1 }, uFar: { value: 1000 },
    uPencil: { value: 1 }, uBloom: { value: 0.14 }, uVignette: { value: 0.3 }, uExposure: { value: 1 }, uHaze: { value: 0.0016 }, uBoil: { value: 1 }, uFade: { value: 0 }, uSpeed: { value: 0 }, uMist: { value: 0 }, uMistCol: { value: new THREE.Color('#fbf3ea') },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uHazeCol: { value: new THREE.Color() }, uPaper: { value: new THREE.Color('#fbf6ea') },
    uSunUv: { value: new THREE.Vector3(0.5, 0.5, 0) }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
  };
  // 颜色按屏幕空间给（纸色、雾色是直接混进画面的）
  u.uPaper.value.convertLinearToSRGB();
  const composite = pass(COMPOSITE, u);
  const draw = (m: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) => {
    quad.material = m;
    renderer.setRenderTarget(target);
    renderer.render(quad, ortho);
  };
  const sunV = new THREE.Vector3();
  let bloomOn = opts.bloom, sunVis = 0;

  return {
    uniforms: u,
    setSize(w: number, h: number, dpr: number) {
      const pw = Math.max(2, Math.round(w * dpr)), ph = Math.max(2, Math.round(h * dpr));
      scene.setSize(pw, ph);
      downs.forEach((t, i) => t.setSize(Math.max(2, pw >> (i + 1)), Math.max(2, ph >> (i + 1))));
      ups.forEach((t, i) => t.setSize(Math.max(2, pw >> (i + 1)), Math.max(2, ph >> (i + 1))));
      u.uRes.value.set(pw, ph);
      u.uDpr.value = dpr;
    },
    setBloom(on: boolean) { bloomOn = on; },
    /** 画一帧。sunDir、sunCol：太阳方向（世界坐标）与颜色；sunOn：眩光强度 0–1（太阳被挡住多少由深度图自己查）。 */
    render(world: THREE.Scene, camera: THREE.PerspectiveCamera, t: number, sunDir: THREE.Vector3, sunCol: THREE.Color, sunOn: number) {
      renderer.setRenderTarget(scene);
      renderer.render(world, camera);
      if (bloomOn) {
        let src: THREE.Texture = scene.texture, w = u.uRes.value.x, h = u.uRes.value.y;
        for (let i = 0; i < LEVELS; i++) {
          down.uniforms.tSrc.value = src;
          down.uniforms.uTexel.value.set(1 / w, 1 / h);
          down.uniforms.uClamp.value = i === 0 ? 6 : 0; // 第一级压一下极亮的点，免得闪
          draw(down, downs[i]);
          src = downs[i].texture; w = downs[i].width; h = downs[i].height;
        }
        let low: THREE.Texture = downs[LEVELS - 1].texture;
        for (let i = LEVELS - 2; i >= 0; i--) {
          up.uniforms.tSrc.value = downs[i].texture;
          up.uniforms.tLow.value = low;
          up.uniforms.uTexel.value.set(1 / downs[i + 1].width, 1 / downs[i + 1].height);
          draw(up, ups[i]);
          low = ups[i].texture;
        }
        u.tBloom.value = low;
      } else u.tBloom.value = black;
      u.uTime.value = t;
      u.uNear.value = camera.near;
      u.uFar.value = camera.far;
      u.uExposure.value = renderer.toneMappingExposure;
      u.uInvProj.value.copy(camera.projectionMatrixInverse);
      u.uCamWorld.value.copy(camera.matrixWorld);
      u.uSunDir.value.copy(sunDir).normalize();
      u.uSunCol.value.copy(sunCol);
      // 太阳在屏幕上的位置；在背后或太偏就没有眩光（淡入淡出，不跳）
      sunV.copy(u.uSunDir.value).multiplyScalar(500).add(camera.position).project(camera);
      const front = sunV.z < 1 ? 1 : 0, edge = Math.max(Math.abs(sunV.x), Math.abs(sunV.y));
      sunVis = front * Math.min(1, Math.max(0, (1.5 - edge) / 0.5)) * sunOn;
      u.uSunUv.value.set(sunV.x * 0.5 + 0.5, sunV.y * 0.5 + 0.5, sunVis);
      draw(composite, null);
    },
    dispose() {
      [scene, ...downs, ...ups].forEach((t) => t.dispose());
    },
  };
}
