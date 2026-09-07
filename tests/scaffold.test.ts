import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RENAME_FILES } from '../src/constants'
import { scaffoldTemplate } from '../src/scaffold'

/**
 * 副作用层的用例。
 *
 * 之所以能用单测覆盖（以前只有 E2E 能碰），是因为 CTV-15 把 templateDir / root
 * 改成了由入口层注入的参数——这里可以喂临时目录，不依赖仓库里真实的 template-* 。
 */

let tmp = ''
let templateDir = ''
let root = ''

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctv-scaffold-'))
  templateDir = path.join(tmp, 'template')
  root = path.join(tmp, 'out')
  fs.mkdirSync(templateDir, { recursive: true })
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

/** 往模板目录里放一个文件，父目录自动建 */
function putTemplateFile(relativePath: string, content: string) {
  const abs = path.join(templateDir, relativePath)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

/** 最小可用的模板 package.json，多数用例并不关心它 */
function putTemplatePkg(content = '{"name":"template-x","version":"0.0.0"}') {
  putTemplateFile('package.json', content)
}

function run(packageName = 'my-app') {
  scaffoldTemplate({ templateDir, root, packageName, renameFiles: RENAME_FILES })
}

function readOut(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf-8')
}

describe('scaffoldTemplate', () => {
  it('目标目录不存在时会创建', () => {
    putTemplatePkg()
    run()
    expect(fs.existsSync(root)).toBe(true)
  })

  it('多级目标路径也能创建', () => {
    putTemplatePkg()
    root = path.join(tmp, 'a', 'b', 'c')
    run()
    expect(fs.existsSync(path.join(root, 'package.json'))).toBe(true)
  })

  it('目标目录已存在时不报错', () => {
    putTemplatePkg()
    fs.mkdirSync(root, { recursive: true })
    expect(() => run()).not.toThrow()
  })

  it('普通文件按原名拷贝，内容一致', () => {
    putTemplatePkg()
    putTemplateFile('README.md', '# hello\n')
    run()
    expect(readOut('README.md')).toBe('# hello\n')
  })

  it('子目录被递归拷贝', () => {
    putTemplatePkg()
    putTemplateFile('src/nested/deep.txt', 'deep')
    run()
    expect(readOut('src/nested/deep.txt')).toBe('deep')
  })

  // npm 打包会无条件剔除 .gitignore，所以仓库里存成 _gitignore。
  it('_gitignore 落地为 .gitignore，且原名不残留', () => {
    putTemplatePkg()
    putTemplateFile('_gitignore', 'node_modules\n')
    run()
    expect(readOut('.gitignore')).toBe('node_modules\n')
    expect(fs.existsSync(path.join(root, '_gitignore'))).toBe(false)
  })

  it('index.html 的 title 被改写成包名', () => {
    putTemplatePkg()
    putTemplateFile('index.html', '<html><head><title>Vite App</title></head></html>')
    run('cool-app')
    expect(readOut('index.html')).toBe('<html><head><title>cool-app</title></head></html>')
  })

  it('index.html 里 title 以外的内容原样保留', () => {
    putTemplatePkg()
    putTemplateFile('index.html', '<!doctype html>\n<title>x</title>\n<div id="app"></div>\n')
    run('app')
    expect(readOut('index.html')).toBe('<!doctype html>\n<title>app</title>\n<div id="app"></div>\n')
  })

  it('package.json 的 name 被改写成包名', () => {
    putTemplatePkg('{"name":"template-x","version":"1.2.3"}')
    run('renamed')
    expect(JSON.parse(readOut('package.json'))).toEqual({ name: 'renamed', version: '1.2.3' })
  })

  it('写出的 package.json 是 2 空格缩进且以换行结尾', () => {
    putTemplatePkg('{"name":"t","scripts":{"dev":"vite"}}')
    run('app')
    expect(readOut('package.json')).toBe(
      '{\n  "name": "app",\n  "scripts": {\n    "dev": "vite"\n  }\n}\n',
    )
  })

  it('模板目录本身不被改动', () => {
    putTemplatePkg('{"name":"template-x"}')
    putTemplateFile('index.html', '<title>Vite App</title>')
    run('my-app')
    expect(fs.readFileSync(path.join(templateDir, 'package.json'), 'utf-8'))
      .toBe('{"name":"template-x"}')
    expect(fs.readFileSync(path.join(templateDir, 'index.html'), 'utf-8'))
      .toBe('<title>Vite App</title>')
  })

  it('模板里的全部文件都会落地，一个不漏', () => {
    putTemplatePkg()
    putTemplateFile('README.md', 'r')
    putTemplateFile('_gitignore', 'g')
    putTemplateFile('index.html', '<title>t</title>')
    putTemplateFile('src/main.ts', 'm')
    run()
    const listed = fs.readdirSync(root).sort()
    expect(listed).toEqual(['.gitignore', 'README.md', 'index.html', 'package.json', 'src'])
  })
})
