/**
 * 小岛邮差：声音晚一步下载（M3 验收 r1：walk 自己的 JS 块超了预算）。
 * 声音在第一次点击 / 按键之前本来就不出声（浏览器的自动播放限制），合成声音的那一块（sound.ts，约 3 KB）不用跟着首屏一起下：
 * 页面可玩以后空闲时预取，或者玩家先动了手就马上取。取到之前这里先替它记着静音、音乐两个开关，别的调用一律不出声。
 * 取到以后，取之前那次「解锁」补上（多数浏览器认这一页已经有过手势；不认的话下一次点击还会再解锁）。
 */
import type { Bed, WalkSound } from '@/island/walk/sound';
import type { Surface } from '@/island/walk/ground';

export function createLazySound(prefs: { muted: boolean; music: boolean }): WalkSound & { load(): Promise<void> } {
  let real: WalkSound | null = null, loading: Promise<void> | null = null, wantUnlock = false;
  let muted = prefs.muted, music = prefs.music;
  const load = () => (loading ??= import('@/island/walk/sound').then((m) => {
    real = m.createWalkSound({ muted, music });
    if (wantUnlock) real.unlock();
  }).catch((e) => console.warn('[walk] 声音没下载下来', e)));
  return {
    load,
    unlock() { if (real) real.unlock(); else { wantUnlock = true; void load(); } },
    pause() { real?.pause(); },
    get muted() { return real ? real.muted : muted; },
    setMuted(m: boolean) { muted = m; real?.setMuted(m); },
    get music() { return real ? real.music : music; },
    setMusic(on: boolean) { music = on; real?.setMusic(on); },
    get level() { return real ? real.level : muted ? 0 : 1; },
    get musicLevel() { return real ? real.musicLevel : music ? 1 : 0; },
    get state() { return real ? real.state : 'none'; },
    bed(b: Bed, dt: number) { real?.bed(b, dt); },
    step(surface: Surface, run: boolean) { real?.step(surface, run); },
    talk(voice) { real?.talk(voice); },
    deliver() { real?.deliver(); },
    paper() { real?.paper(); },
    tick() { real?.tick(); },
    bag() { real?.bag(); },
    zone() { real?.zone(); },
    ui() { real?.ui(); },
  };
}
