// 引导收尾的礼花音：礼花炮的气爆声（砰 + 沙沙），WebAudio 合成，无音频资产、无依赖。
//
// 为什么不是"叮"：提示音是两三个正弦音（要"听见一条信息"），礼花炮是瞬态噪声
// （要"什么东西炸开了"）——用正弦去配礼花，听感是系统通知而不是庆祝，实测被用户
// 直接否掉。所以这里按礼花炮的物理结构分三层叠：
//   · 冲击层 —— 正弦从 165Hz 扫到 58Hz，4ms 起音、~200ms 衰减（炮膛的"闷"）
//   · 气爆层 —— 白噪声过带通，中心频率 1600Hz 扫到 420Hz，3ms 起音、~130ms 衰减
//     （"啪"的那一下，礼花炮最标志性的瞬态）
//   · 纸屑层 —— 白噪声过高通（2.4kHz 以上），慢起音、线性衰减 ~0.6–0.7s，左右各一份
//     **独立**噪声做立体声展开（纸屑落下来的"沙沙"）
// 三段都是短包络，整体不到一秒。
//
// 任何一步失败都静默（不支持 WebAudio / 上下文被策略挡 / 用户静音 / 音频设备被占）
// ——庆祝音效不该因为环境差异报错或阻塞流程（铁律 5：降级是显式决定）。
export function playPartyPopper(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const t0 = ctx.currentTime + 0.01;
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);

    // 白噪声（1 秒余量，够铺满最长的纸屑尾音）。**每条独立生成**：左右纸屑层若共用
    // 一段噪声再错开几毫秒，那只是延迟而不是去相关（实测相关度仍 0.97），立体声展宽
    // 等于没有。
    const makeNoise = () => {
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      return buf;
    };
    const noiseAt = (buf: AudioBuffer) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      return src;
    };
    /** 指数包络：起音尽量陡（瞬态），之后指数衰减到听不见。 */
    const envelope = (peak: number, attack: number, decay: number) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
      return g;
    };

    // 冲击层：低频下滑，给"炸开"一点重量。
    const thump = ctx.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(165, t0);
    thump.frequency.exponentialRampToValueAtTime(58, t0 + 0.11);
    const thumpGain = envelope(0.3, 0.004, 0.2);
    thump.connect(thumpGain).connect(master);
    thump.start(t0);
    thump.stop(t0 + 0.26);

    // 气爆层：噪声带通中心频率下滑，礼花炮的"啪"。
    const pop = noiseAt(makeNoise());
    const popFilter = ctx.createBiquadFilter();
    popFilter.type = "bandpass";
    popFilter.Q.value = 0.9;
    popFilter.frequency.setValueAtTime(1600, t0);
    popFilter.frequency.exponentialRampToValueAtTime(420, t0 + 0.13);
    const popGain = envelope(0.34, 0.003, 0.13);
    pop.connect(popFilter).connect(popGain).connect(master);
    pop.start(t0);
    pop.stop(t0 + 0.2);

    // 纸屑层：带通噪声 + 左右声像，慢起音长尾，落在气爆之后。
    // 下限 2.4kHz / 上限 6.5kHz：只高通的话重心在 11kHz（实测），听感是"嘶嘶"的
    // 白噪而不是纸；掐掉顶端才落到纸屑该在的 4–5kHz 区间。
    // 尾音用**线性**衰减：指数从 0.075 起（衰减时间 0.7s）在 300ms 处已掉到 0.004，
    // 听感上纸屑 400ms 就没了，只剩"啪"一下——线性才撑得住 0.6s 的沙沙声。
    for (const [pan, peak, decay, delay] of [[-0.55, 0.09, 0.62, 0.04], [0.55, 0.09, 0.74, 0.06]] as const) {
      const flutter = noiseAt(makeNoise());
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 2400;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 6500;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t0 + delay);
      gain.gain.linearRampToValueAtTime(peak, t0 + delay + 0.03);
      gain.gain.linearRampToValueAtTime(0.0001, t0 + delay + 0.03 + decay);
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      flutter.connect(hp).connect(lp).connect(gain).connect(panner).connect(master);
      flutter.start(t0 + delay);
      flutter.stop(t0 + delay + 0.05 + decay);
    }

    // 播完即释放上下文：常驻 AudioContext 会占着音频会话（系统"正在播放"指示）。
    window.setTimeout(() => void ctx.close().catch(() => undefined), 1400);
  } catch { /* 不支持 WebAudio / 上下文被策略拒绝：静默，庆祝音效非功能必需 */ }
}
