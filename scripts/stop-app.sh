#!/bin/bash
# DeepDive — 停掉正在运行的实例，并等它真的退出。打包链与交付链共用这一份。
#
# 为什么打包前必须停：实例就是从待打包的那个包跑起来的，它的引擎子进程（node）正映射着
# 包里 Runtime 下的文件，`rm -rf` 删完又发现里面冒出新条目，就以 `Directory not empty`
# 把打包打断（PITFALLS §5.5）。不是权限问题，也不是"没删干净"。
#
# 只发 SIGTERM、不发 SIGKILL：让应用走正常退出路径（引擎子进程跟着收摊、偏好与 TCC 授权
# 正常落盘）。但退出不是瞬间的——描述符要等子进程收摊才真正释放——所以这里等它消失了才
# 返回，否则下游照样会撞上同一个竞态，只是概率低一些。
set -euo pipefail

PATTERN="DeepDive.app/Contents/MacOS/DeepDive"

if ! pgrep -f "$PATTERN" >/dev/null; then
  echo "== 没有正在运行的实例 =="
  exit 0
fi

pkill -f "$PATTERN"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if ! pgrep -f "$PATTERN" >/dev/null; then
    echo "== 旧实例已退出 =="
    exit 0
  fi
  sleep 0.5
done

echo "FAIL: 旧实例 5 秒内没退出（pid: $(pgrep -f "$PATTERN" | tr '\n' ' ')）——它会挡住打包，先手动处理。" >&2
exit 1
