// 工具执行合并：三组（查阅/终端/更改）的判定、分组与摘要。夹具用真实会话里那批命令
// （`cd X && 程序 | grep … 2>/dev/null | head` 这种形态），并且**同时覆盖原始命令串与
// JSON 参数两种形态**——后者漏剥过一次，真实会话里那 11 条 bash 全因此没并成组。
import { describe, expect, it } from "vitest";
import {
  changedFiles, classifyExploreItem, commandOf, formatGroupSummary, groupKindOf, groupSummarySplit, groupTools,
  isReadOnlyCommand,
} from "../session/toolGroups";
import type { RenderItem } from "../session/renderModel";

let seq = 0;
const tool = (toolName: string, args = "", failed?: boolean): RenderItem =>
  ({ key: `k${++seq}`, kind: "tool-call", toolName, args, failed }) as RenderItem;
/** 引擎另一种参数形态：把命令包进 JSON。 */
const asJson = (command: string) => JSON.stringify({ command });

/** 摘要文案：取中文分支并替换占位符（ttPair 的签名是 (zh, en, vars)）。 */
function zh(zhText: string, enText: string, vars?: Record<string, string | number>): string {
  const chosen = zhText.length > 0 ? zhText : enText;
  if (!vars) return chosen;
  let out = chosen;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

/** 真实负载：截图里那批只读排查命令。 */
const REAL_READONLY = [
  'date; echo "--- ls-files ---"; git ls-files design/dmg/; echo "--- file ---"; ls -la design/dmg/',
  'grep -rn "DS_Store\\|烘成\\|访问\\|Finder" --include="*.md" --include="*.sh" --include="*.mjs" .',
  "cd /Users/dev/DeepDive && plutil -p design/dmg/DS_Store 2>&1 | head -60",
  "cd /Users/dev/DeepDive && strings -a design/dmg/DS_Store | head -40",
  'cd /Users/dev/DeepDive && ls -la dist/ 2>/dev/null | head; echo "=== DS_Store history ==="; git log --oneline -3',
  'cd /Users/dev/DeepDive && grep -rn "自动化授权\\|访问访达\\|osascript\\|hdiutil" --include="*.md" .',
  'cd /Users/dev/DeepDive && hdiutil info | grep -i "DeepDive\\|image-path" | head -20; echo "=== info ==="',
  "cd /Users/dev/DeepDive && hdiutil info | awk '/DeepDive-0.1.0-dev/{f=1} f' | head -20",
  'mount | grep -i "disk9\\|disk10" ; echo "=== diskutil ==="; diskutil list disk9 2>&1 | head -20',
  'hdiutil info | grep -n "^image-path\\|^/dev/disk\\|^framework name"',
  'diskutil info /dev/disk10s1 2>&1 | head -20; echo "=== ps ==="; ps -p 31261 -o pid,command 2>&1 | head -3',
];

describe("commandOf：原始命令串与 JSON 两种形态", () => {
  it("原始命令串原样返回", () => {
    expect(commandOf("ls -la")).toBe("ls -la");
  });
  it("JSON 形态取命令字段（command / cmd / script）", () => {
    expect(commandOf(asJson("git status"))).toBe("git status");
    expect(commandOf(JSON.stringify({ cmd: "ls" }))).toBe("ls");
    expect(commandOf(JSON.stringify({ script: "echo hi" }))).toBe("echo hi");
  });
  it("JSON 里没有命令字段 / 非法 JSON：退回原串", () => {
    expect(commandOf('{"path":"/tmp/a"}')).toBe('{"path":"/tmp/a"}');
    expect(commandOf("{不是 json")).toBe("{不是 json");
  });
});

describe("isReadOnlyCommand：真实只读命令要认出来", () => {
  it.each(REAL_READONLY)("%s", (cmd) => {
    expect(isReadOnlyCommand(cmd)).toBe(true);
  });
  it.each([
    "rm -rf dist", "cd x && git commit -m 'x'", "sed -i '' 's/a/b/' f.txt",
    "echo hi > out.txt", "npm install", "mkdir -p a/b", "git push", 'echo "x" >> log.txt',
  ])("写操作一律不算：%s", (cmd) => {
    expect(isReadOnlyCommand(cmd)).toBe(false);
  });
  it("JSON 形态也要能判（漏剥过一次）", () => {
    expect(isReadOnlyCommand(commandOf(asJson(REAL_READONLY[1]!)))).toBe(true);
    expect(isReadOnlyCommand(commandOf(asJson("rm -rf dist")))).toBe(false);
  });
});

describe("groupKindOf：三类的归属", () => {
  it("读族/搜索族 → 查阅", () => {
    for (const name of ["read", "read_file", "read_image", "grep", "glob", "web_search", "web_fetch"]) {
      expect(groupKindOf(tool(name))).toBe("explore");
    }
  });
  it("写族 → 更改", () => {
    for (const name of ["write", "edit", "str_replace_editor", "multiedit", "apply_patch"]) {
      expect(groupKindOf(tool(name))).toBe("changes");
    }
  });
  it("命令族：只读 → 查阅，其余 → 终端（两种参数形态都算）", () => {
    expect(groupKindOf(tool("bash", REAL_READONLY[2]!))).toBe("explore");
    expect(groupKindOf(tool("bash", asJson(REAL_READONLY[2]!)))).toBe("explore");
    expect(groupKindOf(tool("bash", asJson("npm install")))).toBe("execute");
    expect(groupKindOf(tool("bash", ""))).toBe("execute");
  });
  it("代码/技能/提问/非工具项一律不入组", () => {
    for (const name of ["run_code", "skill", "ask_user_question", "todo_write"]) {
      expect(groupKindOf(tool(name))).toBeNull();
    }
    expect(groupKindOf({ key: "x", kind: "assistant" } as RenderItem)).toBeNull();
  });
});

describe("groupTools：相邻同类且 ≥2 条才成组", () => {
  it("一整屏只读 bash（截图那种）折成 1 个「查阅」组", () => {
    const items = REAL_READONLY.map((c) => tool("bash", c));
    const units = groupTools(items);
    expect(units).toHaveLength(1);
    const g = units[0]!;
    if (g.kind !== "tool-group") throw new Error("unreachable");
    expect(g.groupKind).toBe("explore");
    expect(g.members).toHaveLength(11);
    expect(g.indices).toEqual(items.map((_, i) => i));
    expect(g.key).toBe(`group:${items[0]!.key}`); // 锚在首个成员上
  });

  it("同一批命令换成 JSON 参数也照样成组（回归）", () => {
    const items = REAL_READONLY.map((c) => tool("bash", asJson(c)));
    const units = groupTools(items);
    expect(units).toHaveLength(1);
    if (units[0]!.kind !== "tool-group") throw new Error("unreachable");
    expect(units[0]!.groupKind).toBe("explore");
  });

  it("写命令成「终端」组，摘要给最新命令 + 命令数", () => {
    const items = [tool("bash", asJson("npm install")), tool("bash", asJson("make package")), tool("bash", asJson("rm -rf dist"))];
    const units = groupTools(items);
    expect(units).toHaveLength(1);
    if (units[0]!.kind !== "tool-group") throw new Error("unreachable");
    expect(units[0]!.groupKind).toBe("execute");
    expect(formatGroupSummary("execute", units[0]!.members, zh)).toBe("rm -rf dist · 3 个命令");
  });

  it("编辑族成「更改」组", () => {
    const items = [tool("edit", JSON.stringify({ file_path: "a.ts" })), tool("write", JSON.stringify({ file_path: "b.ts" }))];
    const units = groupTools(items);
    if (units[0]!.kind !== "tool-group") throw new Error("unreachable");
    expect(units[0]!.groupKind).toBe("changes");
    expect(changedFiles(units[0]!.members)).toEqual(["a.ts", "b.ts"]);
    expect(formatGroupSummary("changes", units[0]!.members, zh)).toBe("编辑 2 个文件 · a.ts, b.ts");
  });

  it("换类即断组；单条不成组", () => {
    const items = [
      tool("read", "a"), tool("read", "b"),          // 查阅
      tool("bash", asJson("npm install")),           // 终端（一条，不成组）
      tool("read", "c"), tool("read", "d"),          // 查阅
    ];
    expect(groupTools(items).map((u) => (u.kind === "tool-group" ? u.groupKind : "single"))).toEqual([
      "explore", "single", "explore",
    ]);
    expect(groupTools([tool("read", "a")])).toHaveLength(1);
  });
});

describe("formatGroupSummary：三类各自的形状", () => {
  it("查阅：最新一条摘要打头（读取族=动词+路径），桶计数跟后（0 不出现、逗号分隔）", () => {
    const items = [tool("grep", "x"), tool("glob", "**/*"), tool("read", "a.ts"), tool("read", "b.ts")];
    expect(formatGroupSummary("explore", items, zh)).toBe("读取 b.ts · 1 搜索, 1 列表, 2 文件");
    expect(formatGroupSummary("explore", [tool("read", "a"), tool("read", "b")], zh)).toBe("读取 b · 2 文件");
  });
  it("查阅：命令族成员的摘要走 bashSummary（description 优先），与单条行同口径", () => {
    const items = [
      tool("bash", asJson("sed -n '1,40p' a.ts")),
      tool("bash", JSON.stringify({ command: "tail -5 a.ts", description: "看结尾五行" })),
    ];
    expect(formatGroupSummary("explore", items, zh)).toBe("看结尾五行 · 2 文件");
  });
  it("终端：最新命令打头，失败计数另起一段", () => {
    const items = [tool("bash", asJson("npm test"), true), tool("bash", asJson("make"))];
    expect(formatGroupSummary("execute", items, zh)).toBe("make · 2 个命令 · 1 个失败");
  });
  it("更改：单文件与单条行同形（动词+路径），多文件动词 + 计数 + 清单", () => {
    expect(formatGroupSummary("changes", [tool("edit", JSON.stringify({ file_path: "only.ts" }))], zh)).toBe("编辑 only.ts");
    // write 也进动词族（2026-10-12 用户定稿）：动词位不带「文件」宾语，只说「写入」
    expect(formatGroupSummary("changes", [tool("write", JSON.stringify({ file_path: "new.md" }))], zh)).toBe("写入 new.md");
  });
  it("组头分段（groupSummarySplit）：徽标只跟真实路径，搜索族动词+查询词无徽标", () => {
    const read = groupSummarySplit("changes", [tool("edit", JSON.stringify({ file_path: "only.ts" }))], zh);
    expect(read).toEqual({ verb: "编辑", iconPath: "only.ts", text: "only.ts" });
    const search = groupSummarySplit("explore", [tool("grep", JSON.stringify({ pattern: "rateT" })), tool("read", JSON.stringify({ path: "a.ts" }))], zh);
    expect(search.verb).toBe("读取");
    expect(search.iconPath).toBe("a.ts");
    expect(search.text).toBe("a.ts · 1 搜索, 1 文件");
    const query = groupSummarySplit("explore", [tool("grep", JSON.stringify({ pattern: "rateT" }))], zh);
    expect(query.verb).toBe("搜索");
    expect(query.iconPath).toBeUndefined();
    expect(query.text).toBe("rateT · 1 搜索");
  });
  it("桶计数之和 = 成员数（不漏不重）", () => {
    const items = REAL_READONLY.map((c) => tool("bash", c));
    expect(items.map(classifyExploreItem)).toHaveLength(items.length);
  });
});
