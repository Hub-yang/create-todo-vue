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

const { green, yellow, blue } = colors

export const HELP_MESSAGE = `\
用法: @huberyyang/create-todo-vue [参数]... [目录]

快速创建vue模板

参数:
  -h, --help                            查看帮助
  -t, --template                        指定模板
  -i, --immediate                       创建后立即安装依赖
  --overwrite                           是否覆盖创建

可用模板:
${green ('vue                       vue         ')}
${green ('vue-ts                    vue-ts      ')}
${green ('vitesse-base              vitesse-base')}
${green ('vitesse-lite              vitesse-lite')}`

export const DEFAULTE_TARGETDIR = 'vue-project'

export const FRAMEWORKS: Framework[] = [
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
