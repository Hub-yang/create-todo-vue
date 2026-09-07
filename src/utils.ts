import type { SpawnOptions } from 'node:child_process'
import type { FrameworkVariant } from './constants'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
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

function run([command, ...args]: string[], options?: SpawnOptions) {
  const { status, error } = spawn.sync(command, args, options)

  if (status != null && status > 0) {
    process.exit(status)
  }

  if (error) {
    console.error(`\n${command} ${args.join(' ')} 报错！`)
    console.error(error)
    process.exit(1)
  }
}

export function install(root: string, pkgManager: string) {
  log.step(`使用 ${pkgManager} 安装依赖...`)
  run(getInstallCommand(pkgManager), {
    stdio: 'inherit',
    cwd: root,
  })
}
