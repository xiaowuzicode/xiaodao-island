/**
 * 页面里的播放窗：嵌 B 站站外播放器放完整视频（有声音、能全屏），关掉就停。
 * 不依赖 three：手机静态图模式下卡片里的「播放」也能用。
 */
import { playerUrl, videoUrl } from '@/island/videos';

let wired = false;

function wire(dlg: HTMLDialogElement, frame: HTMLIFrameElement) {
  if (wired) return;
  wired = true;
  // 关窗（× / Esc / 点窗外）时把播放器换成空白页，声音立刻停
  dlg.addEventListener('close', () => frame.removeAttribute('src'));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.getElementById('isl-player-close')?.addEventListener('click', () => dlg.close());
}

/** 是否正开着播放窗（开着时 Esc 只关播放窗，不连带关内容卡）。 */
export const playerOpen = () => (document.getElementById('isl-player') as HTMLDialogElement | null)?.open === true;

export function openPlayer(bvid: string, title: string) {
  const dlg = document.getElementById('isl-player');
  const frame = document.getElementById('isl-player-frame');
  if (!(dlg instanceof HTMLDialogElement) || !(frame instanceof HTMLIFrameElement) || typeof dlg.showModal !== 'function') {
    console.warn('[island] 页面缺少播放窗或浏览器不支持 <dialog>，改为新标签页打开 B 站', bvid);
    window.open(videoUrl(bvid), '_blank', 'noopener');
    return;
  }
  wire(dlg, frame);
  const head = document.getElementById('isl-player-title');
  if (head) head.textContent = title;
  const out = document.getElementById('isl-player-out');
  if (out instanceof HTMLAnchorElement) out.href = videoUrl(bvid);
  frame.src = playerUrl(bvid);
  if (!dlg.open) dlg.showModal();
}
