import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ARGV_OPTIONS, FRAMEWORKS, HELP_MESSAGE, TEMPLATES } from '../src/constants'
import { collectKnownFlags } from '../src/plan'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** picocolors 在 TTY 下会真的注入 ANSI 转义码，断言前统一剥掉 */
// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\u001B\[\d+m/g, '')

/** 不带 customCommand 的变体，即需要仓库内置模板目录支撑的那些 */
const builtinTemplates = FRAMEWORKS
  .flatMap(f => f.variants?.length ? f.variants : [f])
  .filter(v => !('customCommand' in v && v.customCommand))
  .map(v => v.name)

describe('模板注册表', () => {
  it('注册表 TEMPLATES 恰好是 FRAMEWORKS 派生出的全部变体名', () => {
    expect(TEMPLATES).toEqual([
      'vanilla-ts',
      'vanilla',
      'vue-ts',
      'vue',
      'custom-create-vue',
      'custom-nuxt',
      'custom-vike-vue',
      'lit-ts',
      'lit',
    ])
  })

  it('每个内置模板都有真实存在的 template-* 目录', () => {
    for (const name of builtinTemplates) {
      const dir = path.join(repoRoot, `template-${name}`)
      expect(fs.existsSync(dir), `缺少目录 template-${name}`).toBe(true)
    }
  })

  it('每个内置模板目录都带 package.json', () => {
    for (const name of builtinTemplates) {
      const pkg = path.join(repoRoot, `template-${name}`, 'package.json')
      expect(fs.existsSync(pkg), `template-${name} 缺少 package.json`).toBe(true)
    }
  })

  // CTV-01：catalog: 是 pnpm workspace 专有协议，需要 pnpm-workspace.yaml 提供定义源。
  // 模板目录里没有那个文件，任何 catalog: 引用都会让生成的项目装不上依赖。
  it('内置模板的 package.json 不含 catalog: 协议', () => {
    for (const name of builtinTemplates) {
      const content = fs.readFileSync(
        path.join(repoRoot, `template-${name}`, 'package.json'),
        'utf-8',
      )
      expect(content, `template-${name} 含 catalog: 引用但无 pnpm-workspace.yaml`)
        .not
        .toMatch(/"catalog:/)
    }
  })

  it('帮助信息列出的模板名都在 TEMPLATES 里', () => {
    // 取 help 里「可用模板」区块的所有词，逐个比对
    const listed = stripAnsi(HELP_MESSAGE)
      .split('可用模板:')[1]
      .split(/\s+/)
      .filter(Boolean)
    for (const name of listed) {
      expect(TEMPLATES, `HELP_MESSAGE 列了 ${name}，但 TEMPLATES 里没有`).toContain(name)
    }
  })

  it('帮助信息覆盖了全部内置模板', () => {
    for (const name of builtinTemplates) {
      expect(stripAnsi(HELP_MESSAGE), `HELP_MESSAGE 漏了 ${name}`).toContain(name)
    }
  })
})

/**
 * CTV-17 引入未知参数校验之后，`HELP_MESSAGE` 与 `ARGV_OPTIONS` 脱节的后果变严重了：
 * 帮助里写了但配置里没有 → CLI 会拒绝自己文档宣传的参数；配置里有但帮助里没写 →
 * 用户无从知道它存在。两个方向都钉住。
 */
describe('参数清单与帮助信息', () => {
  /** 从 help 的「参数」区块里抓出所有 -x / --xxx，去掉前导横线 */
  const documented = [...new Set(
    stripAnsi(HELP_MESSAGE)
      .split('参数:')[1]
      .split('可用模板:')[0]
      .match(/--?[a-z][\w-]*/gi) ?? [],
  )].map(flag => flag.replace(/^--?/, ''))

  const known = collectKnownFlags(ARGV_OPTIONS)

  it('帮助里能抓到参数，正则没有失灵', () => {
    expect(documented.length).toBeGreaterThanOrEqual(5)
  })

  it('帮助里写的每个参数都是 CLI 真正接受的', () => {
    for (const flag of documented) {
      expect(known, `HELP_MESSAGE 写了 --${flag}，但 ARGV_OPTIONS 没声明——CLI 会拒绝它`)
        .toContain(flag)
    }
  })

  it('cLI 接受的每个参数在帮助里都有交代', () => {
    for (const flag of known) {
      expect(documented, `ARGV_OPTIONS 声明了 ${flag}，但 HELP_MESSAGE 没写`)
        .toContain(flag)
    }
  })
})
