# CTV-15：`src/index.ts` 拆分设计

- 日期：2026-09-07
- 状态：已确认
- 条目：ROADMAP CTV-15（v1.4.0 首条，成本「大」）

## 背景

`src/index.ts` 是一个 265 行的文件，业务全部压在名为 `init()` 的单函数里（`:28-253`，225 行）。它顺序编号成 5 步——取项目名、处理非空目录、取包名、选框架/预设、问是否装依赖——prompt、决策、文件 IO、子进程调用全部混在同一层。

真正的问题不是行数，是**这个文件无法被测试导入**。障碍有三层，只解决其中任何一层都不够：

| 障碍 | 位置 | 后果 |
|---|---|---|
| `argv` 在模块顶层解析 | `:22` | 光导出 `init()` 没用，import 时就已经吃了测试进程的 `process.argv` |
| `spin` / `cwd` 模块级单例 | `:19-20` | 同上，且 `cwd` 被固定成 import 时刻的值 |
| `init()` 末尾自执行 | `:255` | import 即真跑一遍 CLI 并 `process.exit` |

因此 ROADMAP 在 v1.2.0 一节留了一条 ⚠️：给 `src/index.ts` 写单测必须先做 CTV-15。本设计要解除的就是这条。

## 范围

**纯重构，行为零变化。**

CTV-17（未知参数校验）、CTV-18（拼写修正）、CTV-19（绝对路径 targetDir）、CTV-20（`isEmpty` 的 ENOTDIR）、CTV-21（装完依赖的 next-steps）、CTV-29（取消时退出码为 0）同样落在这批代码上，**本条一律不碰**。

理由是成功判据的纯度：行为零变化时，「E2E 31 条一字不改、全绿」直接等价于「重构没弄坏东西」，任何一条红都是重构的错。一旦掺进行为改动，红了就要先分辨是预期的还是意外的，这个安全网立刻失效——而这是本仓库目前唯一能覆盖 `init()` 的安全网。

## 前置实测

设计依赖两个事实，均已实测，不靠推理。

**① 模板路径解析对文件层级敏感。** 现有代码是：

```ts
path.resolve(fileURLToPath(import.meta.url), '../..', `template-${template}`)
```

实测各位置的解析结果：

```
/repo/dist/index.js        -> /repo/template-vue-ts   ✅
/repo/src/index.ts         -> /repo/template-vue-ts   ✅
/repo/src/core/scaffold.ts -> /repo/src/template-vue-ts  ❌ 静默指向错误位置
```

开发态与产物态同时正确是因为 `src/index.ts` 与 `dist/index.js` 恰好都在仓库根下一层。把这段代码挪进任何子目录，产物态仍对（tsdown 打成单文件），**开发态会静默错**，且没有任何编译期报错。

**② tsdown 的 `minify: true` 保留 entry 的具名导出。** 用同配置对一个探针文件构建，产物尾部是：

```txt
export{t as main,n as runCli};
```

实测 `import { main, runCli }` 可导入、可调用。「bin 显式调用 `main()`」这条路成立。

## 方案选择

| 方案 | 形状 | 取舍 |
|---|---|---|
| A：三层拆分 | `src/cli/` + `src/core/` + `src/effects/` + `src/prompts/` | 边界最干净，但对 265 行的 CLI 是过度分层；`prompts` 层拆出来也测不了（要 mock clack），成本高于收益 |
| **B：纯决策层 + 副作用层（选定）** | 3 个平铺文件，不建目录层级 | 对得上 ROADMAP 原话；交互刻意不拆 |
| C：只改自执行 | 仅把 `init()` 导出 | 没做完 CTV-15——`init()` 仍 225 行，且 `argv` 还在顶层解析，import 照样吃测试进程的 argv |

选 B。

## 模块划分

```
src/
  index.ts      入口 + 编排 + 交互。导出 main() / runCli()。仍是 tsdown 唯一 entry
  plan.ts       纯决策层：零 fs、零 prompts、零 spawn、零 process.exit
  scaffold.ts   副作用层：按 plan 产出的动作表落盘
  utils.ts      不动
  constants/    不动
bin/index.js    改为 import { runCli } 并显式调用
```

### `plan.ts`：8 个纯函数

每个都对应一处现在埋在 `init()` 里的规则。

| 函数 | 原位置 | 钉住的规则 |
|---|---|---|
| `resolveArgTemplate(argTemplate, templates)` | `:126-129` | 无效模板名 → 回落选择器并置 invalid 标志 |
| `derivePackageName(targetDir, cwd)` | `:106-107` | 目录名 → 默认包名，以及是否需要追问 |
| `findVariantCommand(frameworks, template)` | `:171-173` | `f.variants?.length ? f.variants : f` 的混杂 flatMap |
| `buildCustomCommandArgs(fullCommand, targetDir)` | `:176-178` | `split(' ')` 与 `TARGET_DIR` 替换 |
| `planTemplateFiles(fileNames)` | `:214-223` | 排除 `package.json`、`RENAME_FILES` 映射、`index.html` 特例 |
| `replaceHtmlTitle(html, title)` | `:203-206` | `<title>` 那条正则 |
| `withPackageName(pkgText, name)` | `:219-223` | JSON 往返 + 2 空格缩进 + 末尾换行 |
| `buildDoneMessage(cwd, root, pkgManager)` | `:242-249` | `cwd !== root` 分支、路径含空格时加引号 |

`planTemplateFiles` 是 ROADMAP 明确点名的那条「该写哪些文件、该跳过什么」。它把 `write()` 现在的三条特例从控制流变成可断言的数据：

```ts
type FileAction
  = | { kind: 'copy', from: string, to: string }
    | { kind: 'index-html', from: string, to: string }
    | { kind: 'package-json', from: string, to: string }
```

### `scaffold.ts`：副作用层

按动作表落盘。**不自己计算任何路径**——`templateDir` / `root` / `packageName` 全部由入口层注入。

## 两个必须正面处理的约束

### 约束 1：路径解析留在入口层

`TEMPLATE_ROOT` 与 `getVersion()` 的起点由 `src/index.ts` 算好后**注入**下层，下层只收参数、绝不自己碰 `import.meta.url`。

这既避开前置实测 ① 的层级陷阱，又让 `scaffold.ts` 能被单测喂临时目录。约束的理由要写成代码注释钉在原地，否则下一个人挪动它时不会有任何提示。

### 约束 2：错误兜底不能照抄 todo-scripts

`@huberyyang/todo-scripts` 的 `bin/index.js` 是：

```txt
import { main, printErr, ScriptError } from '../dist/main.js'
main().catch(/* 兜底 */)
```

**兜底在 bin 里，不在编译产物里。** 本仓库不能照抄：现有兜底（`src/index.ts:255-265`，CTV-02 加的）用了 `spin.error()` 和 `prompts.log.error()`，而 `@clack/prompts` 是 devDependency，**用户机器上不存在**——未编译的 `bin/index.js` 里 import 它会直接崩。

所以兜底必须留在被打包的 src 里，分成两个导出：

```ts
// src/index.ts
export async function main(argvInput = process.argv.slice(2)): Promise<void>
// 只做业务，异常原样抛——这样测试才能导入它而不被 process.exit 干掉整个 vitest 进程

export function runCli(): Promise<void>
// main().catch(收 spinner + 打人话 + 打栈 + process.exit(1))
```

```txt
// bin/index.js —— 薄到只剩转发
import { runCli } from '../dist/index.js'
runCli()
```

`spin` 保持模块级单例：`runCli()` 的 catch 需要够得着它，且 `prompts.spinner()` 在创建时不写终端（副作用要到 `.start()` 才发生），不影响测试导入。

## 这次拆分买到的和没买到的

**买到**：

1. import `src/index.ts` 不再真跑 CLI——ROADMAP v1.2.0 一节那条 ⚠️ 解除。
2. 8 条决策规则从控制流里挖出来，有了真单测。
3. CTV-16 / 17 / 19 / 20 / 21 各有了明确落点，后续会小很多。

**没买到**：

`main()` 里的 clack 交互仍然只能靠 E2E 覆盖，单测碰不到。要覆盖它得 mock clack，收益不抵成本——E2E 那 31 条已经把交互的可观测结果钉死了。**这是刻意留白，不是漏掉的。**

## 验证策略

纯重构的证据标准比新功能更高，因为「没坏」比「能用」更难证明。

1. **先取基线**：重构前跑 E2E + 单测存真实输出；用当前 CLI 生成 `vue-ts` / `vanilla` / `lit-ts` 三份产物存快照。
2. **测试文件零改动**：完事后 `git diff --stat tests/` 对 `utils.test.ts` / `constants.test.ts` / 两个 `.e2e.test.ts` 必须是 0 处改动。用它证明没有为了让测试过而动断言。
3. **产物 diff**：重构后重新生成那三份，`diff -r` 逐一必须完全一致。**这是「行为零变化」最硬的证据，比测试全绿更强**——测试只覆盖它断言的那些点，diff 覆盖每一个字节。
4. **变异测试**：`tests/plan.test.ts` 是从存量逻辑提取的，天然一次就绿，按本仓库规矩必须逐个注入真实缺陷证明断言有牙齿（正则改宽、缩进改 4 空格、rename 映射跳过、`cwd !== root` 判反……），还原源码后 `git diff` 校验。报告说清捕获数与是否存在等价变异。
5. **全量门禁**：`pnpm typecheck` / `lint` / `test` / `build` / `test:e2e`，贴真实输出。

## 执行顺序

基线 → 写 `tests/plan.test.ts` 看它红（模块还不存在）→ 建 `src/plan.ts` 转绿 → 建 `src/scaffold.ts` → 改写 `src/index.ts` 为编排 + 导出 → 改 `bin/index.js` → 全量门禁 + 产物 diff → 变异测试。

## 一个刻意的安全性质

`dist/index.js` 从「import 即执行」变成「导出」。若 `bin/index.js` 忘了同步改，**E2E 会 31 条全红**，而不是静默降级成某种更难察觉的错误。这个失败模式是响的，这是选择「bin 显式调用」而非「保留自执行 + 额外导出」的一个附带理由。
