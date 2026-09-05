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
