import type { Fixture } from './fixture'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
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
  /**
   * **未剥离**的 stdout。
   *
   * 只在断言转义序列本身时才用它——比如「光标隐藏了必须恢复」（CTV-36）：
   * `stdout` 把 `ESC[?25l` / `ESC[?25h` 一并剥掉了，拿它断言光标永远是空。
   */
  stdoutRaw: string
  stderr: string
  timedOut: boolean
}

export interface RunCliOptions {
  /** 驱动 npm_config_user_agent；传 null 则整个删掉该变量 */
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'deno' | (string & {}) | null
  /** 叠加在白名单之上；值为 undefined 表示删除该变量 */
  env?: Record<string, string | undefined>
  timeoutMs?: number
  /**
   * 模拟交互式 Ctrl+C：stdin 改成管道，等 stdout 首次出现这段文本后写入 Ctrl+C 并关闭。
   *
   * 用「等某段输出出现」而不是「等若干毫秒」，是为了不引入时序 flaky——提示还没渲染出来
   * 就把按键喂进去会被丢掉。
   *
   * 写完必须 `end()`：clack 的取消分支会跑完并给出退出码，但 stdin 管道只要还开着，
   * 事件循环就不为空，进程会一直挂着直到超时。
   */
  cancelAfterStdout?: string
  /**
   * 在选择器里**真的选中某一项**：等 stdout 首次出现 `after` 后写入 `send` 并关闭 stdin。
   *
   * clack 的 select 在管道（非 TTY）下同样靠 readline 的 keypress 事件工作——实测确认。
   * 常用字节：`\r` 回车确认当前高亮项（默认是第一项），`\u001B[B` 下移一项。
   *
   * 没有这个能力时，「用户主动选了某个选项」那半边分支在 E2E 里是**不可达**的：
   * 非交互下 clack 的 promise 永不 settle，`await` 之后一行都不执行，于是任何
   * 「选了取消就不该动文件」之类的断言都会假绿——它们通过与那段代码毫无关系。
   */
  respondAfterStdout?: { after: string, send: string }
  /**
   * 在 PATH 最前面放一个立刻成功返回的假包管理器。
   *
   * 解锁的是两条此前**完全没有 E2E 覆盖**的路径：`install()`（`-i`）与 customCommand
   * （转交上游脚手架）。它们都靠 `cross-spawn` 按 PATH 解析命令名，所以换掉 PATH 上的
   * 那个可执行文件就能离线跑完整条路径。
   *
   * ⚠️ 它测的**不是** npm 能不能装包——那是 npm 的事，不该由本仓库的测试负责。
   * 它测的是「我们把命令发出去之后，自己这边的收尾渲染对不对」。CLAUDE.md 里原先记着
   * 这两块「刻意留白」，2026-09-08 做 CTV-34 时按上述边界改成覆盖。
   *
   * 传对象可以指定假包管理器的退出码，用来覆盖**安装失败**那一支（CTV-39）。
   * 挑退出码时避开 1：那个值和「取消」「参数有误」撞车，透传测试会分不清
   * 到底是不是真的透传过来的。
   */
  stubPackageManager?: boolean | { exitCode?: number }
}

/**
 * 假包管理器所在的目录。
 *
 * 建一次、整个 worker 共用，退出时删掉。**不能放进 fixture 目录**——
 * `fixture.tree()` 会把它列出来，那些断言会平白多出几个文件。
 */
let stubBinDir: string | undefined

function ensureStubBin(pkgManager: string, exitCode: number): string {
  if (!stubBinDir) {
    stubBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctv-e2e-stub-'))
    process.on('exit', () => fs.rmSync(stubBinDir!, { recursive: true, force: true }))
  }
  // 退出码不同的假包管理器要各占一个目录，否则同名文件会互相覆盖
  const dir = path.join(stubBinDir, String(exitCode))
  const bin = path.join(dir, pkgManager)
  if (!fs.existsSync(bin)) {
    fs.mkdirSync(dir, { recursive: true })
    // 把收到的参数原样回显，方便失败时看出到底发了什么命令；
    // 非零退出时还往 stderr 写一行，模拟真实包管理器的报错
    const complain = exitCode === 0 ? '' : `echo "[stub ${pkgManager}] 装不上" >&2\n`
    fs.writeFileSync(bin, `#!/bin/sh\necho "[stub ${pkgManager}] $*"\n${complain}exit ${exitCode}\n`)
    fs.chmodSync(bin, 0o755)
  }
  return dir
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
  const pkgManager = options.packageManager === null ? 'npm' : (options.packageManager ?? 'npm')
  const stub = options.stubPackageManager
  const stubDir = stub
    ? ensureStubBin(String(pkgManager).split('/')[0], typeof stub === 'object' ? stub.exitCode ?? 0 : 0)
    : undefined

  const env: Record<string, string | undefined> = {
    // stub 目录必须排在最前面，否则会解析到真的包管理器并联网
    PATH: [stubDir, path.dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin']
      .filter(Boolean)
      .join(':'),
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
 * stdin 默认传 'ignore'，保证子进程拿不到 TTY——否则某个走到交互提示的用例会直接挂住。
 * 只有 `cancelAfterStdout` 会把它换成管道，用来模拟交互式 Ctrl+C。
 */
export function runCli(
  fixture: Fixture,
  args: string[],
  options: RunCliOptions = {},
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    // 两个选项共用同一套「等输出出现再喂字节」的机制，只是喂的内容不同
    const response = options.cancelAfterStdout !== undefined
      ? { after: options.cancelAfterStdout, send: '\u0003' }
      : options.respondAfterStdout
    const wantsCancel = response !== undefined

    const child = spawn(process.execPath, [BIN_PATH, ...args], {
      cwd: fixture.dir,
      env: buildEnv(options),
      stdio: [wantsCancel ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      // 低于 vitest 的用例超时，这样挂住会变成一条带部分输出的可读结果，
      // 而不是被 vitest 直接杀掉 worker
      timeout: options.timeoutMs ?? 30_000,
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let cancelSent = false

    // stdio 后两位恒为 'pipe'，这两个流一定存在；首位是动态的，
    // 所以 TS 只能推出 ChildProcess 而不是 ChildProcessWithoutNullStreams
    const childStdout = child.stdout!
    const childStderr = child.stderr!

    childStdout.on('data', (d) => {
      stdout += d

      if (!wantsCancel || cancelSent) {
        return
      }
      if (!stripVTControlCharacters(stdout).includes(response!.after)) {
        return
      }
      cancelSent = true
      // \u0003 就是 Ctrl+C 的字节。clack 靠 readline 的 keypress 事件识别它，
      // 管道下（非 TTY）同样有效——实测确认过。
      child.stdin!.write(response!.send)
      // 必须收掉：取消分支会跑完并给出退出码，但 stdin 管道只要还开着事件循环就不空，
      // 进程会一直挂到超时
      child.stdin!.end()
    })

    childStderr.on('data', d => (stderr += d))
    child.on('error', reject)
    child.on('close', (code, signal) => {
      // spawn 的 timeout 到点是发信号杀进程，没有独立的 timedOut 标志
      timedOut = signal === 'SIGTERM'
      resolve({
        exitCode: code ?? (timedOut ? -1 : 0),
        stdout: stripVTControlCharacters(stdout),
        stdoutRaw: stdout,
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
