// EN 词典聚合器（2026-10-12 从单文件按注释段切分为 i18n-en/ 下 6 个域文件）：
// 中文源串为键、英文为值；只放数据不放逻辑，新增词条进对应域文件。
// 键的纪律与缺键扫描见 i18n.ts 头注释。
import { ENShell } from "./i18n-en/shell";
import { ENSession } from "./i18n-en/session";
import { ENBrowser } from "./i18n-en/browser";
import { ENSettings } from "./i18n-en/settings";
import { ENRich } from "./i18n-en/rich";
import { ENOnboarding } from "./i18n-en/onboarding";

export const EN: Record<string, string> = {
  ...ENShell,
  ...ENSession,
  ...ENBrowser,
  ...ENSettings,
  ...ENRich,
  ...ENOnboarding,
};
