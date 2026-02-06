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

const { green } = colors

export const HELP_MESSAGE = `\
用法: hubery-create [OPTION]... [DIRECTORY]

创建通用模板

Options:
  -t, --template                        使用指定模板
  -i, --immediate                       安装依赖并执行
  --interactive / --no-interactive      交互模式切换

可用模板:
${green ('vitesse              vitesse')}`

export const DEFAULTE_TARGETDIR = 'vite-project'
export const DEFAULTE_TEMPLATE = 'vitesse-lite'

export const FRAMEWORKS: Framework[] = [
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
