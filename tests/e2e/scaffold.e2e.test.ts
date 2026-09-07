import type { Fixture } from './helpers/fixture'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FRAMEWORKS } from '../../src/constants'
import { assertOk, runCli } from './helpers/cli'
import { createFixture } from './helpers/fixture'

/**
 * 需要仓库内置模板目录支撑的模板名（排除转交给上游脚手架的 customCommand 变体，
 * 那些会真的去联网跑 create-vue / nuxi / vike，不适合放进 E2E）。
 */
const BUILTIN_TEMPLATES = FRAMEWORKS
  .flatMap(f => f.variants?.length ? f.variants : [f])
  .filter(v => !('customCommand' in v && v.customCommand))
  .map(v => v.name)

/**
 * 非交互创建所需的最小参数。
 *
 * `--no-immediate` 是关键：不给它的话，CLI 会停在「是否立即安装依赖」的确认框上；
 * 而 `-i` 会真的联网跑 npm install。mri 把 `--no-immediate` 解析成 immediate: false，
 * 于是走「打印后续步骤」的分支，既不提问也不联网。
 */
const NON_INTERACTIVE = ['--overwrite', '--no-immediate']

describe('脚手架生成', () => {
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

  it('生成 vue-ts 项目，产出完整的文件树', async () => {
    const result = await runCli(fixture, ['my-app', '-t', 'vue-ts', ...NON_INTERACTIVE])
    assertOk(result, fixture)

    expect(fixture.tree('my-app')).toEqual([
      '.gitignore',
      '.vscode/',
      '.vscode/extensions.json',
      'README.md',
      'index.html',
      'package.json',
      'public/',
      'public/favicon.svg',
      'public/icons.svg',
      'src/',
      'src/App.vue',
      'src/assets/',
      'src/assets/hero.png',
      'src/assets/vite.svg',
      'src/assets/vue.svg',
      'src/components/',
      'src/components/HelloWorld.vue',
      'src/main.ts',
      'src/style.css',
      'tsconfig.app.json',
      'tsconfig.json',
      'tsconfig.node.json',
      'vite.config.ts',
    ])
  })

  it('把 package.json 的 name 改写成目录名', async () => {
    const result = await runCli(fixture, ['my-app', '-t', 'vue-ts', ...NON_INTERACTIVE])
    assertOk(result, fixture)

    const pkg = fixture.readJson('my-app/package.json')
    expect(pkg.name).toBe('my-app')
    // 模板自带的名字必须被顶掉，而不是并存
    expect(pkg.name).not.toBe('vite-vue-typescript-starter')
    // 其余字段原样保留
    expect(pkg.dependencies).toHaveProperty('vue')
  })

  it('把 index.html 的 title 改写成项目名', async () => {
    const result = await runCli(fixture, ['my-app', '-t', 'vue-ts', ...NON_INTERACTIVE])
    assertOk(result, fixture)

    expect(fixture.read('my-app/index.html')).toContain('<title>my-app</title>')
  })

  it('_gitignore 落地为 .gitignore，且原名不残留', async () => {
    const result = await runCli(fixture, ['my-app', '-t', 'vue-ts', ...NON_INTERACTIVE])
    assertOk(result, fixture)

    // npm 打包会剔除 .gitignore，仓库里因此存成 _gitignore 再由 RENAME_FILES 改回来。
    // 这条断言同时钉住「改回来了」和「没把 _gitignore 也一起拷过去」。
    expect(fixture.exists('my-app/.gitignore')).toBe(true)
    expect(fixture.exists('my-app/_gitignore')).toBe(false)
    expect(fixture.read('my-app/.gitignore')).toContain('node_modules')
  })

  it.each(BUILTIN_TEMPLATES)('模板 %s 能生成出可用的项目', async (template) => {
    const result = await runCli(fixture, ['proj', '-t', template, ...NON_INTERACTIVE])
    assertOk(result, fixture)

    expect(fixture.exists('proj/package.json')).toBe(true)
    expect(fixture.exists('proj/index.html')).toBe(true)
    expect(fixture.exists('proj/.gitignore')).toBe(true)
    expect(fixture.readJson('proj/package.json').name).toBe('proj')
  })

  // CTV-01 的回归钉子：vitesse 模板曾因为 catalog: 没有定义源而 100% 装不上。
  // 这条保证任何被列出来的模板都不会带着 catalog: 协议发出去。
  it.each(BUILTIN_TEMPLATES)('模板 %s 生成的 package.json 不含 catalog: 协议', async (template) => {
    const result = await runCli(fixture, ['proj', '-t', template, ...NON_INTERACTIVE])
    assertOk(result, fixture)

    expect(fixture.read('proj/package.json')).not.toContain('"catalog:')
  })

  it('目标目录不存在时会创建，包括多级路径', async () => {
    const result = await runCli(fixture, ['nested/deep/app', '-t', 'vanilla', ...NON_INTERACTIVE])
    assertOk(result, fixture)

    expect(fixture.exists('nested/deep/app/package.json')).toBe(true)
    // 包名取的是路径最后一段，不是整条路径
    expect(fixture.readJson('nested/deep/app/package.json').name).toBe('app')
  })

  it('--overwrite 会清空已有内容再生成', async () => {
    fixture.write('my-app/stale.txt', '旧文件')
    fixture.write('my-app/src/old.js', '旧源码')

    const result = await runCli(fixture, ['my-app', '-t', 'vue-ts', ...NON_INTERACTIVE])
    assertOk(result, fixture)

    expect(fixture.exists('my-app/stale.txt')).toBe(false)
    expect(fixture.exists('my-app/src/old.js')).toBe(false)
    expect(fixture.exists('my-app/package.json')).toBe(true)
  })

  it('--overwrite 保留目标目录里的 .git', async () => {
    fixture.write('my-app/.git/HEAD', 'ref: refs/heads/main')
    fixture.write('my-app/stale.txt', '旧文件')

    const result = await runCli(fixture, ['my-app', '-t', 'vue-ts', ...NON_INTERACTIVE])
    assertOk(result, fixture)

    expect(fixture.read('my-app/.git/HEAD')).toBe('ref: refs/heads/main')
    expect(fixture.exists('my-app/stale.txt')).toBe(false)
  })

  it('收尾提示按当前包管理器给出安装命令', async () => {
    const result = await runCli(
      fixture,
      ['my-app', '-t', 'vue-ts', ...NON_INTERACTIVE],
      { packageManager: 'pnpm' },
    )
    assertOk(result, fixture)

    expect(result.stdout).toContain('cd my-app')
    // 必须整行匹配：'pnpm install' 本身就含有子串 'npm install'，
    // 用 toContain 断言「不含 npm install」永远会假失败
    expect(result.stdout).toMatch(/^\s*pnpm install\s*$/m)
    expect(result.stdout).not.toMatch(/^\s*npm install\s*$/m)
  })

  it('yarn 的安装命令不带 install 子命令', async () => {
    const result = await runCli(
      fixture,
      ['my-app', '-t', 'vue-ts', ...NON_INTERACTIVE],
      { packageManager: 'yarn/1.22.22' },
    )
    assertOk(result, fixture)

    expect(result.stdout).toMatch(/\n\s*yarn\s*$/m)
    expect(result.stdout).not.toContain('yarn install')
  })

  it('生成的项目里没有 node_modules——非交互路径绝不联网装依赖', async () => {
    const result = await runCli(fixture, ['my-app', '-t', 'vue-ts', ...NON_INTERACTIVE])
    assertOk(result, fixture)

    expect(fixture.exists('my-app/node_modules')).toBe(false)
  })

  /**
   * CTV-21：`-i` 分支装完依赖后也要告诉用户下一步。
   *
   * ⚠️ 这里的「包管理器」是 `/usr/bin/true`——一个真实存在、忽略参数、立刻退 0 的
   * 二进制。`npm_config_user_agent` 决定 `pkgFromUserAgent()` 认出什么，于是
   * `install()` 会真的 spawn 一次 `true install`，秒退且**不联网、不装任何东西**，
   * 从而让 `-i` 之后那段收尾代码被真正执行到。
   *
   * 不这么做的话这条分支只能靠手工实跑：真传 `-i` 会去联网跑 npm install，
   * 而本仓库的铁律是任何 E2E 用例都不该触发真实安装。
   *
   * 注意它覆盖的是**接线与文案**，不是「安装真的成功了」——后者不属于 E2E 的范围。
   */
  it('装完依赖后给出的是启动命令，不是再装一遍', async () => {
    const result = await runCli(
      fixture,
      ['my-app', '-t', 'vanilla', '--overwrite', '-i'],
      { packageManager: 'true' },
    )
    assertOk(result, fixture)

    expect(result.stdout).toContain('依赖安装完成，请执行：')
    expect(result.stdout).toContain('cd my-app')
    // clack 的 log.* 给续行加了 '│ ' 装订线，行锚点要放它过去
    expect(result.stdout).toMatch(/^[│\s]*true run dev\s*$/m)
  })

  it('装完依赖后不再打印安装命令——那是没装时才该给的', async () => {
    const result = await runCli(
      fixture,
      ['my-app', '-t', 'vanilla', '--overwrite', '-i'],
      { packageManager: 'true' },
    )
    assertOk(result, fixture)

    expect(result.stdout).not.toContain('创建完成，请执行：')
    expect(result.stdout).not.toMatch(/^[│\s]*true install\s*$/m)
  })

  it('模板目录本身不会被改动', async () => {
    const templateDir = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '../../template-vue-ts',
    )
    const before = fs.readFileSync(path.join(templateDir, 'package.json'), 'utf-8')

    const result = await runCli(fixture, ['my-app', '-t', 'vue-ts', ...NON_INTERACTIVE])
    assertOk(result, fixture)

    // 改写 name 和 title 必须只作用于产物，源模板要原封不动
    expect(fs.readFileSync(path.join(templateDir, 'package.json'), 'utf-8')).toBe(before)
  })
})
