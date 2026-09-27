// 工具名 → 语义族的分类口径（唯一映射，ToolIcon 按族选 glyph）。
// 特别钉住 mcp__*：官方 UI 不给 MCP 工具专属行——ui-tool 的 TOOL_VARIANTS 是精确
// 匹配表 + 缺省 others，而注册了 tool.call.toolview 专属卡的只有 ui-cordis
// （cordis_* 三兄弟）与 ui-skill（skill），mcp-client 不注册。所以 mcp__* 落 other
// 是官方口径而非缺口：不要为它加族，除非官方先加。
import { describe, expect, it } from "vitest";
import { toolVariant } from "../session/toolKind";
import type { ToolVariant } from "../session/toolKind";

describe("toolVariant：工具名 → 语义族", () => {
  it.each<[string, ToolVariant]>([
    ["bash", "shell"],
    ["terminal-bash", "shell"],
    ["pwsh", "shell"],
    ["write", "edit"],
    ["edit", "edit"],
    ["str_replace_editor", "edit"],
    ["multiedit", "edit"],
    ["apply_patch", "edit"],
    ["read", "read"],
    ["read_file", "read"],
    ["file_read", "read"],
    ["read_image", "read"],
    ["web_fetch", "read"],
    ["cordis_package_inspect", "read"],
    ["cordis_runtime_inspect", "read"],
    ["web_search", "search"],
    ["grep", "search"],
    ["glob", "search"],
    ["run_code", "code"],
    ["code_execute", "code"],
    ["skill", "skill"],
    ["ask_user_question", "question"],
    ["ask_user", "question"],
  ])("%s → %s", (name, variant) => {
    expect(toolVariant(name)).toBe(variant);
  });

  it.each(["mcp__github__create_issue", "mcp__filesystem__read_file", "mcp__x__y"])(
    "%s → mcp（用户定稿：MCP 工具给独立族，官方原口径是并入 others）",
    (name) => {
      expect(toolVariant(name)).toBe("mcp");
    },
  );

  it("未收录的名字一律回 other", () => {
    // jobs/goal 是包名不是工具名（工具名是 job_list/get_goal 这批）；见 toolKind 表
    for (const name of ["todo_write", "jobs", "goal", "完全不存在的工具"]) {
      expect(toolVariant(name)).toBe("other");
    }
  });

  it.each([
    ["subagent", "agent"],
    ["send_message", "agent"],
    ["interrupt_agent", "agent"],
    ["list_agents", "agent"],
    ["wait_agent", "agent"],
    ["get_goal", "goal"],
    ["create_goal", "goal"],
    ["update_goal", "goal"],
    ["schedule_create", "schedule"],
    ["schedule_list", "schedule"],
    ["schedule_delete", "schedule"],
    ["job_list", "job"],
    ["job_output", "job"],
    ["job_kill", "job"],
  ])("%s → %s（本仓应用级工具，名字对照引擎注册源）", (name, variant) => {
    expect(toolVariant(name)).toBe(variant);
  });
});
