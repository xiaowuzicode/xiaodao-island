/**
 * 放映台银幕放视频：小岛介绍片的一段静音循环（public/island/cinema-loop.mp4，480×270、45 秒、约 1MB）贴成银幕纹理，
 * 同时当自发光贴图，夜里银幕亮起来就是画面在亮。开播前银幕保持原来的「小岛放映中」。
 * 重拍介绍片后重新裁这段：ffmpeg -ss 17.3 -t 45 -i island_mv_v2.mp4 -an -vf "scale=480:270,fps=24" -c:v libx264 -crf 30 -movflags +faststart cinema-loop.mp4
 */
import * as THREE from 'three';

export const CINEMA_LOOP = '/island/cinema-loop.mp4';

export function createScreenVideo(screen: THREE.MeshStandardMaterial) {
  let video: HTMLVideoElement | null = null;

  /** 开始加载并循环播放（幂等）。手机上等访客点开放映台才调，省流量。 */
  function start() {
    if (video) return;
    const v = (video = document.createElement('video'));
    // 静音 + 内联播放才允许自动播放（iOS 还要认属性）
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.preload = 'auto';
    v.src = CINEMA_LOOP;
    const tex = new THREE.VideoTexture(v);
    tex.colorSpace = THREE.SRGBColorSpace;
    v.addEventListener('playing', () => {
      const old = screen.map;
      screen.map = tex;
      screen.emissiveMap = tex;
      screen.needsUpdate = true;
      old?.dispose();
    }, { once: true });
    v.addEventListener('error', () => console.warn(`[island] 银幕视频 ${CINEMA_LOOP} 加载失败，保持静态画面`, v.error));
    v.play().catch((e) => console.warn('[island] 银幕视频没能自动播放，保持静态画面', e));
  }

  // 页面切走就停，回来接着放（不在后台白白解码）
  document.addEventListener('visibilitychange', () => {
    if (!video) return;
    if (document.hidden) video.pause();
    else video.play().catch((e) => console.warn('[island] 银幕视频恢复播放失败', e));
  });

  return { start };
}
