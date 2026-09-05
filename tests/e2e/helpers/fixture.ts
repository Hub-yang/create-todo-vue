import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

/** 失败的 fixture 默认保留并打印路径；置 E2E_KEEP=1 则一律保留 */
const KEEP_ALWAYS = process.env.E2E_KEEP === '1'

export interface Fixture {
  /** CLI 的工作目录（脚手架会在它下面创建项目目录） */
  dir: string
  /** 相对 dir 的文件清单，已排序；目录带尾部 "/" */
  tree: (sub?: string) => string[]
  /** 读取 dir 下的文本文件 */
  read: (relativePath: string) => string
  /** 读取并解析 dir 下的 JSON 文件 */
  readJson: (relativePath: string) => any
  exists: (relativePath: string) => boolean
  /** 在 dir 下写一个文件，父目录自动创建 */
  write: (relativePath: string, content: string) => void
  cleanup: (failed: boolean) => void
}

export function createFixture(): Fixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctv-e2e-'))

  const abs = (p: string) => path.join(dir, p)

  function walk(root: string, prefix = ''): string[] {
    const out: string[] = []
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        out.push(`${rel}/`)
        out.push(...walk(path.join(root, entry.name), rel))
      }
      else {
        out.push(rel)
      }
    }
    return out.sort()
  }

  return {
    dir,
    tree: (sub?: string) => {
      const root = sub ? abs(sub) : dir
      return fs.existsSync(root) ? walk(root) : []
    },
    read: (p: string) => fs.readFileSync(abs(p), 'utf-8'),
    readJson: (p: string) => JSON.parse(fs.readFileSync(abs(p), 'utf-8')),
    exists: (p: string) => fs.existsSync(abs(p)),
    write: (p: string, content: string) => {
      fs.mkdirSync(path.dirname(abs(p)), { recursive: true })
      fs.writeFileSync(abs(p), content)
    },
    cleanup: (failed: boolean) => {
      if (failed || KEEP_ALWAYS) {
        console.warn(`[e2e] 保留 fixture 以便排查：${dir}`)
        return
      }
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}
