import type { Fixture } from './helpers/fixture'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from './helpers/cli'
import { createFixture } from './helpers/fixture'

/** 恢复光标的转义序列。写成 \u001B 转义：裸控制字符在 diff 与编辑器里都是隐形的 */
const SHOW_CURSOR = '\u001B[?25h'

/**
 * CTV-39：安装依赖那一步失败时的收场。
 *
 * 改之前的实测（`-i` 且假包管理器返回非零）：
 *
 * | 场景 | 退出码 | 框线 | 光标 | 项目 |
 * |---|---|---|---|---|
 * | 包管理器退 1 | 1（透传） | ❌ 开着 | ❌ 未恢复 | 已建好 |
 * | 包管理器退 7 | 7（透传） | ❌ | ❌ | 已建好 |
 * | 命令不存在 | 1 + 裸 Node 调用栈 | ❌ | ❌ | 已建好 |
 *
 * 病根是 `utils.ts` 私有的 `run()` 直接 `process.exit(status)`，跳过了 `runCli()` 的
 * `finally`——CTV-34 那套「框线有主人」的保证里唯一的漏网之鱼。
 *
 * **两件事都要守住，别顾此失彼**：
 * 1. 框和光标要收好（CTV-34 的保证覆盖到这条路径）；
 * 2. **包管理器的原始退出码要原样带出去**。改成抛异常最省事，但那会让退出码一律变成 1，
 *    是行为倒退——实测确认现在 7 是真的透传的，那是既有行为，不能弄丢。
 *
 * 还有一件容易被忽略的事实：**失败时项目其实已经建好了**，只有装依赖那步没成。
 * 用户此刻手里有一个完好的项目却不知道，所以要告诉他，并给出手动安装的命令。
 */
describe('安装依赖失败', () => {
  let fixture: Fixture

  beforeEach(() => {
    fixture = createFixture()
  })

  afterEach((ctx) => {
    fixture.cleanup(ctx.task.result?.state === 'fail')
  })

  /**
   * 用 7 而不是 1：1 和「取消」「参数有误」撞车，透传测试会分不清退出码
   * 到底是包管理器给的还是我们自己兜出来的。
   */
  it('原样透传包管理器的退出码，不压成 1', async () => {
    const result = await runCli(
      fixture,
      ['app', '-t', 'vanilla', '--overwrite', '-i'],
      { stubPackageManager: { exitCode: 7 } },
    )

    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(7)
  })

  it('框收掉了，不再停在半截', async () => {
    const result = await runCli(
      fixture,
      ['app', '-t', 'vanilla', '--overwrite', '-i'],
      { stubPackageManager: { exitCode: 7 } },
    )

    const lines = result.stdout.split('\n').map(l => l.trimEnd()).filter(Boolean)
    expect(lines.at(-1)).toMatch(/^└/)
  })

  it('光标恢复了', async () => {
    const result = await runCli(
      fixture,
      ['app', '-t', 'vanilla', '--overwrite', '-i'],
      { stubPackageManager: { exitCode: 7 } },
    )

    // finally 真的跑到了的唯一可观测证据
    expect(result.stdoutRaw.endsWith(SHOW_CURSOR)).toBe(true)
  })

  /**
   * 装依赖失败**不该**回滚已经生成的项目——用户要的东西已经在那儿了，
   * 删掉它只会让他白等一次。
   */
  it('项目仍然完好，不因为装不上就被清掉', async () => {
    const result = await runCli(
      fixture,
      ['app', '-t', 'vanilla', '--overwrite', '-i'],
      { stubPackageManager: { exitCode: 7 } },
    )

    expect(result.exitCode).not.toBe(0)
    expect(fixture.exists('app/package.json')).toBe(true)
    expect(fixture.exists('app/index.html')).toBe(true)
  })

  it('告诉用户项目已经建好了，以及怎么自己把依赖装上', async () => {
    const result = await runCli(
      fixture,
      ['app', '-t', 'vanilla', '--overwrite', '-i'],
      { stubPackageManager: { exitCode: 7 } },
    )

    expect(result.stdout).toContain('依赖安装失败')
    // 项目还在这件事必须说出来，否则用户不知道自己手里有什么
    expect(result.stdout).toContain('项目已创建')
    // 手动补装的命令
    expect(result.stdout).toContain('cd app')
    expect(result.stdout).toMatch(/^[│\s]*npm install\s*$/m)
  })

  /**
   * CTV-31 定的立场：不是我们的 bug 就不打调用栈。包管理器没装、或者名字拼错，
   * 属于环境问题，一屏 Node 内部栈对用户没有任何价值。
   */
  it('包管理器命令不存在时给人话，不打裸调用栈', async () => {
    const result = await runCli(
      fixture,
      ['app', '-t', 'vanilla', '--overwrite', '-i'],
      { packageManager: 'bogus-pm/1.0.0' },
    )

    const output = result.stdout + result.stderr
    expect(result.exitCode).not.toBe(0)
    expect(output).not.toContain('    at Object.spawnSync')
    expect(output).not.toContain('node:internal')
    // 但要说清是哪个命令出的问题
    expect(output).toContain('bogus-pm')
  })

  it('包管理器命令不存在时，框和光标同样收好', async () => {
    const result = await runCli(
      fixture,
      ['app', '-t', 'vanilla', '--overwrite', '-i'],
      { packageManager: 'bogus-pm/1.0.0' },
    )

    const lines = result.stdout.split('\n').map(l => l.trimEnd()).filter(Boolean)
    expect(lines.at(-1)).toMatch(/^└/)
    expect(result.stdoutRaw.endsWith(SHOW_CURSOR)).toBe(true)
  })

  /** 回归：成功那一支不能被这次改动带歪 */
  it('对照：安装成功仍然退 0 并以「程序结束」收尾', async () => {
    const result = await runCli(
      fixture,
      ['app', '-t', 'vanilla', '--overwrite', '-i'],
      { stubPackageManager: true },
    )

    const lines = result.stdout.split('\n').map(l => l.trimEnd()).filter(Boolean)
    expect(result.exitCode).toBe(0)
    expect(lines.at(-1)).toBe('└  程序结束')
    expect(result.stdout).toContain('依赖安装完成，请执行：')
  })
})
