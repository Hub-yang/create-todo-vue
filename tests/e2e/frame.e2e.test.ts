import type { CliResult } from './helpers/cli'
import type { Fixture } from './helpers/fixture'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from './helpers/cli'
import { createFixture } from './helpers/fixture'

/**
 * CTV-34 / 36 / 37：退出前把终端还原成该有的样子。
 *
 * **三个条目各点了一处，实测有六处。** 摸底结果（改之前）：
 *
 * | 路径 | 现状 |
 * |---|---|
 * | 8 处 `cancelled()` | ✅ `cancel()` 自己打了 `└` |
 * | 非法 `--package-name` | ❌ 框只开不关（CTV-37） |
 * | customCommand 转交上游 | ❌ 框只开不关（**三个条目都没点到**） |
 * | 成功 · 装依赖 | ❌ 压根没调 `outro()`（CTV-34） |
 * | 成功 · 不装依赖 | ❌ `程序结束` 落在 `└` 之后（CTV-34） |
 * | runCli 崩溃兜底 | ❌ 框只开不关（**三个条目都没点到**） |
 * | 非交互分流 | ✅ 框正常，❌ 光标没恢复（CTV-36） |
 *
 * 所以修法不是补六处，而是让「谁负责关框」有主人：`src/terminal.ts` 持状态，
 * `runCli()` 的 `finally` 无条件兜底。本文件就是那条保证的钉子——**将来新增退出路径
 * 若忘了收尾，这里会红**。
 *
 * ⚠️ 数 `└` 的个数是不可靠的判据：画到一半的 select 菜单自己也会渲染一行 `└`
 * （实测非交互路径能数出 2 个）。所以断言统一看**最后一行非空输出**，
 * 它同时钉住了「框关了」和「关了之后没再打字」两件事。
 *
 * ⚠️ 有明确收尾语的路径必须**整行相等**，不能只判 `/^└/`。变异测试实测过这个坑：
 * `outro('')` 渲染成 `└  `，`/^└/` 一样通过——于是「成功路径不自己收框、全靠 finally
 * 兜底（收尾语丢了）」这个变异全绿存活。判据仍是那句老话：**改源码的哪一处能让这条
 * 断言变红？** 答不上来就是恒等式。
 */

/**
 * 恢复光标的转义序列。写成 `\u001B` 转义而不是裸字节：裸控制字符在 diff 和编辑器里
 * 都是隐形的，上一轮就因此在正则里踩过 `no-control-regex`。
 */
const SHOW_CURSOR = '\u001B[?25h'

/**
 * 输出是不是以「恢复光标」收尾。
 *
 * 这是 `runCli()` 的 `finally` **真的跑到了**的唯一可观测证据，也是变异测试逼出来的：
 * 只判 `show >= hide` 不够——clack 的 spinner 自己也会写一个恢复光标，把差异盖掉，
 * 于是「转交上游改回 process.exit（跳过 finally）」和「崩溃兜底改回 process.exit(1)」
 * 两个变异都能全绿存活（实测差异恰好是这 6 个字节）。
 *
 * 实测：开过框的 5 条路径全部以它收尾，`--help` / `--version` 都不带（也不该带）。
 */
function endsWithCursorRestore(result: CliResult): boolean {
  return result.stdoutRaw.endsWith(SHOW_CURSOR)
}

/** stdout 里最后一行非空内容 */
function lastLine(result: CliResult): string {
  const lines = result.stdout.split('\n').map(l => l.trimEnd()).filter(l => l.length > 0)
  return lines.at(-1) ?? ''
}

/**
 * 隐藏光标 / 恢复光标各出现了几次。必须看**未剥离**的 stdout。
 *
 * 正则里刻意不写 `ESC` 本身：控制字符会被 eslint 的 `no-control-regex` 拦下，
 * 而只匹配可见的 `[?25l` / `[?25h` 计数一样精确——CLI 的输出里不会有别的东西长这样。
 */
function cursor(result: CliResult): { hide: number, show: number } {
  return {
    hide: (result.stdoutRaw.match(/\[\?25l/g) ?? []).length,
    show: (result.stdoutRaw.match(/\[\?25h/g) ?? []).length,
  }
}

describe('框线：每条退出路径都要把框收掉', () => {
  let fixture: Fixture

  beforeEach(() => {
    fixture = createFixture()
  })

  afterEach((ctx) => {
    fixture.cleanup(ctx.task.result?.state === 'fail')
  })

  it('成功 · 不装依赖：收尾语在框里，不在框外', async () => {
    const result = await runCli(fixture, ['app', '-t', 'vanilla', '--overwrite', '--no-immediate'])

    expect(result.exitCode).toBe(0)
    // 整行相等：只判 /^└/ 的话，收尾语丢掉、退化成光秃秃的 `└  ` 也照样绿
    expect(lastLine(result)).toBe('└  程序结束')
    // 内容一个字都不能少：创建完成的指引仍要出现
    expect(result.stdout).toContain('创建完成，请执行：')
    expect(result.stdout).toContain('npm install')
  })

  it('成功 · 装依赖：同样把框收掉，且两支形状一致', async () => {
    const result = await runCli(
      fixture,
      ['app', '-t', 'vanilla', '--overwrite', '-i'],
      { stubPackageManager: true },
    )

    expect(result.exitCode).toBe(0)
    // 两支形状一致，指的就是这一行也得一模一样
    expect(lastLine(result)).toBe('└  程序结束')
    expect(endsWithCursorRestore(result)).toBe(true)
    expect(result.stdout).toContain('依赖安装完成，请执行：')
    expect(result.stdout).toContain('npm run dev')
    // 确认真的走了安装分支，而不是悄悄落到不装依赖那一支
    expect(result.stdout).toContain('[stub npm] install')
  })

  it('非交互报错：框收掉了', async () => {
    const result = await runCli(fixture, ['app', '--overwrite', '--no-immediate'])

    expect(result.exitCode).toBe(1)
    expect(lastLine(result)).toBe('└  操作已取消')
  })

  it('交互式 Ctrl+C：框收掉了，且没有多出第二条收尾', async () => {
    const result = await runCli(
      fixture,
      ['z', '--overwrite', '--no-immediate'],
      { cancelAfterStdout: '选择模板' },
    )

    expect(result.exitCode).toBe(1)
    expect(lastLine(result)).toBe('└  操作已取消')
    // cancel() 已经收过一次，finally 不许再补一条。
    //
    // ⚠️ 过滤条件必须是 `└  `（两个空格）而不是单字符 `└`：**半截 select 菜单自己
    // 会渲染一行光秃秃的 `└`**，按单字符数正常输出就有 2 行，这条用例会恒红。
    // 两个空格恰好把菜单那根排除、又能抓住多余的收尾——`outro('')` 渲染成 `└  `，
    // 同样落在这个过滤里（实测确认）。
    expect(result.stdout.split('\n').filter(l => l.startsWith('└  '))).toHaveLength(1)
  })

  it('崩溃兜底：框收掉了，错误信息仍在', async () => {
    fixture.write('taken', '我是文件，不是目录')

    const result = await runCli(fixture, ['taken/sub', '-t', 'vanilla', '--overwrite', '--no-immediate'])

    expect(result.exitCode).toBe(1)
    expect(lastLine(result)).toBe('└  已中止')
    expect(result.stdout).toContain('创建失败')
    // 兜底里用 process.exit(1) 的话会跳过 finally，这里会红
    expect(endsWithCursorRestore(result), 'finally 没跑到：崩溃兜底里 process.exit 了').toBe(true)
  })

  it('非法 --package-name：根本不该开框', async () => {
    const result = await runCli(
      fixture,
      ['app', '-t', 'vanilla', '--package-name', 'My Pkg', '--overwrite', '--no-immediate'],
    )

    expect(result.exitCode).toBe(1)
    // 与「未知参数」同形：命令行本身就不对，压根不进交互界面
    expect(result.stdout.trim()).toBe('')
    expect(result.stderr).toContain('My Pkg')
  })

  it('转交上游：先收掉自己的框，再把终端交出去', async () => {
    const result = await runCli(
      fixture,
      ['app', '-t', 'custom-nuxt', '--overwrite', '--no-immediate'],
      { stubPackageManager: true },
    )

    expect(result.exitCode).toBe(0)
    const out = result.stdout
    const closedAt = out.indexOf('\n└')
    const handoffAt = out.indexOf('[stub npm]')
    expect(closedAt, '自己的框没收掉就把终端交出去了').toBeGreaterThan(-1)
    expect(handoffAt, '没有真的转交给上游').toBeGreaterThan(-1)
    expect(closedAt, '上游输出被套在了我们的半截框里').toBeLessThan(handoffAt)
    // 转交之后仍要回到 runCli 的 finally——用 process.exit 走人的话这里会红
    expect(endsWithCursorRestore(result), 'finally 没跑到：转交上游之后直接 process.exit 了').toBe(true)
  })

  /**
   * `--help` / `--version` / 未知参数都排在 `intro()` 之前，本来就不该有框。
   * 这条守的是「别为了收框而到处乱开框」的反方向。
   */
  it('intro 之前就返回的路径不该出现任何框线', async () => {
    for (const args of [['--help'], ['--version'], ['--bogus']]) {
      const result = await runCli(fixture, args)
      expect(result.stdout, `${args.join(' ')} 不该画框`).not.toContain('┌')
      expect(result.stdout, `${args.join(' ')} 不该画框`).not.toContain('└')
    }
  })
})

describe('光标：隐藏了就必须恢复', () => {
  let fixture: Fixture

  beforeEach(() => {
    fixture = createFixture()
  })

  afterEach((ctx) => {
    fixture.cleanup(ctx.task.result?.state === 'fail')
  })

  /**
   * CTV-36。改之前实测：非交互报错路径 `?25l` 出现 1 次、`?25h` 0 次，
   * 而成功路径是 1:1。根因是 clack 的 prompt 永不 settle，它自己的清理一行没跑。
   */
  it('非交互报错后光标要恢复', async () => {
    const result = await runCli(fixture, ['app', '--overwrite', '--no-immediate'])

    const { hide, show } = cursor(result)
    expect(hide, '这条路径本该隐藏过光标，否则这条用例没在测它想测的东西').toBeGreaterThan(0)
    expect(show).toBeGreaterThanOrEqual(hide)
  })

  it('崩溃兜底后光标要恢复', async () => {
    fixture.write('taken', '我是文件，不是目录')

    const result = await runCli(fixture, ['taken/sub', '-t', 'vanilla', '--overwrite', '--no-immediate'])

    const { hide, show } = cursor(result)
    expect(show).toBeGreaterThanOrEqual(hide)
  })

  /**
   * ⚠️ 回归钉子。做本条目时**真的踩过**：`finally` 里无条件调 `restoreCursor()`，
   * 于是 `--version` 的 stdout 从 `1.5.0\n`（5 个可见字节）变成后面挂着 `ESC[?25h`，
   * `VERSION=$(create-todo-vue --version)` 拿到的字符串直接带上转义序列。
   *
   * 断言用**未剥离**的 stdout 并整串相等，不能用 `toContain('1.5.0')`——
   * 那样多出来的字节照样全绿。
   */
  it('--version 的输出里不许掺任何转义序列', async () => {
    const result = await runCli(fixture, ['--version'])

    expect(result.exitCode).toBe(0)
    expect(result.stdoutRaw).toMatch(/^\d+\.\d+\.\d+\n$/)
  })

  it('--help 的输出里不许掺光标转义序列', async () => {
    const result = await runCli(fixture, ['--help'])

    const { hide, show } = cursor(result)
    expect(hide).toBe(0)
    expect(show).toBe(0)
  })

  it('成功路径的光标本来就是平衡的，别改坏了', async () => {
    const result = await runCli(fixture, ['app', '-t', 'vanilla', '--overwrite', '--no-immediate'])

    const { hide, show } = cursor(result)
    expect(show).toBeGreaterThanOrEqual(hide)
  })
})
