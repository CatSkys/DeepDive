// 游戏音效总开关（两个游戏共用一把）：localStorage 纯客户端偏好，桥端口轮换会清零
// （与 autoArchive 同一条显式取舍）。只管开关的读写：不管发声（各游戏 audio 模块）。

const SOUND_KEY = "deepdive.gameSound";

/** 提示音开关，默认开。 */
export function soundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "0";
  } catch {
    return true; /* 无 localStorage（测试/受限环境）→ 默认开 */
  }
}

export function setSoundOn(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, on ? "1" : "0");
  } catch {
    /* 无 localStorage → 本次只在内存 */
  }
}
