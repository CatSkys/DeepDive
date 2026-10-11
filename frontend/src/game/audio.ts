// DeepDiving 提示音：WebAudio 振荡器两枚——百米 ping（轻）与触底 thud（低）。
// AudioContext 惰性创建且只在用户手势后 prime（自动播放策略）；开关在 store
// （localStorage）。只管发声：不管开关的持久化（store.ts）。
import { soundOn } from "./store";

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  try {
    ctx = new AudioContext();
  } catch {
    return null; /* 无 WebAudio（受限环境）→ 静默 */
  }
  return ctx;
}

/** 首个用户手势（按住/按键）时调用：满足浏览器的自动播放解锁。 */
export function primeAudio(): void {
  const a = audio();
  if (a && a.state === "suspended") void a.resume();
}

function blip(freq: number, endFreq: number, durS: number, gain: number): void {
  if (!soundOn()) return;
  const a = audio();
  if (!a) return;
  const osc = a.createOscillator();
  const amp = a.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, a.currentTime);
  osc.frequency.exponentialRampToValueAtTime(endFreq, a.currentTime + durS);
  amp.gain.setValueAtTime(gain, a.currentTime);
  amp.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + durS);
  osc.connect(amp).connect(a.destination);
  osc.start();
  osc.stop(a.currentTime + durS);
}

/** 每下潜 100m：一声很轻的 ping。 */
export function pingMilestone(): void {
  blip(880, 880, 0.08, 0.04);
}

/** 破纪录：明亮的双音上扬。 */
export function pingRecord(): void {
  blip(880, 880, 0.07, 0.04);
  blip(1318, 1318, 0.09, 0.04);
}

/** 开跑：一声短促的上扬。 */
export function blipStart(): void {
  blip(330, 660, 0.12, 0.03);
}

/** 触底：下滑低音。 */
export function thudDeath(): void {
  blip(220, 70, 0.25, 0.06);
}
