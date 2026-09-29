#!/usr/bin/env python3
"""量运行中的 DeepDive：坐标与 computed style 的取数口（配合壳侧 UiProbe）。

    scripts/probe.py rect  .sidebar .panel            每个选择器的矩形（窗口坐标）
    scripts/probe.py styles .composer --props background-color box-shadow
    scripts/probe.py window                            窗口与原生层的真实几何
    scripts/probe.py raw .md '{"props":["line-height"]}'   原样 JSON（自己后处理）

为什么有它：改样式/布局必须用可量化的数字自证（docs/WORKING-AGREEMENTS.md §2），
此前取数靠临时 evaluateJavaScript，用完还原；这里是一条常驻通道，顺带能报 JS 量不到
的原生层（窗口、两块 WKWebView、侧栏浏览器视图）。

前提：应用正在运行。端点与 boot token 由壳写在
~/Library/Application Support/DeepDive/probe.json（0600，仅当前用户可读）；
token 只活本次进程——应用没开、或已经重启过，这里会拿到 403 或连不上。

边界（与 WORKING-AGREEMENTS §2 一致）：**只回数据，不做视觉判断**。截图与"好不好看"
仍然归用户。
"""

import json
import os
import sys
import urllib.error
import urllib.request

HOME = os.path.expanduser("~/Library/Application Support/DeepDive/probe.json")
DEFAULT_PROPS = [
    "width", "height", "padding", "margin", "border-radius", "background-color",
    "color", "opacity", "box-shadow", "font-size", "line-height", "font-weight",
    "letter-spacing", "transform", "transition", "display", "position", "overflow",
]


def endpoint():
    if not os.path.exists(HOME):
        sys.exit(f"探针端点不在 {HOME} —— 应用在跑吗？（token 随进程起落）")
    with open(HOME) as f:
        info = json.load(f)
    return "http://127.0.0.1:%d/__probe" % info["port"], info["token"]


def call(selectors, props=None):
    url, token = endpoint()
    body = json.dumps({"selectors": selectors, "props": props or DEFAULT_PROPS}).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        sys.exit("HTTP %d —— token 失效了？重启应用再试。" % e.code)
    except urllib.error.URLError:
        sys.exit("连不上桥 —— 应用在跑吗？")


def show_nodes(nodes):
    for n in nodes:
        if n.get("missing"):
            print("%-28s (选择器没命中)" % n["selector"])
            continue
        r = n["rect"]
        print("%-28s x=%-8s y=%-8s w=%-8s h=%s" % (
            n["selector"], r["x"], r["y"], r["w"], r["h"]))


def show_styles(nodes):
    for n in nodes:
        if n.get("missing"):
            print("%-28s (选择器没命中)" % n["selector"])
            continue
        print(n["selector"])
        for k, v in n["styles"].items():
            if v:
                print("    %-18s %s" % (k, v))


def show_native(native):
    for k, v in native.items():
        if isinstance(v, dict):
            print("%-16s x=%-8s y=%-8s w=%-8s h=%s" % (
                k, v.get("x"), v.get("y"), v.get("w"), v.get("h")))
        else:
            print("%-16s %s" % (k, v))


def main(argv):
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__.strip())
        return 0
    verb, rest = argv[0], argv[1:]

    if verb == "window":
        show_native(call([".app"])["native"])
        return 0

    if verb == "raw":
        selectors = [rest[0]] if rest else []
        props = json.loads(rest[1]).get("props") if len(rest) > 1 else None
        print(json.dumps(call(selectors, props), ensure_ascii=False, indent=2))
        return 0

    props = None
    if "--props" in rest:
        i = rest.index("--props")
        rest, props = rest[:i], rest[i + 1:]
    selectors = [a for a in rest if not a.startswith("--")]
    if not selectors:
        sys.exit("用法：scripts/probe.py %s <选择器…> [--props 属性…]" % verb)

    result = call(selectors, props)
    if not result.get("ok"):
        sys.exit("探针失败：%s" % result.get("error"))
    if verb == "rect":
        show_nodes(result["nodes"])
    elif verb == "styles":
        show_styles(result["nodes"])
    else:
        sys.exit("未知命令 %s（rect / styles / window / raw）" % verb)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
