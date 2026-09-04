# create-todo-vue 全量审查与迭代工作流设计

- 日期：2026-09-04
- 状态：已确认

## 背景

`@huberyyang/create-todo-vue` 是仿 create-vite / create-vue 的脚手架 CLI，已发布到 npm（当时 v1.0.1）。此前仓库里没有任何 AI 协作约定文件、没有排期表、没有真实测试、也没有质量门禁 CI——每开一次新会话都要从零重新读代码、重新判断该做什么，且没有任何机制保证「改了没坏」。

本次工作有两个目标：把 `@huberyyang/todo-scripts` 已经跑通的那套协作工作流搬过来；把一次全量代码审查的结论沉淀成可逐条推进的排期表。

## 审查结论

### 用户可见的破损

**两个 vitesse 模板生成出的项目 100% 装不上依赖。** `template-vitesse-base/package.json` 有 51 处、`template-vitesse-lite/package.json` 有 27 处 `catalog:frontend` / `catalog:dev` / `catalog:build` / `catalog:types` 引用，但两个模板目录里**都没有 `pnpm-workspace.yaml`**——而 catalog 的定义正是写在那个文件里的。用 pnpm 装会直接报 catalog 未定义；用 npm / yarn / bun 则更彻底，它们压根不认识 `catalog:` 这个协议。

这两个模板从上游 [antfu/vitesse](https://github.com/antfu/vitesse) 拷过来时漏掉了 `pnpm-workspace.yaml`，而本仓库自身不是 monorepo、没有 workspace 文件，所以本地也没有任何东西掩盖这个缺失。

### 发布期才会暴露的坑

**npm 打包时无条件剔除 `.gitignore` 和 `.npmrc`**，与 `files` 字段怎么配无关。仓库里存在 `_gitignore` 这个文件名、以及 `RENAME_FILES` 这个重命名机制，根源就是前者。

但 `.npmrc` 没有对应的处理：两个 vitesse 模板的 `.npmrc`（`shamefully-hoist=true`、`strict-peer-dependencies=false`）在发布后会整个消失，用户拿到的项目里没有这个文件。这个问题在本地开发时完全观察不到——本地是直接读仓库目录，文件当然在。唯一的验证手段是 `npm pack --dry-run` 看真实文件清单。

### 合规问题

`template-vitesse-base/.github/FUNDING.yml` 和 `template-vitesse-lite/.github/FUNDING.yml` 的内容是 `open_collective: antfu` / `github: [antfu]`，两个模板的 `LICENSE` 是 `Copyright (c) 2020-PRESENT Anthony Fu`。任何人用这两个模板建项目，都会在自己的仓库里给上游作者挂赞助入口、署上游作者的版权。

### 地基缺失

- **测试覆盖率为零**：`tests/utils.test.ts` 只有一条 `expect('1').equal('1')` 的占位断言。
- **CI 门禁为零**：唯一的 workflow `auto-update-readme.yml` 替换的 `{{REPO_NAME}}` / `{{USER_NAME}}` 占位符在 README 里已经不存在，是个永久空转的任务。质量保障全靠本地 husky 钩子。
- **`src/index.ts` 顶层自执行**：文件末尾直接 `init()`，不导出任何东西，意味着这个文件无法被测试导入（一 import 就会拿测试进程的 `process.argv` 真跑一遍 CLI 并 `process.exit`）。

### 其余（不影响正确性）

`init()` 单函数约 220 行、prompt 与 IO 混杂；无顶层 `.catch()`，任何异常都是 unhandled rejection 且 spinner 卡死；缺 `-v/--version`；mri 静默吞掉拼错的 flag；模板清单在 `FRAMEWORKS` / `HELP_MESSAGE` / README 手写了三份且已经漂移（README 只列了 4 个，实际 8 个）；`lint-staged` 写成 `eslint . --fix` 会对整个仓库跑 lint；缺 `.vscode/extensions.json`；`scripts` 里有个名叫 `publish` 的条目（`publish` 是包管理器 lifecycle 名，存在递归风险）；`DEFAULTE_TARGETDIR` / `updateComtent` 拼写错误。

## 决策

### 决策一：vitesse 模板先下架，不当场修

三个选项：

1. **把 `catalog:*` 展开成真实版本号**——各包管理器通用，与其余 6 个模板一致。
2. **给两个模板各补一份 `pnpm-workspace.yaml`**——贴近上游 vitesse 原貌，版本集中管理。
3. **先从 `FRAMEWORKS` 里下架**，修复排到后面的版本。

**选 3，并把 1 排进 v1.3.0。**

选下架而非当场修，是因为这两个模板现在正在坑线上用户，而 78 处 catalog 的展开是一件需要逐个查版本、且改完必须真跑一遍 `pnpm install` 才敢说修好了的活——它不该跟「建立工作流」这件事挤在同一轮里做。下架是一次三行改动就能止血的操作，能立刻把线上破损面降到零。

修复方案选「展开版本号」而非「补 workspace」，是因为**补 workspace 会让生成的项目锁死 pnpm**。这是一个面向所有包管理器的脚手架（`getFullCustomCommand` 里专门为 bun / deno / yarn1 / pnpm 各写了一条改写规则，README 也列了五种调用方式），生成一个只有 pnpm 能装的项目与这个定位直接矛盾。代价是模板依赖升级时要靠 renovate / taze 逐个改而不是改一处 catalog——但这本来就是其余 6 个模板的现状，一致性反而更好。

下架时**保留模板目录在仓库里**，只从 `FRAMEWORKS`、`HELP_MESSAGE`、README、`package.json` 的 `files` 四处摘除。保留是为了给 v1.3.0 的修复留底；摘出 `files` 则顺带解决了「把上游作者的 FUNDING/LICENSE 发出去」这个合规问题。

### 决策二：CLAUDE.md / ROADMAP.md 不进版本库

与 todo-scripts 一致：`CLAUDE.md`、`ROADMAP.md`、`spec.md` 加进 `.gitignore` 的「个人维护，不进版本库」一节，只存在于本地工作副本。`docs/superpowers/` 下的 spec 和 plan 正常提交。

理由是排期表里会有个人决策记录、遗留问题、以及「这条为什么搁置」这类判断——这些对协作者是噪音，对公开仓库的读者更是。而两个仓库用同一套约定，切换时的心智负担为零。

### 决策三：注释中文，commit message 英文

沿用仓库现状（`src/` 下注释全是中文）与 Conventional Commits 的英文惯例。会话回复一律中文，这是与前者独立的一个维度——前者管写进仓库的东西，后者管呈现给人的文字。

### 决策四：本轮只产出文档

本轮不改任何源码、不动任何模板、不提交、不发版。审查结论落成 26 条待办后停下，由 Hubery 逐条挑、逐条验证。

理由是这 26 条里跨了从「三行删除」到「220 行函数拆分」的整个成本区间，一轮会话里连做多条会让验证变得笼统——而 ROADMAP 的维护规则第 3 条明确要求「没验证过不许标 ✅」。

## 产出

| 文件 | 是否进版本库 | 内容 |
|:--|:--:|:--|
| `CLAUDE.md` | 否 | 架构说明、命令与三个 scripts 陷阱、npm 打包隐藏规则、约定 |
| `ROADMAP.md` | 否 | 26 条待办切成 v1.1.0 ~ v1.4.0 四个版本 + 候选池，附维护规则 |
| `docs/superpowers/specs/2026-09-04-workflow-and-audit-design.md` | 是 | 本文件 |
| `.gitignore` | 是 | 追加「个人维护，不进版本库」一节 |

## 版本切分

- **v1.1.0 止血与合规**（CTV-01 ~ 06）：线上破损 + 两条违反自身规范的配置，都不涉及架构。
- **v1.2.0 测试与 CI 地基**（CTV-07 ~ 10、26）：这一版之后才有资格谈「改了没坏」。
- **v1.3.0 vitesse 复活**（CTV-11 ~ 14）：真修 catalog、`.npmrc`、上游身份文件，重新上架并用 E2E 钉住。
- **v1.4.0 架构与体验**（CTV-15 ~ 21）：`index.ts` 拆分、help 由数据派生、未知参数校验等。

排在 v1.2.0 之前的 v1.1.0 全是小改动，刻意不等测试地基——因为线上正在坑用户，而这六条的验证靠人工跑一次 `pnpm preview` 就够。
