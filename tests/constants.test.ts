import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FRAMEWORKS, HELP_MESSAGE, TEMPLATES } from '../src/constants'

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
