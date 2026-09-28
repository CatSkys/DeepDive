// 引擎 fork 的 spec 运行配置（`cd engine && node node_modules/vitest/vitest.mjs run <spec>`）。
//
// 上游的 harness（vitest.config.ts + 各 lane 配置 + coverage 分区脚本）没有随
// scripts/sync-engine-fork.mjs 进本仓，而**带 `@Remote` 装饰器的服务端 spec 没有
// 它就一条用例都跑不起来**：Vite/esbuild 不降级标准装饰器，装饰器原样进 V8 就是
// `SyntaxError: Invalid or unexpected token`，症状是「0 test / Failed Suites 1」
// ——看着像加载失败，不是断言失败。所以这里只留跑包级 spec 所需的最小一份：
//
// - standardDecoratorPlugin：上游 vitest.shared.ts 逐字，装饰器先过一遍 tsc；
// - vite-tsconfig-paths（配 tsconfig.base.json，它没有 include = 匹配所有文件）：
//   让 `@deepseek-ai/*` **在每个文件里都**命中源码而不是已构建的 lib/。
//   这一步不能用 Vite 原生的 `resolve.tsconfigPaths`：它按文件所属 tsconfig 生效，
//   `src/**` 命中 paths 而 `tests/**` 落在任何 tsconfig 之外，同一个包于是被解析成
//   两份模块实例——`RemoteError` 的 `instanceof` 直接变假，测试以「code 对不上」的
//   面貌失败，最难查的那种；
// - pool: forks：上游同样如此（worker 线程里 Node 的 CJS 词法器会 abort）。
//
// 上游的 coverage 门、process-bound 分区、平台排除表都没带进来：fork 自己的门是
// 构建 + 组合漂移 + 真实启动（make test / check-engine-composition.sh），这批 spec
// 是写代码时的自检工具，不是合入门（钉住的快照里还有存量失败）。
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin } from './vitest.shared.ts'

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    include: ['packages/*/*/tests/**/*.spec.{ts,tsx}', 'apps/*/tests/**/*.spec.ts'],
    pool: 'forks',
  },
})
