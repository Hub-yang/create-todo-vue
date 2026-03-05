import colors from 'picocolors'

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

const { green, yellow, blue, redBright, greenBright } = colors

export const HELP_MESSAGE = `\
用法: @huberyyang/create-todo-vue [参数]... [目录]

快速创建vue模板

参数:
  -h, --help                            查看帮助
  -t, --template                        指定模板
  -i, --immediate                       创建后立即安装依赖
  --overwrite                           是否覆盖创建

可用模板:
${yellow('vanilla-ts                vanilla     ')}
${green('vue-ts                     vue         ')}
${green ('vitesse-lite              vitesse-base')}
${redBright('lit-ts                 lit         ')}`

export const DEFAULTE_TARGETDIR = 'vue-project'

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
    ],
  },
  {
    name: 'vitesse',
    display: 'vitesse',
    color: green,
    variants: [
      {
        name: 'vitesse-base',
        display: 'vitesse-base',
        color: green,
      },
      {
        name: 'vitesse-lite',
        display: 'vitesse-lite',
        color: green,
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

export const TEMPLATES = FRAMEWORKS.flatMap((f) => {
  if (f.variants?.length)
    return f.variants.map(v => v.name)
  else
    return f.name
})

export const RENAME_FILES: Record<string, string | undefined> = {
  _gitignore: '.gitignore',
}
