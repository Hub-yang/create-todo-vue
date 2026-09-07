import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import * as prompts from '@clack/prompts'
import spawn from 'cross-spawn'
import mri from 'mri'
import { DEFAULTE_TARGETDIR, FRAMEWORKS, HELP_MESSAGE, RENAME_FILES, TEMPLATES } from './constants'
import {
  buildCustomCommandArgs,
  buildDoneMessage,
  derivePackageName,
  findVariantCommand,
  resolveArgTemplate,
} from './plan'
import { scaffoldTemplate } from './scaffold'
import { cancel, emptyDir, formatTargetDir, getFullCustomCommand, getLabel, getVersion, install, isEmpty, isValidPackageName, pkgFromUserAgent, toValidPackageName } from './utils'

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

/**
 * CLI 主流程。
 *
 * 只做编排与交互，**异常一律往外抛**——兜底在 `runCli()` 里。这样测试可以导入并
 * 调用本函数，而不会被 `process.exit` 连带干掉整个测试进程。
 * @param {string[]} argvInput - 命令行参数（不含 node 与脚本路径本身）
 */
export async function main(argvInput: string[] = process.argv.slice(2)): Promise<void> {
  const cwd = process.cwd()

  const argv = mri<Options>(argvInput, {
    boolean: ['help', 'version', 'overwrite', 'immediate'],
    alias: { h: 'help', v: 'version', t: 'template', i: 'immediate' },
    string: ['template'],
  })

  const argTargetDir = argv._[0] ? formatTargetDir(String(argv._[0])) : undefined
  const argOverwrite = argv.overwrite
  const argTemplate = argv.template
  const argImmediate = argv.immediate

  const help = argv.help
  if (help) {
    console.log(HELP_MESSAGE)
    return
  }

  if (argv.version) {
    console.log(getVersion(ENTRY_DIR))
    return
  }

  prompts.intro('create-todo-vue')

  const pkgInfo = pkgFromUserAgent(process.env.npm_config_user_agent)

  // 1.获取项目名称和目标目录
  let targetDir = argTargetDir
  if (!targetDir) {
    const projectName = await prompts.text({
      message: '项目名称:',
      defaultValue: DEFAULTE_TARGETDIR,
      placeholder: DEFAULTE_TARGETDIR,
      validate(value) {
        return !value || formatTargetDir(value).length > 0 ? undefined : '项目名称无效'
      },
    })
    if (prompts.isCancel(projectName))
      return cancel()
    targetDir = formatTargetDir(projectName)
  }

  // 2.如果目录存在且不为空，则进行处理
  if (fs.existsSync(targetDir) && !isEmpty(targetDir)) {
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
        return cancel()
      }
      overwrite = res
    }

    switch (overwrite) {
      case 'yes':
        emptyDir(targetDir)
        break
      case 'no':
        cancel()
        return
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
      return cancel()
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
      return cancel()
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
        return cancel()
      template = variant
    }
  }

  const pkgManager = pkgInfo?.name || 'npm'
  const root = path.join(cwd, targetDir)

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
      return cancel()
    immediate = immediateResult
  }

  if (immediate) {
    install(root, pkgManager)
  }
  else {
    prompts.outro(buildDoneMessage(cwd, root, pkgManager))
  }

  prompts.log.success('程序结束')
}

/**
 * 供 `bin/index.js` 调用的入口：跑主流程并兜住任何异常。
 *
 * 兜底刻意留在**被打包的产物里**而不是 `bin/index.js`（`@huberyyang/todo-scripts`
 * 是后者那种写法）：这里用到的 `@clack/prompts` 是 devDependency，用户机器上并不存在，
 * 未编译的 bin 里 import 它会直接崩。
 */
export function runCli(): Promise<void> {
  return main().catch((e) => {
    // spinner 若仍在转，先收掉，否则报错信息会被它的重绘覆盖。
    // 未 start 过时调用 error() 也是安全的（已实测），所以无需额外判状态。
    spin.error('创建失败')
    prompts.log.error(e instanceof Error ? e.message : String(e))
    // 原始栈对定位仍有价值，但不该是用户看到的第一屏
    if (e instanceof Error && e.stack) {
      console.error(e.stack)
    }
    process.exit(1)
  })
}
