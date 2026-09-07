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
