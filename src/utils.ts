import type { SpawnOptions } from 'node:child_process'
import type { FrameworkVariant } from './constants'
import fs from 'node:fs'
import path from 'node:path'
import * as prompts from '@clack/prompts'
import { log } from '@clack/prompts'
import spawn from 'cross-spawn'
import { underline } from 'picocolors'

interface PkgInfo {
  name: string
  version: string
}

/**
 * 从起始目录逐级向上查找 package.json
 *
 * 不写死相对层级，是因为 CLI 在开发态（src/）和发布态（dist/）下与 package.json
 * 的相对位置不同，写死会在其中一态静默读到错误的文件。
 * @param {string} startDir - 起点目录
 * @returns 命中的绝对路径；一路到文件系统根都没有则返回 undefined
 */
export function findPackageJson(startDir: string): string | undefined {
  let dir = path.resolve(startDir)
  while (true) {
    const candidate = path.join(dir, 'package.json')
    if (fs.existsSync(candidate)) {
      return candidate
    }
    const parent = path.dirname(dir)
    // 到达文件系统根时 dirname 会返回自身，以此终止
    if (parent === dir) {
      return undefined
    }
    dir = parent
  }
}

/**
 * 读取自身版本号
 * @param {string} startDir - 查找 package.json 的起点
 * @returns 版本号；读不到时返回 'unknown'（查版本不该让 CLI 崩掉）
 */
export function getVersion(startDir: string): string {
  const pkgPath = findPackageJson(startDir)
  if (!pkgPath) {
    return 'unknown'
  }
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version ?? 'unknown'
  }
  catch {
    return 'unknown'
  }
}

/**
 * 移除末尾'/'
 */
export function formatTargetDir(targetDir: string) {
  return targetDir.trim().replace(/\/+$/g, '')
}

export function pkgFromUserAgent(userAgent: string | undefined): PkgInfo | undefined {
  if (!userAgent) {
    return undefined
  }

  const pkgSpec = userAgent.split(' ')[0]
  const pkgSpecArr = pkgSpec.split('/')
  return {
    name: pkgSpecArr[0],
    version: pkgSpecArr[1],
  }
}

export function cancel() {
  return prompts.cancel('操作已取消')
}

/**
 * 分辨一个路径是「不存在 / 目录 / 其它（文件、软链到文件等）」
 *
 * `isEmpty` 只回答空不空，撞上一个已存在的**文件**时 `fs.readdirSync` 会直接抛
 * ENOTDIR。调用点得先能分辨形态，才谈得上给出人话（CTV-20）。
 *
 * 用 `statSync` 而非 `lstatSync`：跟随符号链接，指向目录的软链应当被当作目录。
 */
export function pathKind(target: string): 'missing' | 'dir' | 'file' {
  if (!fs.existsSync(target)) {
    return 'missing'
  }
  return fs.statSync(target).isDirectory() ? 'dir' : 'file'
}

/**
 * 检测目录是否为空
 */
export function isEmpty(path: string) {
  const files = fs.readdirSync(path)
  return files.length === 0 || (files.length === 1 && files[0] === '.git')
}

/**
 * 删除目录下除‘.git’的所有文件和文件夹
 */
export function emptyDir(dir: string) {
  if (!fs.existsSync(dir)) {
    return false
  }

  for (const file of fs.readdirSync(dir)) {
    if (file === '.git') {
      continue
    }
    fs.rmSync(path.resolve(dir, file), { recursive: true, force: true })
  }
}

/**
 * 校验包名
 */
export function isValidPackageName(projectName: string) {
  return /^(?:@[a-z\d\-*~][a-z\d\-*._~]*\/)?[a-z\d\-~][a-z\d\-._~]*$/.test(projectName)
}

/**
 * 转换为有效包名
 */
export function toValidPackageName(projectName: string) {
  return projectName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/^[._]/, '')
    .replace(/[^a-z\d\-~]+/g, '-')
}

/**
 * 根据预设指令和包信息自动生成完整指令
 */
export function getFullCustomCommand(customCommand: string, pkgInfo?: PkgInfo) {
  const pkgManager = pkgInfo?.name || 'npm'
  const isYarn1 = pkgManager === 'yarn' && pkgInfo?.version?.startsWith('1.')

  return (
    customCommand
      .replace(/^npm create (?:-- )?/, () => {
        // bun create使用它自己的模板集
        if (pkgManager === 'bun') {
          return 'bun x create-'
        }
        // Deno使用‘ run - a npm:create- ’而不是‘ create ’或‘ init ’来提供所需的perms
        if (pkgManager === 'deno') {
          return 'deno run -A npm:create-'
        }
        // pnpm不支持 -- 语法
        if (pkgManager === 'pnpm') {
          return 'pnpm create '
        }
        // 对于其他包管理器，保留原始格式
        return customCommand.startsWith('npm create -- ')
          ? `${pkgManager} create -- `
          : `${pkgManager} create `
      })
    // 只有yarn1.x在create命令中不支持@version
      .replace('@latest', isYarn1 ? '' : '@latest')
      .replace(/^npm exec /, () => {
        // 更推荐 “pnpm dlx”、“yarn dlx” 或 “bun x”
        if (pkgManager === 'pnpm') {
          return 'pnpm dlx '
        }
        if (pkgManager === 'yarn' && !isYarn1) {
          return 'yarn dlx '
        }
        if (pkgManager === 'bun') {
          return 'bun x '
        }
        if (pkgManager === 'deno') {
          return 'deno run -A npm:'
        }
        // 在所有其他情况下使用 ‘npm exec ’，包括Yarn 1.x和其他自定义NPM客户端
        return 'npm exec '
      })
  )
}

/**
 * 获取框架预设终端标题
 */
export function getLabel(variant: FrameworkVariant) {
  const { display, name, color, link } = variant
  const labelText = display || name
  let label = color(labelText)
  if (link) {
    label += ` ${underline(link)}`
  }
  return label
}

/**
 * 拷贝文件夹
 * @param {string} srcDir - 源文件夹地址
 * @param {string} destDir - 目标文件夹地址
 */
export function copyDir(srcDir: string, destDir: string) {
  fs.mkdirSync(destDir, { recursive: true })
  for (const file of fs.readdirSync(srcDir)) {
    const srcFile = path.resolve(srcDir, file)
    const destFile = path.resolve(destDir, file)
    copy(srcFile, destFile)
  }
}

/**
 * 拷贝文件
 * @param {string} src - 源文件地址
 * @param {string} dest - 目标文件地址
 */
export function copy(src: string, dest: string) {
  const state = fs.statSync(src)
  if (state.isDirectory()) {
    copyDir(src, dest)
  }
  else {
    fs.copyFileSync(src, dest)
  }
}

/**
 * 匹配包管理器安装指令
 * @param {string} pkgManager - 包管理器
 */
export function getInstallCommand(pkgManager: string) {
  return pkgManager === 'yarn' ? [pkgManager] : [pkgManager, 'install']
}

/**
 * 拼出执行某个 npm script 的命令
 *
 * 与 `getInstallCommand` 同一个 yarn 特例：yarn 1.x 不需要 `run` 子命令。
 */
export function getRunCommand(pkgManager: string, script: string) {
  return pkgManager === 'yarn' ? [pkgManager, script] : [pkgManager, 'run', script]
}

/**
 * 跑一个子命令，把结果**交回给调用方**，自己绝不退出进程。
 *
 * 这里曾经是 `process.exit(status)`（CTV-39 改掉）。那样做会跳过 `runCli()` 的
 * `finally`，于是安装失败时 clack 的框留着开、光标不恢复——CTV-34 那套
 * 「框线有主人」的保证里唯一的漏网之鱼。`src/` 里现在没有任何 `process.exit()`。
 * @returns 0 表示成功；非零是子命令的退出码，或命令根本跑不起来时的 1
 */
function run([command, ...args]: string[], options?: SpawnOptions): number {
  const { status, error } = spawn.sync(command, args, options)

  if (error) {
    // 命令不存在、没有执行权限之类。刻意只给人话不打栈：这不是本工具的 bug，
    // 一屏 Node 内部栈对用户没有价值（立场同 CTV-31 的非交互提示）
    console.error(`\n${command} ${args.join(' ')} 跑不起来：${error.message}`)
    return 1
  }

  // status 为 null 只在被信号杀死时出现，那种情况也算没跑成
  return status ?? 1
}

/**
 * 在目标目录里装依赖
 * @param {string} root - 目标目录
 * @param {string} pkgManager - 包管理器名
 * @returns 包管理器的退出码，0 表示装成功。**原样透传**——压成 1 会让调用方
 * 分不清「装不上」和「参数写错」，而且那是既有行为（实测退 7 会原样出去）
 */
export function install(root: string, pkgManager: string): number {
  log.step(`使用 ${pkgManager} 安装依赖...`)
  return run(getInstallCommand(pkgManager), {
    stdio: 'inherit',
    cwd: root,
  })
}

/**
 * 逐级向上查找 `.git`，用来判断某个路径是不是已经落在一个 git 仓库里
 *
 * 形状刻意与 `findPackageJson()` 一致，包括「到文件系统根时 `dirname` 返回自身」
 * 这个终止条件。
 *
 * 用 `existsSync` 而不是判断「是不是目录」：git worktree 与 submodule 里的 `.git`
 * 是一个**文件**（内容是 `gitdir: …`），那同样意味着已经在仓库里了。
 *
 * @param {string} startDir - 查找起点
 * @returns 找到的 `.git` 路径；一路到根都没有则返回 undefined
 */
export function findGitDir(startDir: string): string | undefined {
  let dir = path.resolve(startDir)
  while (true) {
    const candidate = path.join(dir, '.git')
    if (fs.existsSync(candidate)) {
      return candidate
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      return undefined
    }
    dir = parent
  }
}

/**
 * 在目标目录里初始化 git 仓库
 *
 * `stdio: 'ignore'` 是必需的：git init 会打一句 "Initialized empty Git repository
 * in …"，那行字会落在 clack 的框里，把我们自己维护的渲染撞乱（同 CTV-34 的立场）。
 *
 * @param {string} root - 目标目录
 * @returns git 的退出码，0 表示成功
 */
export function gitInit(root: string): number {
  return run(['git', 'init'], {
    stdio: 'ignore',
    cwd: root,
  })
}
