import type { Fixture } from './helpers/fixture'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertOk, runCli } from './helpers/cli'
import { createFixture } from './helpers/fixture'

/** 非交互创建所需的最小参数，含义见 scaffold.e2e.test.ts 的同名常量 */
const NON_INTERACTIVE = ['--overwrite', '--no-immediate']

/**
 * CTV-19：目标目录是绝对路径时，产物必须落在那个绝对路径上。
 *
 * 修复前的实现是 `path.join(cwd, targetDir)`——把绝对路径当相对路径接在 cwd 后面，
 * 于是在 cwd 底下造出一整棵镜像目录树（`<cwd>/private/tmp/.../my-app`），
 * 用户要的位置一个文件都没有，而 CLI 报告「创建成功」并退 0。
 *
 * 所以这一组必须同时钉住两件事：**产物在对的地方**，以及 **cwd 底下没有多余的东西**。
 * 只断言前者是不够的——镜像树照样可以让前者以别的方式碰巧成立。
 */
describe('绝对路径的目标目录', () => {
  let fixture: Fixture
  let failed = false

  beforeEach(() => {
    fixture = createFixture()
    failed = false
  })

  afterEach((ctx) => {
    failed = ctx.task.result?.state === 'fail'
    fixture.cleanup(failed)
  })

  it('产物落在传入的绝对路径上', async () => {
    const absTarget = path.join(fixture.dir, 'elsewhere', 'my-app')

    const result = await runCli(fixture, [absTarget, '-t', 'vanilla', ...NON_INTERACTIVE])
    assertOk(result, fixture)

    expect(fs.existsSync(path.join(absTarget, 'package.json'))).toBe(true)
    expect(fs.existsSync(path.join(absTarget, 'index.html'))).toBe(true)
  })

  it('不在 cwd 底下造镜像目录树', async () => {
    const absTarget = path.join(fixture.dir, 'elsewhere', 'my-app')

    const result = await runCli(fixture, [absTarget, '-t', 'vanilla', ...NON_INTERACTIVE])
    assertOk(result, fixture)

    // cwd 底下只该多出 elsewhere 这一个目录。镜像树会在这里冒出 var / private 之类的
    // 路径首段，断言成「恰好等于」而不是「不包含 xxx」，这样任何形状的镜像都会被抓到。
    expect(fs.readdirSync(fixture.dir).sort()).toEqual(['elsewhere'])
  })

  it('绝对路径下 package.json 的 name 仍取末段目录名', async () => {
    const absTarget = path.join(fixture.dir, 'elsewhere', 'my-app')

    const result = await runCli(fixture, [absTarget, '-t', 'vanilla', ...NON_INTERACTIVE])
    assertOk(result, fixture)

    const pkg = JSON.parse(fs.readFileSync(path.join(absTarget, 'package.json'), 'utf-8'))
    expect(pkg.name).toBe('my-app')
  })
})

/**
 * CTV-20：目标名恰好撞上一个已存在的**文件**。
 *
 * 修复前 `fs.readdirSync` 直接抛 ENOTDIR，用户看到一段内部栈。现在按 `--overwrite`
 * 的字面语义处理：带标志就删掉那个文件继续，不带标志则进交互菜单（非交互下退非零）。
 */
describe('目标名撞上已存在的文件', () => {
  let fixture: Fixture
  let failed = false

  beforeEach(() => {
    fixture = createFixture()
    failed = false
  })

  afterEach((ctx) => {
    failed = ctx.task.result?.state === 'fail'
    fixture.cleanup(failed)
  })

  it('--overwrite 会删掉那个文件并正常生成项目', async () => {
    fixture.write('taken', '我是文件，不是目录')

    const result = await runCli(fixture, ['taken', '-t', 'vanilla', ...NON_INTERACTIVE])
    assertOk(result, fixture)

    expect(fs.statSync(path.join(fixture.dir, 'taken')).isDirectory()).toBe(true)
    expect(fixture.exists('taken/package.json')).toBe(true)
    expect(fixture.readJson('taken/package.json').name).toBe('taken')
  })

  it('不再抛 ENOTDIR 内部栈', async () => {
    fixture.write('taken', '我是文件，不是目录')

    const result = await runCli(fixture, ['taken', '-t', 'vanilla', '--no-immediate'])

    const output = result.stdout + result.stderr
    expect(output).not.toContain('ENOTDIR')
    expect(output).not.toContain('readdirSync')
  })

  it('没有 --overwrite 时不动那个文件，并以非零码退出', async () => {
    fixture.write('taken', '我是文件，不是目录')

    const result = await runCli(fixture, ['taken', '-t', 'vanilla', '--no-immediate'])

    expect(result.exitCode).not.toBe(0)
    expect(fixture.read('taken')).toBe('我是文件，不是目录')
  })

  /**
   * ⚠️ 上面那条「没有 --overwrite」的用例是**非交互**路径，它证明不了取消逻辑：
   * 那条路径 CTV-31 之后走的是 `ask()` 的 EOF 分支（此前是 clack 的 promise 永不
   * settle），两种机制下都是**没进过菜单**，所以文件没被动、退出码为 1，跟菜单里
   * 写了什么毫无关系（实测：把取消分支整段删掉它照样绿）。
   *
   * 下面两条才真的走进菜单——靠 respondAfterStdout 往管道里喂按键。它们同时也是
   * CTV-31 的**回归钉子**：`ask()` 往 stdin 挂 'end' / 'close' 监听，一旦挂法不对
   * 把字节从 clack 的 readline 手里抢走，这两条会立刻转红。
   */
  const MENU = '请选择如何继续'

  it('交互式选「取消操作」时，文件原封不动并以非零码退出', async () => {
    fixture.write('taken', '我是文件，不是目录')

    const result = await runCli(
      fixture,
      ['taken', '-t', 'vanilla', '--no-immediate'],
      // 菜单默认高亮第一项，直接回车即选中「取消操作」
      { respondAfterStdout: { after: MENU, send: '\r' } },
    )

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain('操作已取消')
    expect(fixture.read('taken')).toBe('我是文件，不是目录')
  })

  it('交互式选「删除该文件并继续」时，文件被替换成项目目录', async () => {
    fixture.write('taken', '我是文件，不是目录')

    const result = await runCli(
      fixture,
      ['taken', '-t', 'vanilla', '--no-immediate'],
      // 下移一项再回车，选中「删除该文件并继续」
      { respondAfterStdout: { after: MENU, send: '\u001B[B\r' } },
    )
    assertOk(result, fixture)

    expect(fs.statSync(path.join(fixture.dir, 'taken')).isDirectory()).toBe(true)
    expect(fixture.exists('taken/package.json')).toBe(true)
  })

  it('文件目标的菜单不提供「忽略」——那个选项在文件上物理不可行', async () => {
    fixture.write('taken', '我是文件，不是目录')

    const result = await runCli(
      fixture,
      ['taken', '-t', 'vanilla', '--no-immediate'],
      { respondAfterStdout: { after: MENU, send: '\r' } },
    )

    expect(result.stdout).toContain('删除该文件并继续')
    expect(result.stdout).not.toContain('忽略文件并继续')
  })
})
