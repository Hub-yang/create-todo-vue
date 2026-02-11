import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import * as prompts from '@clack/prompts'
import spawn from 'cross-spawn'
import mri from 'mri'
import { DEFAULTE_TARGETDIR, FRAMEWORKS, HELP_MESSAGE, RENAME_FILES, TEMPLATES } from './constants'
import { cancel, copy, emptyDir, formatTargetDir, getFullCustomCommand, getInstallCommand, getLabel, install, isEmpty, isValidPackageName, pkgFromUserAgent, toValidPackageName } from './utils'

interface Options {
  template?: string
  help?: boolean
  overwrite?: boolean
  immediate?: boolean
}

const spin = prompts.spinner()
const cwd = process.cwd()

const argv = mri<Options>(process.argv.slice(2), {
  boolean: ['help', 'overwrite', 'immediate'],
  alias: { h: 'help', t: 'template', i: 'immediate' },
  string: ['template'],
})

async function init() {
  const argTargetDir = argv._[0] ? formatTargetDir(String(argv._[0])) : undefined
  const argOverwrite = argv.overwrite
  const argTemplate = argv.template
  const argImmediate = argv.immediate

  const help = argv.help
  if (help) {
    console.log(HELP_MESSAGE)
    return false
  }

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
  let packageName = path.basename(path.resolve(targetDir))
  if (!isValidPackageName(packageName)) {
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
  let template = argTemplate
  let hasInvalidArgTemplate = false
  if (argTemplate && !TEMPLATES.includes(argTemplate)) {
    template = undefined
    hasInvalidArgTemplate = true
  }
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
  // 如果已选模板存在安装指令，则立即执行
  const { customCommand } = FRAMEWORKS
    .flatMap(f => f.variants?.length ? f.variants : f)
    .find(v => v.name === template) ?? {}
  if (customCommand) {
    const fullCustomCommand = getFullCustomCommand(customCommand, pkgInfo)
    const [command, ...args] = fullCustomCommand.split(' ')
    // 将TARGET_DIR替换为targetDir
    const replacedArgs = args.map(a => a.replace('TARGET_DIR', targetDir))
    const { status } = spawn.sync(command, replacedArgs, {
      stdio: 'inherit',
    })
    process.exit(status ?? 0)
  }

  // 不存在安装指令，则使用内置模板安装
  spin.start(`正在${root}中创建模板`)
  fs.mkdirSync(root, { recursive: true })
  // 获取内置模板目录
  const templateDir = path.resolve(
    fileURLToPath(import.meta.url),
    '../..',
    `template-${template}`,
  )

  function write(file: string, content?: string) {
    const targetPath = path.join(root, RENAME_FILES[file] ?? file)
    if (content) {
      fs.writeFileSync(targetPath, content)
    }
    else if (file === 'index.html') {
      const templatePath = path.join(templateDir, file)
      const templateContent = fs.readFileSync(templatePath, 'utf-8')
      const updateComtent = templateContent.replace(
        /<title>.*?<\/title>/,
        `<title>${packageName}</title>`,
      )
      fs.writeFileSync(targetPath, updateComtent)
    }
    else {
      copy(path.join(templateDir, file), targetPath)
    }
  }

  const files = fs.readdirSync(templateDir)
  for (const file of files.filter(f => f !== 'package.json')) {
    write(file)
  }

  const pkg = JSON.parse(
    fs.readFileSync(path.join(templateDir, `package.json`), 'utf-8'),
  )
  pkg.name = packageName
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`)
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
    let doneMessage = ''
    const cdProjectName = path.relative(cwd, root)
    doneMessage += '创建完成，请执行：'
    if (cwd !== root) {
      doneMessage += `\n cd ${cdProjectName.includes(' ') ? `"${cdProjectName}"` : cdProjectName}`
    }
    doneMessage += `\n ${getInstallCommand(pkgManager).join(' ')}`
    prompts.outro(doneMessage)
  }

  prompts.log.success('程序结束')
}

init()
