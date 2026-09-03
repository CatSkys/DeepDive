// ESLint flat config：TS 推荐规则 + react-hooks 两条规则。格式化不归 lint
// 管；`npm run lint` 必须零报错。生成物与 dist 不检查。
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist/", "packages/design/generated/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      // v7 新增规则（refs 渲染期访问 / effect 内 setState / 组件外重赋值等）
      // 与全仓"可变量走 ref 镜像"约定（health-report AUD-027）及挂载期初始化
      // 模式大面积冲突，属 React Compiler 级纪律，待 P2-6 store 决策后再评估；
      // 显式只启用经典两条。
    },
  },
);
