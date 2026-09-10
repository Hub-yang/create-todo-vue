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

/** 递归列出目录下的全部文件（绝对路径），给按内容断言的用例用 */
function collectFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? collectFiles(full) : [full]
  })
}

describe('模板注册表', () => {
  it('注册表 TEMPLATES 恰好是 FRAMEWORKS 派生出的全部变体名', () => {
    expect(TEMPLATES).toEqual([
      'vanilla-ts',
      'vanilla',
      'vue-ts',
      'vue',
      'vue-dev',
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

  // CTV-25：模板 README 一律收敛成「模板名占位」。此前只有 vue / vue-ts 两个模板
  // 带 README，而且是 Vite 官方模板的英文原文（讲的是上游模板的事，跟用户手上这个
  // 项目没关系），另外 4 个模板干脆一份都没有。
  //
  // 期望值从模板名拼出来不构成恒等式：被断言的是 README 文件的内容，期望值来自
  // 目录名，两者是不同的源——改任一份 README 的正文都能让这条红。
  it('每个内置模板都带一份占位 README，内容就是模板名', () => {
    for (const name of builtinTemplates) {
      const readme = path.join(repoRoot, `template-${name}`, 'README.md')
      expect(fs.existsSync(readme), `template-${name} 缺少 README.md`).toBe(true)
      expect(fs.readFileSync(readme, 'utf-8'), `template-${name}/README.md 的内容不是占位模板名`)
        .toBe(`# ${name}\n`)
    }
  })

  /**
   * CTV-41：模板从别处拷进来时必须剥掉上游的身份信息。
   *
   * `template-vue-dev` 来自 `Hub-yang/my-vue-dev-template`，上游的 package.json 带着
   * author / homepage / repository / bugs 四个字段。这些字段是**机器读的**——用户拿模板
   * 建了项目再 `npm publish`，npm 页面上的「Repository」和「Report issues」会指回上游，
   * 别人提的 issue 会落到错的仓库去。页面上可见的署名链接（模板 footer 里那个 GitHub 图标）
   * 是另一回事，用户想删随手就删，不在这条的管辖范围内。
   *
   * 禁止字段清单是硬编码的，不从被测数据派生：被测的是模板 package.json 的内容，
   * 期望来自「我们的规矩」，两边是不同的源。往任一模板加个 author 字段就能让它红。
   */
  it('内置模板的 package.json 不带上游作者的身份字段', () => {
    const forbidden = ['author', 'homepage', 'repository', 'bugs', 'funding', 'maintainers']
    for (const name of builtinTemplates) {
      const pkg = JSON.parse(fs.readFileSync(
        path.join(repoRoot, `template-${name}`, 'package.json'),
        'utf-8',
      ))
      for (const field of forbidden) {
        expect(pkg, `template-${name}/package.json 带了 ${field}，会把用户的项目指回上游`)
          .not
          .toHaveProperty(field)
      }
    }
  })

  /**
   * CTV-41：模板不该替用户锁死包管理器。
   *
   * 这个 CLI 支持 5 种包管理器（`pkgFromUserAgent` 认出来之后连安装命令都会跟着变），
   * 模板里留一个 `packageManager: "pnpm@x.y.z"` 等于把用 npm/yarn/bun 的用户按回 pnpm；
   * 而且 pnpm 11 默认开启 manage-package-manager-versions，会真的去 registry 拉那个版本。
   */
  it('内置模板的 package.json 不锁 packageManager', () => {
    for (const name of builtinTemplates) {
      const pkg = JSON.parse(fs.readFileSync(
        path.join(repoRoot, `template-${name}`, 'package.json'),
        'utf-8',
      ))
      expect(pkg, `template-${name} 锁了 packageManager，会挡掉用其它包管理器的用户`)
        .not
        .toHaveProperty('packageManager')
    }
  })

  /**
   * CTV-41：template-vue-dev 必须带一份 pnpm-workspace.yaml 放行 @parcel/watcher 的构建脚本。
   *
   * 2026-09-09 实测：不带这个文件时，在生成出来的项目里跑 `pnpm install` 会以**退出码 1**
   * 结束，报 `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: @parcel/watcher@2.6.0`
   * （pnpm 10 只是警告，pnpm 11 直接失败）。而 CLI 的 `-i` 会把安装的退出码原样透传（CTV-39），
   * 所以用 pnpm 的用户一旦选了「立即安装依赖」，看到的就是创建失败。
   *
   * 刻意只放行这一个包，也刻意不抄上游那份文件里的 minimumReleaseAgeExclude /
   * trustPolicyExclude——那些绑着具体版本号（如 `@types/node@26.3.0`），拷进模板当天就开始过期。
   *
   * 这条钉的是「文件别被误删或被后来的同步覆盖掉」。真实的 `pnpm install` 不进测试套件
   * （要联网、慢），与仓库既有边界一致。
   */
  it('template-vue-dev 带着放行 @parcel/watcher 的 pnpm-workspace.yaml', () => {
    const yaml = path.join(repoRoot, 'template-vue-dev', 'pnpm-workspace.yaml')
    expect(fs.existsSync(yaml), 'template-vue-dev 缺少 pnpm-workspace.yaml，pnpm 11 装依赖会退 1').toBe(true)

    const content = fs.readFileSync(yaml, 'utf-8')
    expect(content, 'pnpm-workspace.yaml 里没有 allowBuilds 映射').toMatch(/^allowBuilds:/m)
    expect(content, '没放行 @parcel/watcher，pnpm 11 会报 ERR_PNPM_IGNORED_BUILDS')
      .toMatch(/^\s+'@parcel\/watcher':/m)
    // 绑死具体版本号的两项不该被抄进来，它们拷进来当天就开始过期。
    // 必须是**行首精确**匹配而不是子串：`minimumReleaseAgeExcludePrune` 是另一个设置
    // （布尔值，eslint-plugin-pnpm 强制要求，见下面那条用例），子串匹配会把它一起误禁掉。
    expect(content, 'minimumReleaseAgeExclude 绑着具体版本号，不该抄进模板')
      .not
      .toMatch(/^minimumReleaseAgeExclude:/m)
    expect(content, 'trustPolicyExclude 绑着具体版本号，不该抄进模板')
      .not
      .toMatch(/^trustPolicyExclude:/m)
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
   * CTV-42：pnpm 11 起，依赖带 build script 却没被显式放行时 `pnpm install` 直接退出码 1
   * （pnpm 10 只是警告）。vite 7 依赖 `esbuild`（`postinstall: node install.js`），于是
   * 六个内置模板对 pnpm 用户全都装不上，连带 `build` / `dev` 一起挂（pnpm 跑 script 前的
   * 依赖状态检查会重跑 install）。而 CTV-39 让 `-i` 原样透传退出码，用户看到的就是
   * 「└ 依赖安装失败」。vite 8 改用 rolldown，依赖树里连 esbuild 都不存在。
   *
   * 这条是那个不变量的**静态代理**：真正要保证的是「模板不引入未放行的 build script」，
   * 那件事只有真装一次才证得了（2026-09-10 已在沙箱实测 6/6 退 0、esbuild 包数归零），
   * 这里钉住的是能静态查到的那个因。期望值 8 硬编码，不从模板数据派生——
   * 派生过来两边同源，断言就退化成恒等式。
   */
  it('内置模板的 vite 主版本不低于 8（vite 7 的 esbuild 会让 pnpm 装依赖退 1）', () => {
    for (const name of builtinTemplates) {
      const pkg = JSON.parse(fs.readFileSync(
        path.join(repoRoot, `template-${name}`, 'package.json'),
        'utf-8',
      ))
      const range: string | undefined = pkg.devDependencies?.vite ?? pkg.dependencies?.vite
      expect(range, `template-${name} 没有声明 vite`).toBeTruthy()

      const major = Number.parseInt(range!.replace(/^\D*/, ''), 10)
      expect(
        major,
        `template-${name} 声明的是 vite ${range}，vite 7 会把带 postinstall 的 esbuild 带进依赖树`,
      ).toBeGreaterThanOrEqual(8)
    }
  })

  /**
   * CTV-43：`<script setup>` 不带 `lang="ts"` 时 vue-tsc 认为这个 SFC 没有类型信息，
   * 于是 import 它的 `main.ts` 报 `TS7016 implicitly has an 'any' type`，
   * `vue-tsc -b && vite build` 直接失败。**与包管理器无关**，npm 用户一样构建不了。
   *
   * 只钉 vue-ts：`template-vue` 是 JS 模板，不带 lang 才是对的；`template-vue-dev` 的
   * 构建是 `vue-tsc --noEmit` 且实测退 0，不把它一起圈进来。
   */
  it('template-vue-ts 的每个 SFC 都标了 lang="ts"', () => {
    const srcDir = path.join(repoRoot, 'template-vue-ts', 'src')
    const vueFiles = collectFiles(srcDir).filter(f => f.endsWith('.vue'))

    expect(vueFiles.length, 'template-vue-ts/src 下一个 .vue 都没找到，这条断言已失去意义')
      .toBeGreaterThan(0)

    for (const file of vueFiles) {
      const rel = path.relative(repoRoot, file)
      const scriptTag = fs.readFileSync(file, 'utf-8').match(/<script[^>]*>/)?.[0]
      expect(scriptTag, `${rel} 没有 <script> 块`).toBeTruthy()
      expect(scriptTag, `${rel} 的 script 块缺 lang="ts"，vue-tsc 会对它报 TS7016`)
        .toMatch(/lang="ts"/)
    }
  })

  /**
   * CTV-44：`template-vue-dev` 是唯一自带 eslint 的模板，它的 `@antfu/eslint-config`
   * 会带上 `eslint-plugin-pnpm`，那个插件强制要求 `minimumReleaseAgeExcludePrune` /
   * `shellEmulator` / `trustPolicy` 三条设置，缺任何一条 `pnpm lint` 就红。
   *
   * **但那三条不能照单全收**：`trustPolicy: no-downgrade` 会让这个模板的
   * `pnpm install` 直接退出码 1——2026-09-10 实测 `ERR_PNPM_TRUST_DOWNGRADE`，
   * `semver@6.3.1` 经 `vite-plugin-vue-devtools` → `vite-plugin-vue-inspector`
   * → `@babel/core` 传递进来。**让 lint 变绿的代价是让装依赖变红**，而装不上依赖
   * 比 lint 报错严重得多（CTV-39 让 `-i` 透传退出码，用户直接看到创建失败）。
   *
   * 所以走的是另一条路：模板的 `eslint.config.ts` 关掉这条规则。两条断言配套——
   * 一条钉住「不许再把 trustPolicy 加回来」，一条钉住「关规则那段不许被删」，
   * 少了任何一条，`pnpm install` 与 `pnpm lint` 之中就会有一个退 1。
   */
  it('template-vue-dev 的 pnpm-workspace.yaml 不设 trustPolicy（会让 pnpm install 退 1）', () => {
    const content = fs.readFileSync(
      path.join(repoRoot, 'template-vue-dev', 'pnpm-workspace.yaml'),
      'utf-8',
    )
    expect(content, 'trustPolicy: no-downgrade 会让这个模板 ERR_PNPM_TRUST_DOWNGRADE 退 1')
      .not
      .toMatch(/^trustPolicy:/m)
    // 放行 @parcel/watcher 仍然是必需的，别在删 trustPolicy 时把它一起删了
    expect(content, '没放行 @parcel/watcher，pnpm 11 会报 ERR_PNPM_IGNORED_BUILDS')
      .toMatch(/^\s+'@parcel\/watcher':/m)
  })

  it('template-vue-dev 的 eslint 配置关掉了 pnpm/yaml-enforce-settings', () => {
    const content = fs.readFileSync(
      path.join(repoRoot, 'template-vue-dev', 'eslint.config.ts'),
      'utf-8',
    )
    expect(content, '没关掉这条规则，生成的项目跑 pnpm lint 会因缺三条 pnpm 设置而退 1')
      .toMatch(/'pnpm\/yaml-enforce-settings':\s*'off'/)
  })

  /**
   * CTV-44：同一个模板的 `package.json` 还要过 `jsonc/sort-keys`。antfu 那套要求的次序是
   * `name` → `type` → `version` → `private`，而 Vite 官方模板的原始顺序是
   * `name` → `private` → `version` → `type`，照拷进来就是两个 lint 错误。
   *
   * 只钉 vue-dev：其余六个模板没有 eslint 配置，key 顺序对它们没有约束力。
   */
  it('template-vue-dev 的 package.json key 顺序满足 jsonc/sort-keys', () => {
    const keys: string[] = Object.keys(JSON.parse(fs.readFileSync(
      path.join(repoRoot, 'template-vue-dev', 'package.json'),
      'utf-8',
    )))
    const at = (k: string) => keys.indexOf(k)

    expect(at('name'), 'package.json 缺 name').toBe(0)
    expect(at('type'), 'type 应排在 version 之前').toBeLessThan(at('version'))
    expect(at('version'), 'version 应排在 private 之前').toBeLessThan(at('private'))
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
