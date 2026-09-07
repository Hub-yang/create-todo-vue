import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import * as prompts from '@clack/prompts'
import spawn from 'cross-spawn'
import mri from 'mri'
import { ARGV_OPTIONS, DEFAULT_TARGET_DIR, FRAMEWORKS, HELP_MESSAGE, RENAME_FILES, TEMPLATES } from './constants'
import {
  buildCustomCommandArgs,
  buildDoneMessage,
  collectKnownFlags,
  derivePackageName,
  findUnknownFlags,
  findVariantCommand,
  resolveArgTemplate,
} from './plan'
import { scaffoldTemplate } from './scaffold'
import { cancel, emptyDir, formatTargetDir, getFullCustomCommand, getLabel, getVersion, install, isEmpty, isValidPackageName, pathKind, pkgFromUserAgent, toValidPackageName } from './utils'

interface Options {
  template?: string
  help?: boolean
  version?: boolean
  overwrite?: boolean
  immediate?: boolean
}

/**
 * 下面两个常量必须在**本文件**里算，不能挪进任何子模块。
 *
 * `path.resolve(<本文件路径>, '../..')` 的结果取决于本文件在第几层：
 * `dist/index.js` 与 `src/index.ts` 都在仓库根下一层，所以两者都解析到仓库根；
 * 一旦挪进 `src/xxx/yyy.ts`，开发态会解析到 `src/` 而产物态仍解析到仓库根，
 * 于是模板目录静默指向错误位置，**且没有任何编译期报错**。
 *
 * 需要它们的下层模块一律靠参数接收，不自己读 `import.meta.url`。
 */
const ENTRY_FILE = fileURLToPath(import.meta.url)
/** 向上查找 package.json 的起点，供 `-v` 读版本号 */
const ENTRY_DIR = path.dirname(ENTRY_FILE)
/** `template-*` 所在的目录，即仓库根 / 已安装包的根 */
const PACKAGE_ROOT = path.resolve(ENTRY_FILE, '../..')

/**
 * spinner 保持模块级：`runCli()` 的兜底需要够得着它，才能在报错前把还在转的
 * spinner 收掉。`prompts.spinner()` 创建时不写终端，副作用要到 `.start()` 才发生，
 * 所以它不妨碍本模块被测试导入。
 */
const spin = prompts.spinner()

/** 正常跑完 */
const EXIT_OK = 0
/**
 * 取消 / 没跑完。
 *
 * 刻意不用 130（SIGINT 的约定）：这条码同样会被**非交互**场景取到——stdin 不可读时
 * 根本没有人按过 Ctrl+C，报 130 是撒谎。1 只表示「没有成功创建」，对调用方足够。
 */
const EXIT_CANCELLED = 1
/** 命令行本身就不对（拼错参数之类）。与 EXIT_CANCELLED 同值，分开命名只为调用点自解释 */
const EXIT_USAGE = 1

/** 打印取消提示并给出非零退出码。7 处取消点共用，避免漏掉某一处的返回值 */
function cancelled(): number {
  cancel()
  return EXIT_CANCELLED
}

/**
 * CLI 主流程。
 *
 * 只做编排与交互，**异常一律往外抛**——兜底在 `runCli()` 里。这样测试可以导入并
 * 调用本函数，而不会被 `process.exit` 连带干掉整个测试进程。
 * @param {string[]} argvInput - 命令行参数（不含 node 与脚本路径本身）
 */
export async function main(argvInput: string[] = process.argv.slice(2)): Promise<number> {
  const cwd = process.cwd()

  // 必须传副本：mri 会**就地改写**配置对象——把 alias 的值换成数组（`alias.help` 会变成
  // `[]`）、往 boolean 里追加别名，且每调一次追加一轮、无上限增长。直接传 ARGV_OPTIONS
  // 会让紧接着的 collectKnownFlags() 读到被污染的数据。
  // 注意 Object.freeze 挡不住：mri 是 CJS 非严格模式，赋值只会静默失败，
  // 而且浅冻结管不到嵌套的 alias 与 boolean（已实测）。
  const argv = mri<Options>(argvInput, structuredClone(ARGV_OPTIONS))

  const argTargetDir = argv._[0] ? formatTargetDir(String(argv._[0])) : undefined
  const argOverwrite = argv.overwrite
  const argTemplate = argv.template
  const argImmediate = argv.immediate

  const help = argv.help
  if (help) {
    console.log(HELP_MESSAGE)
    return EXIT_OK
  }

  if (argv.version) {
    console.log(getVersion(ENTRY_DIR))
    return EXIT_OK
  }

  // 校验刻意排在 --help / --version 之后：用户要文档就给文档，别因为同一行里
  // 还有个错别字就把帮助也扣下。这与 @huberyyang/todo-scripts 的次序一致。
  const unknownFlags = findUnknownFlags(argv, collectKnownFlags(ARGV_OPTIONS))
  if (unknownFlags.length) {
    // 走明文而不是 clack：此时还没调 intro()，clack 的框线会是断的。
    // 也刻意不抛异常——抛了会走 runCli 的兜底打出完整调用栈，而打错参数不是 bug。
    console.error(`未知参数：${unknownFlags.map(name => `--${name}`).join(', ')}`)
    console.error('运行 create-todo-vue --help 查看可用参数')
    return EXIT_USAGE
  }

  prompts.intro('create-todo-vue')

  const pkgInfo = pkgFromUserAgent(process.env.npm_config_user_agent)

  // 1.获取项目名称和目标目录
  let targetDir = argTargetDir
  if (!targetDir) {
    const projectName = await prompts.text({
      message: '项目名称:',
      defaultValue: DEFAULT_TARGET_DIR,
      placeholder: DEFAULT_TARGET_DIR,
      validate(value) {
        return !value || formatTargetDir(value).length > 0 ? undefined : '项目名称无效'
      },
    })
    if (prompts.isCancel(projectName))
      return cancelled()
    targetDir = formatTargetDir(projectName)
  }

  /**
   * 目标目录的绝对路径，**从这里往下一律用它**，不要再用 `targetDir`。
   *
   * 必须是 `resolve` 而不是 `join`：`join(cwd, '/abs/path')` 会把绝对路径当相对路径
   * 接在 cwd 后面，于是在 cwd 底下造出一整棵镜像目录树，用户要的位置一个文件都没有，
   * 而 CLI 照样报告创建成功（CTV-19）。
   *
   * 位置也要紧：它必须算在「目标已存在」的判断**之前**，否则那一步仍然对着
   * 相对 cwd 的 `targetDir` 做存在性检查与清空，绝对路径下会检查错地方。
   */
  const root = path.resolve(cwd, targetDir)

  const targetKind = pathKind(root)

  // 2.目标已存在时的处理。文件与目录是两套完全不同的选项，不能共用一个菜单：
  // 「忽略文件并继续」在文件目标下物理上做不到——没法把一棵目录树写进一个文件路径，
  // 硬走下去 copy() 一样会炸（CTV-20）。
  if (targetKind === 'file') {
    // --overwrite 的字面语义就是「删了重来」，撞上文件时直接删，不再追问
    let removeExistingFile = Boolean(argOverwrite)

    if (!removeExistingFile) {
      const res = await prompts.select({
        message: `${targetDir} 已存在且是一个文件，请选择如何继续`,
        options: [
          {
            label: '取消操作',
            value: 'no',
          },
          {
            label: '删除该文件并继续',
            value: 'yes',
          },
        ],
      })
      if (prompts.isCancel(res)) {
        return cancelled()
      }
      removeExistingFile = res === 'yes'
    }

    if (!removeExistingFile) {
      return cancelled()
    }

    // 不能用 emptyDir()：它内部同样是 readdirSync，对文件照抛 ENOTDIR
    fs.rmSync(root, { force: true })
  }
  else if (targetKind === 'dir' && !isEmpty(root)) {
    let overwrite: 'yes' | 'no' | 'ignore' | undefined = argOverwrite ? 'yes' : undefined

    if (!overwrite) {
      const res = await prompts.select({
        message: `${targetDir === '.' ? '当前目录' : `目标目录${targetDir}`} 不为空，请选择如何继续`,
        options: [
          {
            label: '取消操作',
            value: 'no',
          },
          {
            label: '删除现有文件并继续',
            value: 'yes',
          },
          {
            label: '忽略文件并继续',
            value: 'ignore',
          },
        ],
      })
      if (prompts.isCancel(res)) {
        return cancelled()
      }
      overwrite = res
    }

    switch (overwrite) {
      case 'yes':
        emptyDir(root)
        break
      case 'no':
        return cancelled()
    }
  }

  // 3. 获取包名
  // 取目标目录名作为默认package.json name
  const derived = derivePackageName(targetDir, cwd)
  let packageName = derived.name
  if (derived.needsPrompt) {
    const packageNameResult = await prompts.text({
      message: '请输入package.json name',
      defaultValue: toValidPackageName(packageName),
      placeholder: toValidPackageName(packageName),
      validate(dir) {
        if (dir && !isValidPackageName(dir)) {
          return '无效的package.json name'
        }
      },
    })
    if (prompts.isCancel(packageNameResult))
      return cancelled()
    packageName = packageNameResult
  }

  // 4. 选择框架
  const { template: argResolvedTemplate, invalid: hasInvalidArgTemplate } = resolveArgTemplate(
    argTemplate,
    TEMPLATES,
  )
  let template = argResolvedTemplate
  if (!template) {
    const framework = await prompts.select({
      message: hasInvalidArgTemplate
        ? `${argTemplate}不是有效的模板名，请从以下选取：`
        : '选择模板',
      options: FRAMEWORKS.map((f) => {
        const { color, name, display } = f
        return {
          label: color(display || name),
          value: f,
        }
      }),
    })
    if (prompts.isCancel(framework))
      return cancelled()
    template = framework.name

    if (framework.variants?.length) {
      const variant = await prompts.select({
        message: '选择预设',
        options: framework.variants.map((v) => {
          const { name, customCommand } = v
          const command = customCommand
            ? getFullCustomCommand(customCommand, pkgInfo).replace(/ TARGET_DIR$/, '')
            : undefined
          return {
            label: getLabel(v),
            value: name,
            hint: command,
          }
        }),
      })
      if (prompts.isCancel(variant))
        return cancelled()
      template = variant
    }
  }

  const pkgManager = pkgInfo?.name || 'npm'

  // 如果已选模板存在安装指令，则转交给上游脚手架，完全不走内置模板
  const customCommand = findVariantCommand(FRAMEWORKS, template)
  if (customCommand) {
    const fullCustomCommand = getFullCustomCommand(customCommand, pkgInfo)
    const { command, args } = buildCustomCommandArgs(fullCustomCommand, targetDir)
    const { status } = spawn.sync(command, args, {
      stdio: 'inherit',
    })
    process.exit(status ?? 0)
  }

  // 不存在安装指令，则使用内置模板安装
  spin.start(`正在${root}中创建模板`)
  scaffoldTemplate({
    templateDir: path.resolve(PACKAGE_ROOT, `template-${template}`),
    root,
    packageName,
    renameFiles: RENAME_FILES,
  })
  spin.stop('模板创建成功')

  // 5. 询问是否立即安装
  let immediate = argImmediate

  if (immediate === undefined) {
    const immediateResult = await prompts.confirm({
      message: `是否立即使用${pkgManager}安装依赖？`,
    })
    if (prompts.isCancel(immediateResult))
      return cancelled()
    immediate = immediateResult
  }

  if (immediate) {
    install(root, pkgManager)
    // 装完依赖的人更需要知道怎么把项目跑起来。刻意用 log.* 而不是 outro()：
    // 补上缺失的收尾框线是另一件事（CTV-34），混在这里会让两条各自没法独立验证。
    prompts.log.info(buildDoneMessage(cwd, root, pkgManager, true))
  }
  else {
    prompts.outro(buildDoneMessage(cwd, root, pkgManager))
  }

  prompts.log.success('程序结束')

  return EXIT_OK
}

/**
 * 供 `bin/index.js` 调用的入口：跑主流程并兜住任何异常。
 *
 * 兜底刻意留在**被打包的产物里**而不是 `bin/index.js`（`@huberyyang/todo-scripts`
 * 是后者那种写法）：这里用到的 `@clack/prompts` 是 devDependency，用户机器上并不存在，
 * 未编译的 bin 里 import 它会直接崩。
 */
export async function runCli(): Promise<void> {
  // 先假定失败，只有 main() 真的跑完才改回去。
  //
  // 这一行不是保险起见，它修的是一条真实路径：clack 的 prompt 在 stdin 不可读时
  // （EOF / 非 TTY）**promise 永不 settle**，`await` 之后的代码一行都不执行——连
  // `isCancel` 分支都进不去。进程靠事件循环排空自然退出，于是脚手架什么都没生成却
  // 报了成功。预置非零码让这条「谁都没接住」的路径老实说自己没跑完。
  // 用 process.exitCode 而不是 process.exit()：后者会截断还没冲刷完的 stdout。
  process.exitCode = EXIT_CANCELLED

  try {
    process.exitCode = await main()
  }
  catch (e) {
    // spinner 若仍在转，先收掉，否则报错信息会被它的重绘覆盖。
    // 未 start 过时调用 error() 也是安全的（已实测），所以无需额外判状态。
    spin.error('创建失败')
    prompts.log.error(e instanceof Error ? e.message : String(e))
    // 原始栈对定位仍有价值，但不该是用户看到的第一屏
    if (e instanceof Error && e.stack) {
      console.error(e.stack)
    }
    process.exit(1)
  }
}
