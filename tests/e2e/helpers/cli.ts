import type { Fixture } from './fixture'
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
export const BIN_PATH = path.resolve(REPO_ROOT, 'bin/index.js')

export interface CliResult {
  exitCode: number
  /** 已剥掉 ANSI，断言可以直接匹配子串 */
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface RunCliOptions {
  /** 驱动 npm_config_user_agent；传 null 则整个删掉该变量 */
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'deno' | (string & {}) | null
  /** 叠加在白名单之上；值为 undefined 表示删除该变量 */
  env?: Record<string, string | undefined>
  timeoutMs?: number
}

/**
 * 交给 CLI 的环境变量是一份**白名单**，绝不是当前进程的环境。
 *
 * 泄漏真实环境会静默摧毁这套断言的有效性：
 * - `npm_config_user_agent` 决定 `pkgFromUserAgent()` 认出哪个包管理器，
 *   它既影响收尾提示里的安装命令，也影响 customCommand 的改写结果。
 *   跑测试的人用 pnpm 还是 npm，不该改变断言。
 * - 颜色相关变量决定 picocolors 是否注入 ANSI。虽然下面统一剥了转义码，
 *   但固定住能让失败时打印的输出可读。
 */
function buildEnv(options: RunCliOptions): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {
    PATH: [path.dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    LANG: 'en_US.UTF-8',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    TERM: 'dumb',
    npm_config_user_agent: userAgentFor(options.packageManager ?? 'npm'),
  }

  if (options.packageManager === null) {
    delete env.npm_config_user_agent
  }

  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) {
      delete env[key]
    }
    else {
      env[key] = value
    }
  }

  return Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined),
  ) as NodeJS.ProcessEnv
}

function userAgentFor(pm: string): string {
  // pkgFromUserAgent() 先按空格取第一段，再按 "/" 拆成 name/version
  const withVersion = pm.includes('/') ? pm : `${pm}/10.9.2`
  return `${withVersion} npm/? node/${process.version} ${process.platform} ${process.arch}`
}

/**
 * 在 fixture 目录里跑构建好的 CLI。
 *
 * cwd 是传给子进程的，而不是改本进程的工作目录：vitest 的 worker 共享进程，
 * `process.chdir()` 会污染同时在跑的其它用例。**这些测试里永远不要调 chdir。**
 *
 * stdin 传 'ignore'，保证子进程拿不到 TTY——否则某个走到交互提示的用例会直接挂住。
 */
export function runCli(
  fixture: Fixture,
  args: string[],
  options: RunCliOptions = {},
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN_PATH, ...args], {
      cwd: fixture.dir,
      env: buildEnv(options),
      stdio: ['ignore', 'pipe', 'pipe'],
      // 低于 vitest 的用例超时，这样挂住会变成一条带部分输出的可读结果，
      // 而不是被 vitest 直接杀掉 worker
      timeout: options.timeoutMs ?? 30_000,
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    child.stdout.on('data', d => (stdout += d))
    child.stderr.on('data', d => (stderr += d))
    child.on('error', reject)
    child.on('close', (code, signal) => {
      // spawn 的 timeout 到点是发信号杀进程，没有独立的 timedOut 标志
      timedOut = signal === 'SIGTERM'
      resolve({
        exitCode: code ?? (timedOut ? -1 : 0),
        stdout: stripVTControlCharacters(stdout),
        stderr: stripVTControlCharacters(stderr),
        timedOut,
      })
    })
  })
}

/** 失败时把 fixture 路径、文件树和完整输出一起抛出来，省去二次复现 */
export function assertOk(result: CliResult, fixture: Fixture): void {
  if (result.exitCode === 0 && !result.timedOut) {
    return
  }

  throw new Error(
    `CLI 退出码 ${result.exitCode}（期望 0）${result.timedOut ? ' [超时]' : ''}\n`
    + `fixture: ${fixture.dir}\n`
    + `--- stdout ---\n${result.stdout}\n`
    + `--- stderr ---\n${result.stderr}\n`
    + `--- tree ---\n${fixture.tree().join('\n')}\n`,
  )
}
