// 引导收尾的小音效：两音一组的轻"叮"（WebAudio 合成，无音频资产、无依赖）。
//
// 为什么合成而不是带一个音频文件：一个几十 KB 的 wav/mp3 就为响 0.4 秒不值得，
// 而且合成音不受采样率/格式兼容影响。任何一步失败都静默（浏览器不支持 / 上下文
// 被策略挡住 / 用户静音）——庆祝音效不该因为环境差异报错或阻塞流程。
export function playCelebrationChime(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const now = ctx.currentTime;
    // 主音 + 上方五度：短促、带衰减包络，整体音量压得很低（0.05）——背景音，不抢戏。
    for (const [freq, delay, peak] of [[880, 0, 0.05], [1318.5, 0.09, 0.035]] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(peak, now + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.34);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.36);
    }
    // 播完即释放上下文：常驻 AudioContext 会占着音频会话（系统"正在播放"指示）。
    window.setTimeout(() => void ctx.close().catch(() => undefined), 700);
  } catch { /* 浏览器不支持 WebAudio / 上下文被策略拒绝：静默，庆祝音效非功能必需 */ }
}
