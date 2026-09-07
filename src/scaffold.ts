import fs from 'node:fs'
import path from 'node:path'
import { planTemplateFiles, replaceHtmlTitle, withPackageName } from './plan'
import { copy } from './utils'

/**
 * 副作用层：按纯决策层排好的动作表把模板落到目标目录。
 *
 * 这里**不计算任何路径**——`templateDir` 与 `root` 都由入口层注入。原因见
 * `plan.ts` 顶部那段：路径一旦在子模块里靠 `import.meta.url` 现算，开发态与
 * 产物态会解析到不同目录，且没有编译期报错。注入的另一个好处是这层能被单测
 * 喂临时目录，不必依赖仓库里真实的 `template-*`。
 */
export interface ScaffoldOptions {
  /** 模板源目录（绝对路径） */
  templateDir: string
  /** 目标项目根目录（绝对路径） */
  root: string
  /** 写进 package.json 的 name，同时用作 index.html 的 title */
  packageName: string
  /** 落地时的文件名映射表 */
  renameFiles: Record<string, string | undefined>
}

export function scaffoldTemplate({
  templateDir,
  root,
  packageName,
  renameFiles,
}: ScaffoldOptions): void {
  fs.mkdirSync(root, { recursive: true })

  const actions = planTemplateFiles(fs.readdirSync(templateDir), renameFiles)

  for (const action of actions) {
    const from = path.join(templateDir, action.from)
    const to = path.join(root, action.to)

    switch (action.kind) {
      case 'index-html':
        fs.writeFileSync(to, replaceHtmlTitle(fs.readFileSync(from, 'utf-8'), packageName))
        break
      case 'package-json':
        fs.writeFileSync(to, withPackageName(fs.readFileSync(from, 'utf-8'), packageName))
        break
      case 'copy':
        copy(from, to)
        break
    }
  }
}
