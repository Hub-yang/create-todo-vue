import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findPackageJson, getVersion } from '../src/utils'

it('test', () => {
  const res = '1'
  expect(res).equal('1')
})

describe('findPackageJson', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ctv-findpkg-'))

  beforeAll(() => {
    // <root>/package.json + <root>/a/b/（深层无 package.json）
    fs.writeFileSync(
      path.join(fixtureRoot, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '9.9.9' }),
    )
    fs.mkdirSync(path.join(fixtureRoot, 'a', 'b'), { recursive: true })
  })

  afterAll(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  })

  it('起始目录自身就有 package.json 时直接返回它', () => {
    expect(findPackageJson(fixtureRoot)).toBe(path.join(fixtureRoot, 'package.json'))
  })

  it('逐级向上找，跨多层目录也能命中', () => {
    expect(findPackageJson(path.join(fixtureRoot, 'a', 'b')))
      .toBe(path.join(fixtureRoot, 'package.json'))
  })

  it('一路到文件系统根都没有时返回 undefined', () => {
    // 用真实的根目录做起点：/ 上不该有 package.json
    expect(findPackageJson(path.parse(process.cwd()).root)).toBeUndefined()
  })
})

describe('getVersion', () => {
  it('读得到本仓库自己的版本号，且与 package.json 一致', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const expected = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'),
    ).version
    expect(getVersion(repoRoot)).toBe(expected)
  })

  it('找不到 package.json 时返回 unknown 而不是抛错', () => {
    expect(getVersion(path.parse(process.cwd()).root)).toBe('unknown')
  })
})
