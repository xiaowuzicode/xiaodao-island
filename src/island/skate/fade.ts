/**
 * 自由滑：离镜头太近、或者正好挡在镜头和男孩之间的东西（岛民、树干、摊位、长椅……）用「网点」淡掉，
 * 而不是让镜头再多一条躲东西的规矩。岛上的东西大多按材质合成了一大块网格，没法一件件调透明度，
 * 所以在材质的着色器里按每个像素离镜头多远、离视线多近来决定丢不丢掉这个像素（抖动丢一部分 = 半透明的样子，不用排序）。
 * 脚下的地面（比镜头低七十厘米以下）和男孩自己、他的板子（离他从脚到头那根轴半米以内）永远不淡。
 * nearFadeAmount 是同一个公式的 TS 版，检查脚本用它算「镜头在东西里的那几帧有没有被淡掉」。两边改一处要一起改。
 */
import * as THREE from 'three';

/**
 * 离镜头 near[0] 米以内全淡、near[1] 米以外不淡；离视线（镜头到他身子中间）los[0] 米以内全淡、los[1] 以外不淡，视线最后那一截（losEnd 之后）不算；
 * 离他从脚到头那根轴（脚往上 tall 米）boy[0] 米以内不淡、boy[1] 以外照常；比镜头低 below 米以下不淡。
 */
export const FADE = { near: [0.7, 1.5], los: [0.22, 0.45], losEnd: 0.82, boy: [0.45, 0.7], tall: 1.6, mid: 0.8, below: 0.7 } as const;

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** 点 p 被淡掉几成（0 不淡，1 全淡）。cam：镜头；feet：男孩脚下。 */
export function nearFadeAmount(cam: THREE.Vector3Like, feet: THREE.Vector3Like, p: THREE.Vector3Like) {
  if (p.y < cam.y - FADE.below) return 0;
  const dx = p.x - cam.x, dy = p.y - cam.y, dz = p.z - cam.z, near = 1 - smooth(FADE.near[0], FADE.near[1], Math.hypot(dx, dy, dz));
  const ax = feet.x - cam.x, ay = feet.y + FADE.mid - cam.y, az = feet.z - cam.z, ab = ax * ax + ay * ay + az * az;
  const t = Math.min(1, Math.max(0, (dx * ax + dy * ay + dz * az) / Math.max(ab, 1e-4)));
  const seg = Math.hypot(dx - ax * t, dy - ay * t, dz - az * t), los = t < FADE.losEnd ? 1 - smooth(FADE.los[0], FADE.los[1], seg) : 0;
  const qy = Math.min(feet.y + FADE.tall, Math.max(feet.y, p.y));
  return Math.max(near, los) * smooth(FADE.boy[0], FADE.boy[1], Math.hypot(p.x - feet.x, p.y - qy, p.z - feet.z));
}

/** 邮差页：视线上的东西比他脚下高出这么多以上才淡。 */
export const WALK_LOS_MIN = 0.75;
/** 整个人一起淡（邮差页用）：最多几个、圆柱多粗（半径，米）、从脚往上多高。 */
export const GHOST = { max: 4, r: 0.45, h: 2.4 } as const;

/**
 * 着色器里要的三个量：开没开、镜头的位置（three 自带 cameraPosition）、男孩脚下。
 * opts.ghosts（只有邮差页传）：另外再给几个「整个人一起淡」的位置——每个是 (脚下 x, y, z, 淡几成)，以他脚下为底的一根圆柱里的像素按同一个比例抖动丢掉，
 * 整个人均匀地变淡（M2 验收：镜头跟前的路人被按像素的网点啃掉半个大头，比整个人淡掉难看）。不传就和原来一字不差（滑板页不受影响）。
 */
export function createNearFade(opts: { ghosts?: boolean } = {}) {
  const ghosts = Array.from({ length: GHOST.max }, () => new THREE.Vector4(0, 0, 0, 0));
  const uniforms: Record<string, { value: unknown }> & { uNearFadeOn: { value: number }; uNearFadeBoy: { value: THREE.Vector3 } } = { uNearFadeOn: { value: 0 }, uNearFadeBoy: { value: new THREE.Vector3() } };
  if (opts.ghosts) { uniforms.uNearGhost = { value: ghosts }; uniforms.uNearLos = { value: 1 }; }
  const patched = new WeakSet<THREE.Material>();
  const VERT_HEAD = 'varying vec3 vNearFadeW;\n';
  const VERT_BODY = `
  {
    vec4 nfw = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      nfw = instanceMatrix * nfw;
    #endif
    vNearFadeW = ( modelMatrix * nfw ).xyz;
  }`;
  const FRAG_HEAD = 'varying vec3 vNearFadeW;\nuniform float uNearFadeOn;\nuniform vec3 uNearFadeBoy;\n' + (opts.ghosts ? `uniform vec4 uNearGhost[ ${GHOST.max} ];\nuniform float uNearLos;\n` : '');
  /**
   * 邮差页（opts.ghosts）：挡在视线上的那一项只淡比他膝盖高的（矮花盆、石墩、栏杆底不淡），而且可以整个关掉（双人机位时）。
   * 试玩第 2 轮：几乎每个停下来的画面都有一团网点，矮花盆、石墩都被打成网点，交信那一刻收信人自己半个人是网点。滑板页不传，一字不差。
   */
  const LOS_GATE = opts.ghosts ? ` && uNearLos > 0.5 && vNearFadeW.y > uNearFadeBoy.y + ${WALK_LOS_MIN.toFixed(2)}` : '';
  const GHOST_BODY = opts.ghosts ? `
  if ( uNearFadeOn > 0.5 ) {
    float ng = 0.0;
    for ( int i = 0; i < ${GHOST.max}; i++ ) {
      vec4 g = uNearGhost[ i ];
      vec2 gd = vNearFadeW.xz - g.xz;
      if ( g.w > 0.0 && dot( gd, gd ) < ${(GHOST.r * GHOST.r).toFixed(4)} && vNearFadeW.y > g.y + 0.03 && vNearFadeW.y < g.y + ${GHOST.h.toFixed(2)} ) ng = max( ng, g.w );
    }
    if ( ng > 0.0 && fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) ) < ng ) discard;
  }` : '';
  const FRAG_BODY = `
  if ( uNearFadeOn > 0.5 && vNearFadeW.y >= cameraPosition.y - ${FADE.below.toFixed(2)} ) {
    vec3 nfd = vNearFadeW - cameraPosition, nfa = uNearFadeBoy + vec3( 0.0, ${FADE.mid.toFixed(2)}, 0.0 ) - cameraPosition;
    float nfNear = 1.0 - smoothstep( ${FADE.near[0].toFixed(2)}, ${FADE.near[1].toFixed(2)}, length( nfd ) );
    float nft = clamp( dot( nfd, nfa ) / max( dot( nfa, nfa ), 1e-4 ), 0.0, 1.0 );
    float nfLos = nft < ${FADE.losEnd.toFixed(2)}${LOS_GATE} ? 1.0 - smoothstep( ${FADE.los[0].toFixed(2)}, ${FADE.los[1].toFixed(2)}, length( nfd - nfa * nft ) ) : 0.0;
    vec3 nfq = vec3( uNearFadeBoy.x, clamp( vNearFadeW.y, uNearFadeBoy.y, uNearFadeBoy.y + ${FADE.tall.toFixed(2)} ), uNearFadeBoy.z );
    float nf = max( nfNear, nfLos ) * smoothstep( ${FADE.boy[0].toFixed(2)}, ${FADE.boy[1].toFixed(2)}, length( vNearFadeW - nfq ) );
    float nfNoise = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
    if ( nfNoise < nf ) discard;
  }`;
  /** 给一个材质打上补丁（同一个材质只打一次；原来有 onBeforeCompile 的接着调它）。 */
  function patch(m: THREE.Material) {
    if (patched.has(m) || !(m instanceof THREE.MeshStandardMaterial)) return;
    patched.add(m);
    const before = m.onBeforeCompile.bind(m), key = m.customProgramCacheKey.bind(m);
    m.onBeforeCompile = (shader, renderer) => {
      before(shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = VERT_HEAD + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>${VERT_BODY}`);
      shader.fragmentShader = FRAG_HEAD + shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>${FRAG_BODY}${GHOST_BODY}`);
    };
    m.customProgramCacheKey = () => `${key()}|nearfade${opts.ghosts ? 'g' : ''}`;
    m.needsUpdate = true;
  }
  return {
    uniforms,
    /** 把 root 底下所有网格的材质都打上补丁，skip 底下的不动（男孩自己的材质是单独复制出来的，不受影响）。 */
    patchTree(root: THREE.Object3D, skip: THREE.Object3D[] = []) {
      const no = new Set<THREE.Object3D>();
      for (const s of skip) s.traverse((o) => no.add(o));
      root.traverse((o) => {
        if (no.has(o) || !(o instanceof THREE.Mesh)) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) patch(m);
      });
    },
    set(on: boolean, feet: THREE.Vector3, los = true) { uniforms.uNearFadeOn.value = on ? 1 : 0; uniforms.uNearFadeBoy.value.copy(feet); if (uniforms.uNearLos) uniforms.uNearLos.value = los ? 1 : 0; },
    /** 整个人一起淡的那几个位置（opts.ghosts 时才有用）：list 是 (脚下 x, y, z, 淡几成 0–1)，多出 GHOST.max 的不要，少的补 0。 */
    setGhosts(list: readonly (readonly [number, number, number, number])[]) { for (let i = 0; i < GHOST.max; i++) { const g = list[i]; if (g) ghosts[i].set(g[0], g[1], g[2], g[3]); else ghosts[i].set(0, 0, 0, 0); } },
  };
}
