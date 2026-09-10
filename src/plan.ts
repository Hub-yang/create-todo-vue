import path from 'node:path'
import { dim } from 'picocolors'
import { getInstallCommand, getRunCommand, isValidPackageName } from './utils'

/**
 * 纯决策层。
 *
 * 这里的函数**一律不碰** fs、prompts、spawn、process.exit，也不读
 * `import.meta.url`——所有路径都由入口层算好再传进来。这条约束不是洁癖：
 * `path.resolve(fileURLToPath(import.meta.url), '../..')` 的结果取决于**调用它的
 * 文件在第几层**，一旦这类计算散进子模块，开发态（直接跑 src/）和产物态
 * （打包进 dist/index.js）会解析到不同目录，而且没有任何编译期报错。
 *
 * 本文件的每个函数都对应 CTV-15 之前 `init()` 里的一段既有逻辑，行为逐条保持一致。
 */

/** 单个文件的落地方式。`from` 是模板目录内的名字，`to` 是目标目录内的名字 */
export type FileAction
  = | { kind: 'copy', from: string, to: string }
    | { kind: 'index-html', from: string, to: string }
    | { kind: 'package-json', from: string, to: string }

/** 能被 `-t` 命中的最小结构：内置变体和框架自身都满足 */
export interface VariantLike {
  name: string
  customCommand?: string
}

export interface FrameworkLike extends VariantLike {
  variants?: VariantLike[]
}

/**
 * 判定 `-t` 传进来的模板名是否可用
 *
 * 注意空串：原实现的条件是 `argTemplate && !templates.includes(argTemplate)`，
 * 空串是 falsy，走不进校验分支，于是 `-t ""` 会静默回落到选择器而**不**提示无效。
 * 这是现状，拆分不改（要改属于另一个条目）。
 * @param {string | undefined} argTemplate - `-t` 的原始取值
 * @param {string[]} templates - 全部合法模板名
 * @returns template 为待用模板名（需要回落到选择器时为 undefined）；invalid 表示是否要提示「不是有效的模板名」
 */
export function resolveArgTemplate(
  argTemplate: string | undefined,
  templates: string[],
): { template: string | undefined, invalid: boolean } {
  if (argTemplate && !templates.includes(argTemplate)) {
    return { template: undefined, invalid: true }
  }
  return { template: argTemplate, invalid: false }
}

/**
 * 由目标目录推出 package.json 的默认 name
 * @param {string} targetDir - 目标目录（可为相对路径、`.` 或绝对路径）
 * @param {string} cwd - 解析相对路径的基准目录，由入口层注入
 * @returns name 为推出的包名；needsPrompt 表示它不是合法包名、需要追问用户
 */
export function derivePackageName(
  targetDir: string,
  cwd: string,
): { name: string, needsPrompt: boolean } {
  const name = path.basename(path.resolve(cwd, targetDir))
  return { name, needsPrompt: !isValidPackageName(name) }
}

/**
 * 显式传入的 `--package-name` 是否可用
 *
 * 从 `resolvePackageName` 里**拆出来**是因为时机不同：这件事和 `targetDir` 毫无关系，
 * 所以能——也必须——排在 `intro()` 开框、以及任何破坏性操作之前跑。挤在一起时做不到，
 * 那个函数要等 `targetDir`，而 `targetDir` 可能来自开框之后的提问，结果是先画出框、
 * 再打一句框外的报错，`┌` 永远等不到 `└`（CTV-37，实测过）。
 *
 * 非法值刻意**不**用 `toValidPackageName()` 静默修正：立场与 CTV-17 的未知参数校验
 * 一致——用户显式传错了要告诉他。想要自动修正的人不传这个参数就是了。
 * @param {string | undefined} argPackageName - `--package-name` 的原始取值；`undefined` 表示没传，`''` 表示带了参数没带值
 */
export function isArgPackageNameValid(argPackageName: string | undefined): boolean {
  // 没传不是错；空串是「想传但漏了值」，按非法处理（正则本身也不接受空串）
  return argPackageName === undefined || isValidPackageName(argPackageName)
}

/**
 * 定下 package.json 的 name：显式参数优先，否则回落到从目录名推导
 *
 * CTV-31 之前，包名是唯一一个**给不出参数**的提问点——目录名推不出合法包名时
 * （`My App`、`.foo`），非交互调用必然停在那里且无药可救。
 *
 * **前置条件**：`argPackageName` 已经过 `isArgPackageNameValid` 检验。
 * @param {string | undefined} argPackageName - `--package-name` 的取值
 * @param {string} targetDir - 目标目录，未传参数时据此推导
 * @param {string} cwd - 解析相对路径的基准目录，由入口层注入
 * @returns name 为待用包名；needsPrompt 表示要追问用户
 */
export function resolvePackageName(
  argPackageName: string | undefined,
  targetDir: string,
  cwd: string,
): { name: string, needsPrompt: boolean } {
  if (argPackageName !== undefined) {
    return { name: argPackageName, needsPrompt: false }
  }

  return derivePackageName(targetDir, cwd)
}

/**
 * 在框架树里找出某个模板名对应的 customCommand
 *
 * 带 variants 的框架把自身让位给变体，不带 variants 的框架自身就是一个可选项——
 * 这正是原实现里 `f.variants?.length ? f.variants : f` 的含义。
 * @param {FrameworkLike[]} frameworks - 框架树
 * @param {string} template - 模板名
 * @returns 命中的 customCommand；未命中或该模板走内置拷贝时为 undefined
 */
export function findVariantCommand(
  frameworks: FrameworkLike[],
  template: string,
): string | undefined {
  const { customCommand } = frameworks
    .flatMap<VariantLike>(f => f.variants?.length ? f.variants : f)
    .find(v => v.name === template) ?? {}
  return customCommand
}

/**
 * 把完整的 custom 指令拆成可交给 spawn 的命令与参数
 *
 * 替换只对参数做，命令名（第一段）不参与；且用的是非全局的 String.replace，
 * 单个参数里出现两次 TARGET_DIR 时只换第一处。两点都与原实现一致。
 * @param {string} fullCommand - 已按包管理器改写过的完整指令
 * @param {string} targetDir - 用来替换 TARGET_DIR 的目标目录
 */
export function buildCustomCommandArgs(
  fullCommand: string,
  targetDir: string,
): { command: string, args: string[] } {
  const [command, ...args] = fullCommand.split(' ')
  return {
    command,
    args: args.map(a => a.replace('TARGET_DIR', targetDir)),
  }
}

/**
 * 把模板目录的文件清单排成一张落地动作表
 *
 * 三条规则都来自原来的 `write()`：`package.json` 从批量拷贝里剔除、改由末尾单独
 * 写入（因为要先改 name）；`index.html` 要改写 title 所以自成一类；其余直接拷贝。
 * 目标文件名统一过一遍重命名表——npm 打包会无条件剔除 `.gitignore`，仓库里存的是
 * `_gitignore`，靠这张表落地时改回来。
 *
 * 清单里没有 `package.json` 时也照样计划写入，与原实现一致（原实现是无条件读取它）。
 * @param {string[]} fileNames - 模板目录下的文件名（不递归）
 * @param {Record<string, string | undefined>} renameFiles - 重命名表
 */
export function planTemplateFiles(
  fileNames: string[],
  renameFiles: Record<string, string | undefined>,
): FileAction[] {
  const rename = (file: string) => renameFiles[file] ?? file

  const actions: FileAction[] = fileNames
    .filter(f => f !== 'package.json')
    .map(file => ({
      kind: file === 'index.html' ? 'index-html' : 'copy',
      from: file,
      to: rename(file),
    }))

  actions.push({
    kind: 'package-json',
    from: 'package.json',
    to: rename('package.json'),
  })

  return actions
}

/**
 * 把 index.html 的 title 换成项目名
 *
 * 正则非贪婪、无 g 标志、无 s 标志——只换第一处，且跨行的 title 匹配不上。
 * 三点都是原实现的行为。
 * @param {string} html - 模板里的 index.html 原文
 * @param {string} title - 新标题（即包名）
 */
export function replaceHtmlTitle(html: string, title: string): string {
  return html.replace(/<title>.*?<\/title>/, `<title>${title}</title>`)
}

/**
 * 改写 package.json 的 name 字段
 *
 * 走 JSON 往返，因此产物是 2 空格缩进 + 末尾换行的规范化格式，而不是模板原文的排版。
 * @param {string} pkgText - 模板里的 package.json 原文
 * @param {string} name - 新的包名
 */
export function withPackageName(pkgText: string, name: string): string {
  const pkg = JSON.parse(pkgText)
  pkg.name = name
  return `${JSON.stringify(pkg, null, 2)}\n`
}

/**
 * 拼出收尾提示
 *
 * 两种形态只差首行措辞和末行命令，`cd` 那半边的规则完全共用：
 *
 * | `installed` | 首行 | 末行 |
 * |---|---|---|
 * | `false`（默认） | 创建完成，请执行： | `npm install` |
 * | `true` | 依赖安装完成，请执行： | `npm run dev` |
 *
 * `installed` 默认 `false` 是刻意的：既有调用点与既有测试因此一行都不用改，
 * 「原有断言全绿」才继续是个干净的信号（CTV-21）。
 * @param {string} cwd - 当前工作目录
 * @param {string} root - 生成的项目根目录
 * @param {string} pkgManager - 包管理器名
 * @param {boolean} installed - 依赖是否已经装好；true 时末行给启动命令而不是安装命令
 */
export function buildDoneMessage(
  cwd: string,
  root: string,
  pkgManager: string,
  installed = false,
): string {
  const cdProjectName = path.relative(cwd, root)
  let doneMessage = installed ? '依赖安装完成，请执行：' : '创建完成，请执行：'
  if (cwd !== root) {
    doneMessage += `\n cd ${cdProjectName.includes(' ') ? `"${cdProjectName}"` : cdProjectName}`
  }
  const command = installed
    ? getRunCommand(pkgManager, 'dev')
    : getInstallCommand(pkgManager)
  doneMessage += `\n ${command.join(' ')}`
  return doneMessage
}

/**
 * 拼出 intro 那一行的标题
 *
 * 版本号跟在包名后面、单独上色，为的是让用户一眼看出**跑的到底是哪一版**。
 * 起因是 2026-09-10 的一次误诊（CTV-45）：pnpm 默认的 `minimumReleaseAge` 会
 * 拒绝 24 小时内发布的版本，`pnpm create` 因此静默回退到 v1.6.1，而框顶只写
 * `create-todo-vue`，于是在一个早已修掉的旧版上白测了一轮却毫无察觉。
 *
 * 读不到版本时**整段后缀都不打**：`getVersion()` 此时返回 `'unknown'`，
 * 拼出来的 `create-todo-vue vunknown` 长得像个真版本号，比不显示更糟。
 * 空串走同一支——`getVersion()` 的 `?? 'unknown'` 只挡 null/undefined，
 * `"version": ""` 会原样返回。
 *
 * `color` 做成参数而不是写死 `dim`，与 `getLabel()` 同形：picocolors 在非 TTY 下
 * 不注入转义码，写死的话测试永远拿到裸字符串，「版本那段确实被弱化了」就钉不住。
 * @param {string} version - 版本号，通常来自 `getVersion()`
 * @param {Function} color - 给版本号那一段上色，默认 picocolors 的 dim
 */
export function buildIntroTitle(
  version: string,
  color: (text: string) => string = dim,
): string {
  const name = 'create-todo-vue'
  if (!version || version === 'unknown') {
    return name
  }
  return `${name} ${color(`v${version}`)}`
}

/** `mri` 解析配置里与「参数名」有关的部分 */
export interface ArgvOptions {
  boolean?: readonly string[]
  string?: readonly string[]
  alias?: Readonly<Record<string, string>>
}

/**
 * 由 mri 配置派生出全部合法参数名
 *
 * 别名的**两侧**都要算已知：mri 解析 `-t vue` 会同时产出 `t` 和 `template` 两个键，
 * 只收其中一边会让合法输入被误判成未知参数。
 * @param {ArgvOptions} options - mri 的解析配置
 * @returns 去重后的参数名清单
 */
export function collectKnownFlags(options: ArgvOptions): string[] {
  const alias = options.alias ?? {}
  return [...new Set([
    ...options.boolean ?? [],
    ...options.string ?? [],
    ...Object.values(alias),
    ...Object.keys(alias),
  ])]
}

/**
 * 找出 mri 解析结果里不在已知清单中的参数
 *
 * mri 会静默吞掉未声明的 flag——`--overwirte` 拼错时不但不报错，还会把紧跟其后的
 * 位置参数当成它的值吃掉（实测：`--overwirte my-app` 得到 `{overwirte: 'my-app'}`，
 * `_` 是空的），于是项目名也一并丢了。这个函数把那种输入变成可报错的信号。
 * @param {object} parsed - mri 的解析结果。这里只取 `Object.keys`，所以用 `object` 就够——
 * mri 返回的 `Argv<T>` 没有索引签名，收 `Record<string, unknown>` 会逼调用点硬转型
 * @param {readonly string[]} known - 合法参数名清单
 * @returns 未知参数名，保持用户输入的先后顺序
 */
export function findUnknownFlags(
  parsed: object,
  known: readonly string[],
): string[] {
  const allowed = new Set(known)
  // '_' 是 mri 存放位置参数的固定键，不是 flag
  return Object.keys(parsed).filter(name => name !== '_' && !allowed.has(name))
}
