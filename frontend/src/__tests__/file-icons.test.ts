// 文件图标解析：映射照 Material Icon Theme 官方清单（node_modules/material-icon-theme/
// dist/material-icons.json）抄。这几条把「照抄的结论」钉住——尤其清单里与直觉不同的
// 几处（ogg 归 video、package.json 归 nodejs 而不是 json），免得后来者按常理"修正"。
import { describe, expect, it } from "vitest";
import { resolveFileIconName } from "../session/fileIcons";

describe("resolveFileIconName：按扩展名", () => {
  it.each([
    ["a.ts", "typescript"], ["a.mts", "typescript"], ["a.cts", "typescript"],
    ["a.tsx", "react_ts"], ["a.jsx", "react"],
    ["a.js", "javascript"], ["a.mjs", "javascript"], ["a.cjs", "javascript"],
    ["a.css", "css"], ["a.scss", "sass"], ["a.less", "less"], ["a.styl", "stylus"],
    ["a.json", "json"], ["a.md", "markdown"], ["a.txt", "document"],
    ["a.py", "python"], ["a.rs", "rust"], ["a.go", "go"], ["a.rb", "ruby"],
    ["a.php", "php"], ["a.java", "java"], ["a.kt", "kotlin"], ["a.swift", "swift"], ["a.vue", "vue"],
    ["a.html", "html"], ["a.sh", "console"], ["a.zsh", "console"],
    ["a.yml", "yaml"], ["a.toml", "toml"], ["a.xml", "xml"], ["a.sql", "database"],
    ["a.png", "image"], ["a.pdf", "pdf"], ["a.docx", "word"], ["a.xlsx", "table"],
    ["a.pptx", "powerpoint"], ["a.mp3", "audio"], ["a.mp4", "video"],
    ["a.zip", "zip"], ["a.tar.gz", "zip"], ["a.lock", "lock"], ["a.svg", "svg"],
  ])("%s → %s", (file, icon) => {
    expect(resolveFileIconName(file)).toBe(icon);
  });

  it("清单里与直觉不同的两处：ogg 归 video、csv 归 table", () => {
    expect(resolveFileIconName("a.ogg")).toBe("video");
    expect(resolveFileIconName("a.csv")).toBe("table");
  });
});

describe("resolveFileIconName：整名优先", () => {
  it.each([
    ["Dockerfile", "docker"], ["Makefile", "makefile"],
    ["README", "readme"], ["LICENSE", "license"],
    ["package.json", "nodejs"], ["package-lock.json", "nodejs"],
    ["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"],
    [".gitignore", "git"], ["tsconfig.json", "tsconfig"], ["vite.config.ts", "vite"],
  ])("%s → %s", (file, icon) => {
    expect(resolveFileIconName(file)).toBe(icon);
  });

  it("整名压过扩展名；带后缀时逐级剥掉尾部段落", () => {
    expect(resolveFileIconName("package.json")).toBe("nodejs"); // 不是 json
    expect(resolveFileIconName("Dockerfile.dev")).toBe("docker");
    expect(resolveFileIconName("package.json.bak")).toBe("nodejs");
  });

  it("只认叶子名，忽略目录", () => {
    expect(resolveFileIconName("/Users/x/src/a.ts")).toBe("typescript");
    expect(resolveFileIconName("src/nested/Makefile")).toBe("makefile");
  });

  it("未收录的一律回通用文件图标", () => {
    expect(resolveFileIconName("a.unknownext")).toBe("document");
    expect(resolveFileIconName(".env")).toBe("document");
    expect(resolveFileIconName("无扩展名")).toBe("document");
    expect(resolveFileIconName("")).toBe("document");
  });
});
