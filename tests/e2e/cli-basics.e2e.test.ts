import type { Fixture } from './helpers/fixture'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TEMPLATES } from '../../src/constants'
import { runCli } from './helpers/cli'
import { createFixture } from './helpers/fixture'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

describe('命令行基础行为', () => {
  let fixture: Fixture

  beforeEach(() => {
    fixture = createFixture()
  })

  afterEach((ctx) => {
    fixture.cleanup(ctx.task.result?.state === 'fail')
  })

  it('--help 打印用法并退出 0', async () => {
    const result = await runCli(fixture, ['--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('用法:')
    expect(result.stdout).toContain('-v, --version')
    expect(result.stdout).toContain('可用模板:')
  })

  it('-h 是 --help 的别名', async () => {
    const long = await runCli(fixture, ['--help'])
    const short = await runCli(fixture, ['-h'])

    expect(short.exitCode).toBe(0)
    expect(short.stdout).toBe(long.stdout)
  })

  it('帮助里列出的模板都是真实存在的内置模板', async () => {
    const result = await runCli(fixture, ['--help'])
    const listed = result.stdout.split('可用模板:')[1].split(/\s+/).filter(Boolean)

    expect(listed.length).toBeGreaterThan(0)
    for (const name of listed) {
      expect(TEMPLATES, `帮助里列了 ${name}，但 TEMPLATES 里没有`).toContain(name)
      expect(fs.existsSync(path.join(REPO_ROOT, `template-${name}`)), `缺少 template-${name} 目录`)
        .toBe(true)
    }
  })

  it('--version 打印的版本号与 package.json 一致', async () => {
    const expected = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'),
    ).version
    const result = await runCli(fixture, ['--version'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe(expected)
  })

  it('-v 是 --version 的别名', async () => {
    const long = await runCli(fixture, ['--version'])
    const short = await runCli(fixture, ['-v'])

    expect(short.exitCode).toBe(0)
    expect(short.stdout).toBe(long.stdout)
  })

  it('--version 不创建任何东西', async () => {
    await runCli(fixture, ['--version'])
    expect(fixture.tree()).toEqual([])
  })

  it('无效模板名会回落到选择器并列出可选项', async () => {
    const result = await runCli(fixture, ['x', '-t', 'nope', '--overwrite', '--no-immediate'])

    expect(result.timedOut).toBe(false)
    expect(result.stdout).toContain('nope不是有效的模板名')
    // 已下架的 vitesse 不该再出现在选项里
    expect(result.stdout).not.toContain('vitesse')
    // 没选中任何东西，不该留下半成品
    expect(fixture.exists('x')).toBe(false)
  })

  // CTV-02 的回归钉子：这条路径以前是 unhandled rejection，首屏是 node 内部栈。
  it('目标名是一个已存在的文件时，给出可读报错并以非零码退出', async () => {
    fixture.write('taken', '我是文件，不是目录')

    const result = await runCli(fixture, ['taken', '-t', 'vue-ts', '--overwrite', '--no-immediate'])

    expect(result.exitCode).toBe(1)
    // 首屏是 clack 格式的一行错误信息，不是 node 内部栈
    const firstErrorLine = result.stdout.split('\n').find(l => l.includes('ENOTDIR'))
    expect(firstErrorLine).toBeDefined()
    expect(firstErrorLine).not.toContain('node:internal')
  })
})

/**
 * CTV-29：取消操作必须以非零码退出。
 *
 * 这里断言的是**非交互**场景（stdin 关闭），也就是脚本化调用会踩的那个：
 * 以前它们退 0，调用方无从分辨「用户取消」和「创建成功」。
 *
 * ⚠️ 机制与直觉不同，实测过：`@clack/core@1.4.3` 的 prompt 在 stdin 不可读时
 * **promise 永不 settle**，`await` 之后的代码一行都不执行——`isCancel` 分支和
 * `cancel()` 从来没被调用过，进程是靠事件循环排空自然退出的。所以：
 *
 * - **不要**在这里断言「操作已取消」那句提示，它在这条路径上永远不会出现；
 * - 退出码不是靠 `cancel()` 返回值给的，而是靠 `runCli()` 预置的悲观退出码兜住的。
 *
 * 交互式 Ctrl+C 是**另一条**路径，`cancelled()` 在那里真的会执行——由本组最后一条
 * 用例覆盖，靠 `cancelAfterStdout` 往 stdin 管道里喂 Ctrl+C 的字节。两条路径都要有，
 * 缺一条就会有变异逃逸：实测过，只留非交互三条时「`cancelled()` 改成返回 0」这个
 * 变异能全绿存活。
 *
 * 仍有一条进不了 E2E，只有代码审查覆盖：非空目录时主动选中「取消操作」那个选项——
 * 它要求在选择器里真的选中某一项，喂一个取消键到不了。
 */
describe('取消操作的退出码', () => {
  let fixture: Fixture

  beforeEach(() => {
    fixture = createFixture()
  })

  afterEach((ctx) => {
    fixture.cleanup(ctx.task.result?.state === 'fail')
  })

  it('无效模板名导致取消时，以非零码退出且不留下任何东西', async () => {
    const result = await runCli(fixture, ['x', '-t', 'nope', '--overwrite', '--no-immediate'])

    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(fixture.exists('x')).toBe(false)
  })

  it('未指定模板、在框架选择器上取消时，以非零码退出', async () => {
    const result = await runCli(fixture, ['y', '--overwrite', '--no-immediate'])

    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(fixture.exists('y')).toBe(false)
  })

  // 这条覆盖的是**交互式**取消（Ctrl+C），也就是 `cancelled()` 真的被执行到的那一半。
  // 上面三条走不到它——stdin 不可读时 promise 永不 settle，退出码是靠悲观预置兜住的。
  it('交互式 Ctrl+C 取消时，打印提示并以非零码退出', async () => {
    const result = await runCli(fixture, ['z', '--overwrite', '--no-immediate'], {
      cancelAfterStdout: '选择模板',
    })

    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('操作已取消')
    expect(fixture.exists('z')).toBe(false)
  })

  it('未指定目录、在项目名输入上取消时，以非零码退出', async () => {
    const result = await runCli(fixture, ['-t', 'vue-ts', '--overwrite', '--no-immediate'])

    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(fixture.tree()).toEqual([])
  })
})

/**
 * CTV-17：mri 默认静默吞掉未声明的 flag。
 *
 * 实测过一个比「被忽略」更糟的后果：`--overwirte my-app` 会让 mri 把 `my-app` 当成
 * 那个拼错 flag 的值吃掉（得到 `{overwirte: 'my-app'}`，`_` 是空的），于是项目名也丢了，
 * CLI 会转而追问「项目名称」——用户完全看不出自己打错了什么。
 */
describe('未知参数校验', () => {
  let fixture: Fixture

  beforeEach(() => {
    fixture = createFixture()
  })

  afterEach((ctx) => {
    fixture.cleanup(ctx.task.result?.state === 'fail')
  })

  it('拼错的参数会被指出来，并以非零码退出', async () => {
    const result = await runCli(fixture, ['--overwirte', 'my-app'])

    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--overwirte')
  })

  it('报错后不进入交互，也不留下任何东西', async () => {
    const result = await runCli(fixture, ['--overwirte', 'my-app'])

    expect(result.stdout).not.toContain('项目名称')
    expect(fixture.tree()).toEqual([])
  })

  it('提示用户去看 --help', async () => {
    const result = await runCli(fixture, ['--bogus'])

    expect(result.stderr).toContain('--help')
  })

  it('合法参数组合不受影响', async () => {
    const result = await runCli(fixture, ['ok', '-t', 'vue-ts', '--overwrite', '--no-immediate'])

    expect(result.exitCode).toBe(0)
    expect(fixture.exists('ok/package.json')).toBe(true)
  })
})
