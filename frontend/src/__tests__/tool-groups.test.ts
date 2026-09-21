// 工具合并（"查阅"组）的判定与分组。夹具直接用真实会话里那批命令——它们全是
// `cd X && 程序 | grep … 2>/dev/null | head` 这种形态，是本功能的真实负载：
// 判定必须能认出来（否则"整屏 bash 行"这个要解决的问题原样还在）。
import { describe, expect, it } from "vitest";
import {
  classifyExploreItem, formatExploreSummary, groupExploreItems, isExploreItem, isReadOnlyCommand,
} from "../session/toolGroups";
import type { RenderItem } from "../session/renderModel";

let seq = 0;
const tool = (toolName: string, args = ""): RenderItem =>
  ({ key: `k${++seq}`, kind: "tool-call", toolName, args }) as RenderItem;

/** 真实负载：截图里那批只读排查命令。 */
const REAL_READONLY = [
  'grep -rn "DS_Store\\|烘成\\|访问\\|Finder" --include="*.md" --include="*.sh" --include="*.mjs" .',
  "cd /Users/hanbyking/Documents/DSHmini && plutil -p design/dmg/DS_Store 2>&1 | head -60",
  "cd /Users/hanbyking/Documents/DSHmini && strings -a design/dmg/DS_Store | head -40",
  'cd /Users/hanbyking/Documents/DSHmini && ls -la dist/ 2>/dev/null | head; echo "=== DS_Store history ==="; git log --oneline -3',
  'cd /Users/hanbyking/Documents/DSHmini && grep -rn "自动化授权\\|访问访达\\|osascript\\|hdiutil" --include="*.md" .',
  'cd /Users/hanbyking/Documents/DSHmini && hdiutil info | grep -i "DeepDive\\|image-path" | head -20; echo "=== info ==="',
  "cd /Users/hanbyking/Documents/DSHmini && hdiutil info | awk '/DeepDive-0.1.0-dev/{f=1} f' | head -20",
  'mount | grep -i "disk9\\|disk10" ; echo "=== diskutil ==="; diskutil list disk9 2>&1 | head -20',
  'hdiutil info | grep -n "^image-path\\|^/dev/disk\\|^framework name"',
  'cd /Users/hanbyking/Documents/DSHmini && hdiutil imageinfo dist/DeepDive-0.1.0-dev.dmg 2>&1 | grep -i "format"',
  'diskutil info /dev/disk10s1 2>&1 | head -20; echo "=== ps ==="; ps -p 31261 -o pid,command 2>&1 | head -3',
];

describe("isReadOnlyCommand：真实只读命令要认出来", () => {
  it.each(REAL_READONLY)("%s", (cmd) => {
    expect(isReadOnlyCommand(cmd)).toBe(true);
  });

  it.each([
    "rm -rf dist",
    "cd x && git commit -m 'x'",
    "sed -i '' 's/a/b/' f.txt",
    "echo hi > out.txt",
    "npm install",
    "mkdir -p a/b",
    "cat a > b",
    "git push",
    'echo "x" >> log.txt',
    "cd x && make package",
    "嗯这不是命令",
  ])("写操作/认不出来一律不算：%s", (cmd) => {
    expect(isReadOnlyCommand(cmd)).toBe(false);
  });
});

describe("isExploreItem：族与只读判定", () => {
  it("读族与搜索族一律算（不看命令）", () => {
    expect(isExploreItem(tool("read", "src/a.ts"))).toBe(true);
    expect(isExploreItem(tool("read_image"))).toBe(true);
    expect(isExploreItem(tool("grep", "foo"))).toBe(true);
    expect(isExploreItem(tool("glob", "**/*.ts"))).toBe(true);
    expect(isExploreItem(tool("web_search"))).toBe(true);
  });
  it("写族/代码/技能/提问一律不算", () => {
    for (const name of ["write", "edit", "str_replace_editor", "apply_patch", "run_code", "skill", "ask_user_question"]) {
      expect(isExploreItem(tool(name))).toBe(false);
    }
  });
  it("命令族按只读判定：只读的算，写的不算", () => {
    expect(isExploreItem(tool("bash", REAL_READONLY[1]!))).toBe(true);
    expect(isExploreItem(tool("bash", "rm -rf dist"))).toBe(false);
  });
});

describe("groupExploreItems：连续同族且 ≥2 条才成组", () => {
  it("一整屏只读 bash（截图那种）折成一个组", () => {
    const items = REAL_READONLY.map((c) => tool("bash", c));
    const units = groupExploreItems(items);
    expect(units).toHaveLength(1);
    const g = units[0]!;
    expect(g.kind).toBe("explore-group");
    if (g.kind !== "explore-group") throw new Error("unreachable");
    expect(g.members).toHaveLength(11);
    expect(g.indices).toEqual(items.map((_, i) => i));
    // key 锚在首个成员上：流式追加不会换身份
    expect(g.key).toBe(`explore:${items[0]!.key}`);
  });

  it("单条不成组（原样保留成普通行）", () => {
    const units = groupExploreItems([tool("read", "a.ts")]);
    expect(units).toEqual([{ kind: "item", index: 0, item: expect.objectContaining({ toolName: "read" }) }]);
  });

  it("写操作/换族即断组", () => {
    const items = [tool("read", "a"), tool("read", "b"), tool("write", "c"), tool("read", "d"), tool("read", "e")];
    const units = groupExploreItems(items);
    expect(units.map((u) => u.kind)).toEqual(["explore-group", "item", "explore-group"]);
  });

  it("读+搜混合成一组，命令族的写操作不入组", () => {
    const items = [tool("read", "a.ts"), tool("grep", "x"), tool("glob", "**/*"), tool("bash", "ls -la")];
    const [g] = groupExploreItems(items);
    expect(g!.kind).toBe("explore-group");
  });
});

describe("formatExploreSummary：桶序固定、0 不出现、逗号分隔", () => {
  const zh = (_zh: string, _en: string, _n: number) => _zh;
  it("按搜索 → 列表 → 文件计数", () => {
    const items = [tool("grep", "x"), tool("glob", "**/*"), tool("read", "a.ts"), tool("read", "b.ts")];
    expect(formatExploreSummary(items, zh)).toBe("1 搜索, 1 列表, 2 文件");
  });
  it("只出现命中的桶", () => {
    expect(formatExploreSummary([tool("read", "a"), tool("read", "b")], zh)).toBe("2 文件");
    expect(formatExploreSummary([tool("grep", "x"), tool("grep", "y")], zh)).toBe("2 搜索");
  });
  it("有内容的桶一个不少（计数之和 = 成员数）", () => {
    const items = REAL_READONLY.map((c) => tool("bash", c));
    const counts = items.map(classifyExploreItem);
    expect(counts).toHaveLength(items.length);
  });
});
