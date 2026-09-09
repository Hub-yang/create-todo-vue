import colors from 'picocolors'
import { renderTemplateList } from '../help'

type ColorFunc = (st: string | number) => string

export interface FrameworkVariant {
  name: string
  display: string
  link?: `https://${string}`
  color: ColorFunc
  customCommand?: string
}
interface Framework {
  name: string
  display: string
  color: ColorFunc
  variants?: FrameworkVariant[]
}

const { green, yellow, blue, cyan, redBright, greenBright } = colors

export const DEFAULT_TARGET_DIR = 'vue-project'

/**
 * mri 的解析配置。
 *
 * 提成常量是为了让「已知参数清单」由它**派生**（见 `plan.ts` 的 `collectKnownFlags`），
 * 而不是另抄一份名单。未知参数校验一旦用手抄名单，加一个新 flag 就会被自己的校验拒掉，
 * 而这个仓库已经因为「同一份清单手写多遍」栽过一次（CTV-05 的模板清单三处漂移）。
 *
 * 加删参数只改这里，`HELP_MESSAGE` 里对应的一行也要跟着改——
 * `tests/constants.test.ts` 有断言盯着两者不许脱节。
 */
export const ARGV_OPTIONS = {
  boolean: ['help', 'version', 'overwrite', 'immediate'],
  alias: { h: 'help', v: 'version', t: 'template', i: 'immediate' },
  string: ['template', 'package-name'],
}

export const FRAMEWORKS: Framework[] = [
  {
    name: 'vanilla',
    display: 'Vanilla',
    color: yellow,
    variants: [
      {
        name: 'vanilla-ts',
        display: 'TypeScript',
        color: blue,
      },
      {
        name: 'vanilla',
        display: 'JavaScript',
        color: yellow,
      },
    ],
  },
  {
    name: 'vue',
    display: 'Vue',
    color: green,
    variants: [
      {
        name: 'vue-ts',
        display: 'TypeScript',
        color: blue,
      },
      {
        name: 'vue',
        display: 'JavaScript',
        color: yellow,
      },
      // CTV-41：Hubery 自己维护的 vue3 开发模板（上游 Hub-yang/my-vue-dev-template）。
      // 比 vue-ts 重一档：预装 unocss / vueuse / vue-router 自动路由 / element-plus 图标 /
      // 自动导入 / eslint + husky + commitlint 一整套工具链。
      // 上游更新后本目录不会自动跟上，需要手动同步。
      {
        name: 'vue-dev',
        display: 'TypeScript + 工具链',
        color: cyan,
      },
      {
        name: 'custom-create-vue',
        display: 'Official Vue Starter ↗',
        color: green,
        customCommand: 'npm create vue@latest TARGET_DIR',
      },
      {
        name: 'custom-nuxt',
        display: 'Nuxt ↗',
        link: 'https://nuxt.com',
        color: greenBright,
        customCommand: 'npm exec nuxi init TARGET_DIR',
      },
      {
        name: 'custom-vike-vue',
        display: 'Vike ↗',
        link: 'https://vike.dev',
        color: greenBright,
        customCommand: 'npm create -- vike@latest --vue TARGET_DIR',
      },
      // CTV-30：vitesse 曾经是仓库内置的两份副本，因为用了 pnpm 的 catalog: 协议
      // 却没有对应的 pnpm-workspace.yaml 而 100% 装不上，v1.1.0 下架。
      // 现在改为转交上游，仓库里不再留副本。
      // 注意仓库地址：上游已从 antfu/ 迁到 antfu-collective/，旧地址靠 GitHub 重定向撑着。
      {
        name: 'custom-vitesse',
        display: 'Vitesse ↗',
        link: 'https://github.com/antfu-collective/vitesse',
        color: greenBright,
        customCommand: 'npm exec degit antfu-collective/vitesse TARGET_DIR',
      },
      {
        name: 'custom-vitesse-lite',
        display: 'Vitesse Lite ↗',
        link: 'https://github.com/antfu-collective/vitesse-lite',
        color: greenBright,
        customCommand: 'npm exec degit antfu-collective/vitesse-lite TARGET_DIR',
      },
    ],
  },
  {
    name: 'lit',
    display: 'Lit',
    color: redBright,
    variants: [
      {
        name: 'lit-ts',
        display: 'TypeScript',
        color: blue,
      },
      {
        name: 'lit',
        display: 'JavaScript',
        color: yellow,
      },
    ],
  },
]

/**
 * 帮助信息。
 *
 * 「可用模板」那一块**由 `FRAMEWORKS` 派生**（CTV-16），不再手写——加删模板时
 * 它自动跟上，CTV-05 那类漂移在结构上不可能再发生。
 *
 * 「参数」那一块仍是手写的，那属于另一件事（参数元数据外置），
 * 且已有 `ARGV_OPTIONS ↔ HELP_MESSAGE` 的双向断言盯着（见 tests/constants.test.ts）。
 */
export const HELP_MESSAGE = `\
用法: @huberyyang/create-todo-vue [参数]... [目录]

快速创建vue模板

参数:
  -h, --help                            查看帮助
  -v, --version                         查看版本号
  -t, --template                        指定模板
  -i, --immediate                       创建后立即安装依赖
  --overwrite                           是否覆盖创建
  --package-name                        指定 package.json 的 name

可用模板:
${renderTemplateList(FRAMEWORKS)}`

export const TEMPLATES = FRAMEWORKS.flatMap((f) => {
  if (f.variants?.length)
    return f.variants.map(v => v.name)
  else
    return f.name
})

export const RENAME_FILES: Record<string, string | undefined> = {
  _gitignore: '.gitignore',
}
