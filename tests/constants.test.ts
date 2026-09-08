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
      'custom-vitesse',
      'custom-vitesse-lite',
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

  // CTV-30：反向钉子。上面那条只保证「注册表里的每个内置模板都有目录」，
  // 管不住反过来的「目录还在、注册表里已经没有它」——而删模板目录这件事
  // 恰好只发生在这个方向上，没有这条断言就一条测试都碰不到它。
  it('仓库里没有 FRAMEWORKS 未声明的孤儿 template-* 目录', () => {
    const orphans = fs
      .readdirSync(repoRoot, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.startsWith('template-'))
      .map(e => e.name.slice('template-'.length))
      .filter(name => !builtinTemplates.includes(name))

    expect(orphans, '这些目录在 FRAMEWORKS 里没有对应的内置模板，应当删除或挂回注册表')
      .toEqual([])
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

  /**
   * CTV-16 / CTV-05：README 的「当前可用模板」是第三份手写清单。
   *
   * 它没法在构建期生成（静态 markdown，生成会引入构建步骤），但可以把**静默漂移
   * 变成红测试**——加了模板不更新 README，这条就红。
   *
   * 这不是恒等式：两边是**不同的源**（面向用户的文档 vs 代码里的注册表），
   * 与 `collectKnownFlags` 对 `HELP_MESSAGE` 那条同理。
   */
  it('rEADME 的「当前可用模板」与 TEMPLATES 一致', () => {
    const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf-8')
    const section = readme.split('#### 🟢 当前可用模板')[1]?.split('###')[0]
    expect(section, 'README 里找不到「当前可用模板」区块，解析规则失灵了').toBeTruthy()

    // 只取行首列表项里反引号包住的模板名，避免把说明文字里的其它代码片段算进来
    const listed = [...section!.matchAll(/^- `([^`]+)`(?: \/ `([^`]+)`)?/gm)]
      .flatMap(m => [m[1], m[2]])
      .filter(Boolean)

    expect([...listed].sort(), 'README 与 TEMPLATES 对不上，加删模板时漏改了 README')
      .toEqual([...TEMPLATES].sort())
  })

  // help 里「可用模板」区块的所有词。**按空白切成词、而不是拿 HELP_MESSAGE 做子串匹配**：
  // 模板名之间存在包含关系（`custom-vitesse` 是 `custom-vitesse-lite` 的子串，`vue` 是
  // `vue-ts` 的子串），子串匹配会让「漏掉短的那个」全绿蒙混过去。
  const listed = stripAnsi(HELP_MESSAGE)
    .split('可用模板:')[1]
    .split(/\s+/)
    .filter(Boolean)

  it('帮助信息里能抓到模板名，切词没有失灵', () => {
    expect(listed.length).toBe(TEMPLATES.length)
  })

  it('帮助信息列出的模板名都在 TEMPLATES 里', () => {
    for (const name of listed) {
      expect(TEMPLATES, `HELP_MESSAGE 列了 ${name}，但 TEMPLATES 里没有`).toContain(name)
    }
  })

  // 覆盖全部 TEMPLATES 而不只是内置模板：`custom-*` 同样是 `-t` 真正接受的合法值
  // （校验就是拿 TEMPLATES 比对），help 不写它们等于对用户瞒着一半的可选项。
  it('帮助信息覆盖了全部模板，含转交上游的 custom-*', () => {
    for (const name of TEMPLATES) {
      expect(listed, `HELP_MESSAGE 漏了 ${name}`).toContain(name)
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
