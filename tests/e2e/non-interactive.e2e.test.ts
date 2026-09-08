import type { Fixture } from './helpers/fixture'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from './helpers/cli'
import { createFixture } from './helpers/fixture'

/**
 * CTV-31：非交互环境下走到提问点时，给一句人话，而不是画个菜单然后静默死掉。
 *
 * 病根（CTV-29 时实测出来的）：`@clack/core@1.4.3` 的 prompt 在 stdin 不可读时
 * **promise 永不 settle**，`await` 之后一行都不执行。进程靠事件循环排空自然退出，
 * 退出码是 `runCli()` 预置的悲观值兜住的，不是任何一段取消逻辑给的。用户在 CI 日志里
 * 只能看到一个画到一半的选择器。
 *
 * 本组断言的正是「那句人话」本身。两件事必须同时成立，缺一条这个条目就没做完：
 * 1. **说清楚卡在哪** —— 这一步在问什么；
 * 2. **说清楚怎么绕过去** —— 非交互环境下该改用哪个参数。
 *
 * ⚠️ 断言里的提示文案全部**硬编码**，不从 `src/` 里 import 任何常量派生。
 * 期望值一旦从被测源码派生，改文案时输出和期望会一起变，断言就退化成恒等式
 * （CTV-30 用变异实测证实过一次）。判据：改 `src/index.ts` 里那句 hint 就该转红。
 *
 * 输出走 stdout 而不是 stderr：此时 `intro()` 的框已经开着，混流会把框线打断。
 * 这与既有的「操作已取消」保持一致（那条也在 stdout 上断言）。
 */
describe('非交互环境下的提示', () => {
  let fixture: Fixture

  beforeEach(() => {
    fixture = createFixture()
  })

  afterEach((ctx) => {
    fixture.cleanup(ctx.task.result?.state === 'fail')
  })

  it('缺项目名时，告诉用户把它当位置参数传', async () => {
    const result = await runCli(fixture, ['-t', 'vanilla', '--overwrite', '--no-immediate'])

    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('需要交互才能继续')
    expect(result.stdout).toContain('create-todo-vue my-app')
    expect(fixture.tree()).toEqual([])
  })

  it('目标目录不为空时，告诉用户加 --overwrite，并说明它会清空目录', async () => {
    fixture.write('busy/keep.txt', '别动我')

    const result = await runCli(fixture, ['busy', '-t', 'vanilla', '--no-immediate'])

    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('需要交互才能继续')
    expect(result.stdout).toContain('--overwrite')
    expect(result.stdout).toContain('会清空该目录')
    // 报错归报错，一个字节都不许动
    expect(fixture.read('busy/keep.txt')).toBe('别动我')
  })

  it('目标是同名文件时，告诉用户加 --overwrite，并说明它会删掉这个文件', async () => {
    fixture.write('taken', '我是文件，不是目录')

    const result = await runCli(fixture, ['taken', '-t', 'vanilla', '--no-immediate'])

    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('需要交互才能继续')
    expect(result.stdout).toContain('会删除该文件')
    expect(fixture.read('taken')).toBe('我是文件，不是目录')
  })

  it('缺 -t 时，告诉用户去 --help 看可用模板', async () => {
    const result = await runCli(fixture, ['app', '--overwrite', '--no-immediate'])

    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('需要交互才能继续')
    expect(result.stdout).toContain('-t')
    expect(result.stdout).toContain('--help')
    expect(fixture.tree()).toEqual([])
  })

  it('目录名推不出合法包名时，告诉用户加 --package-name', async () => {
    const result = await runCli(fixture, ['.foo', '-t', 'vanilla', '--overwrite', '--no-immediate'])

    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('需要交互才能继续')
    expect(result.stdout).toContain('--package-name')
  })

  it('缺 -i / --no-immediate 时，两个参数都告诉用户', async () => {
    const result = await runCli(fixture, ['app', '-t', 'vanilla', '--overwrite'])

    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('需要交互才能继续')
    expect(result.stdout).toContain('-i')
    expect(result.stdout).toContain('--no-immediate')
  })

  /**
   * ⚠️ 这条**不能**只断言 `选择模板`：那四个字在画到一半的菜单里本来就有，
   * 断言会跟新代码毫无关系地全绿（改之前实测过，它就是这么绿的）。
   * 必须连着「这一步在问：」一起断，那句话只有新代码会打。
   */
  it('提示里点名当前卡在哪一步，而不是只说「需要交互」', async () => {
    const result = await runCli(fixture, ['app', '--overwrite', '--no-immediate'])

    expect(result.stdout).toContain('这一步在问：选择模板')
  })

  /**
   * ⚠️ 第一条断言不是凑数：没有它，这条用例在「压根没抛异常」的旧行为下也全绿，
   * 证明不了「抛了但没打栈」。先钉住确实走到了新路径，后面三条才有意义。
   */
  it('不打调用栈——参数没给全不是 bug', async () => {
    const result = await runCli(fixture, ['app', '--overwrite', '--no-immediate'])

    const output = result.stdout + result.stderr
    expect(result.stdout).toContain('需要交互才能继续')
    expect(output).not.toContain('    at ')
    expect(output).not.toContain('NonInteractiveError')
    expect(output).not.toContain('创建失败')
  })
})

/**
 * CTV-31 · B1：`--package-name` 是「参数齐全就能全程无交互」的最后一块。
 *
 * 在它之前，目录名推不出合法包名（`My App`、`.foo`）时，非交互调用必然卡在包名提问上，
 * 而且**没有任何 flag 能救**——这是脚手架里唯一一个给不出参数的提问点。
 */
describe('--package-name', () => {
  let fixture: Fixture

  beforeEach(() => {
    fixture = createFixture()
  })

  afterEach((ctx) => {
    fixture.cleanup(ctx.task.result?.state === 'fail')
  })

  it('补上包名后，推不出合法包名的目录也能全程无交互地建出来', async () => {
    const result = await runCli(fixture, [
      '.foo',
      '-t',
      'vanilla',
      '--package-name',
      'my-pkg',
      '--overwrite',
      '--no-immediate',
    ])

    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(0)
    expect(fixture.readJson('.foo/package.json').name).toBe('my-pkg')
  })

  it('目录名本来就合法时，显式参数照样优先', async () => {
    const result = await runCli(fixture, [
      'my-app',
      '-t',
      'vanilla',
      '--package-name',
      'other-name',
      '--overwrite',
      '--no-immediate',
    ])

    expect(result.exitCode).toBe(0)
    expect(fixture.readJson('my-app/package.json').name).toBe('other-name')
  })

  it('非法包名直接报错，不静默修正成一个合法的', async () => {
    const result = await runCli(fixture, [
      'my-app',
      '-t',
      'vanilla',
      '--package-name',
      'My Pkg',
      '--overwrite',
      '--no-immediate',
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('My Pkg')
    // 静默修正的话这里会是一个建好的项目，名字叫 my-pkg
    expect(fixture.tree()).toEqual([])
  })

  /**
   * mri 实测：`--package-name` 后面紧跟另一个 flag 时，值是 `''` 而不是把
   * `--overwrite` 吃掉当值（`_` 仍是 `['my-app']`、`overwrite` 仍是 true）。
   * 所以这里考的是「空串按非法处理」，不是参数解析。
   *
   * ⚠️ `not.toContain('未知参数')` 是必需的：接进去之前这条用例靠「`--package-name`
   * 是未知参数」绿着，跟空串校验毫无关系。少了这句它就是个恒等式。
   */
  it('带了参数没带值时也算非法', async () => {
    const result = await runCli(fixture, [
      'my-app',
      '-t',
      'vanilla',
      '--package-name',
      '--overwrite',
      '--no-immediate',
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).not.toContain('未知参数')
    expect(fixture.exists('my-app/package.json')).toBe(false)
  })

  /**
   * ⚠️ 次序守卫，别当成重复用例。
   *
   * 「参数写错了」必须在**任何破坏性操作之前**判出来。校验一旦排在第 2 步之后，
   * `--overwrite` 会先把目标目录清空，然后才告诉用户 `--package-name` 写错了——
   * 用户为一个打字错误付出了整个目录。上面那条用例（目录不存在）钉不住这一点，
   * 它无论校验排在哪里都绿。
   */
  it('非法包名在清空目录之前就被挡下，不许先删了再报错', async () => {
    fixture.write('busy/keep.txt', '别动我')

    const result = await runCli(fixture, [
      'busy',
      '-t',
      'vanilla',
      '--package-name',
      'My Pkg',
      '--overwrite',
      '--no-immediate',
    ])

    expect(result.exitCode).toBe(1)
    expect(fixture.read('busy/keep.txt')).toBe('别动我')
  })

  it('写成 camelCase 的 --packageName 会被当成未知参数挡下', async () => {
    const result = await runCli(fixture, [
      'my-app',
      '-t',
      'vanilla',
      '--packageName',
      'my-pkg',
      '--overwrite',
      '--no-immediate',
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('--packageName')
  })

  it('--help 里交代了这个参数', async () => {
    const result = await runCli(fixture, ['--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('--package-name')
  })
})
