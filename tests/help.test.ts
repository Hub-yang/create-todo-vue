import type { RenderableFramework } from '../src/help'
import { describe, expect, it } from 'vitest'
import { renderTemplateList } from '../src/help'

/**
 * CTV-16：help 的「可用模板」由 `FRAMEWORKS` 派生，不再手写。
 *
 * 病根是 CTV-05 记的那条：同一份模板清单手写了三遍（`FRAMEWORKS` / `HELP_MESSAGE` /
 * README），加删模板必然漂移。CTV-01 那次只是把三份对齐了，根因没动。
 *
 * **排版刻意不复刻旧版**。旧版是手工对齐的：第一块列宽 14、custom 块列宽 21，
 * 折行位置也是手挑的。想派生出一模一样的结果，就得把这些随意决定重新编码成数据——
 * 那正是本条目要消灭的东西。所以改成确定性算法：**列宽 = 最长模板名 + 2，
 * 按给定宽度折行，仍按框架分组、仍用框架自己的颜色**。
 *
 * ⚠️ 本文件的期望值全部**硬编码**，不从 `FRAMEWORKS` 或函数自身的输入派生。
 * 期望值一旦和实际值同源，断言就退化成恒等式（CLAUDE.md 第三条标准，
 * CTV-30 已用变异实测证实过一次）。
 */

/** 把颜色标出来，好断言「哪一行用了哪个框架的颜色」 */
const tag = (mark: string) => (s: string | number) => `<${mark}>${s}</${mark}>`

/** 两个框架、名字长短悬殊，用来钉列宽是全局算的而不是每块各算 */
const frameworks: RenderableFramework[] = [
  {
    name: 'vanilla',
    color: tag('y'),
    variants: [{ name: 'vanilla-ts' }, { name: 'vanilla' }],
  },
  {
    name: 'lit',
    color: tag('r'),
    variants: [{ name: 'lit-ts' }, { name: 'lit' }],
  },
]

/** 剥掉上面那套标记，只看排版 */
const plain = (s: string) => s.replace(/<\/?[yrgb]>/g, '')

describe('renderTemplateList', () => {
  it('一个框架的变体排成一行，按列宽补齐', () => {
    const out = plain(renderTemplateList(frameworks, 80))

    // 最长的是 'vanilla-ts'（10）→ 列宽 12
    expect(out.split('\n')[0]).toBe('vanilla-ts  vanilla')
  })

  it('每个框架各起一块，块之间换行', () => {
    const out = plain(renderTemplateList(frameworks, 80))

    expect(out).toBe('vanilla-ts  vanilla\nlit-ts      lit')
  })

  /**
   * 列宽必须**全局**算：每块各算的话，`lit` 那块会缩成 8 列，两块对不齐。
   * 上面的 fixture 特意让两个框架的名字长短悬殊，就是为了钉这一条。
   */
  it('列宽按全部模板里最长的那个算，不是每块各算', () => {
    const out = plain(renderTemplateList(frameworks, 80))

    // 'lit-ts' 只有 6 个字符，却要补到 12 列才跟上面对齐
    expect(out.split('\n')[1]).toBe('lit-ts      lit')
  })

  it('一行放不下就折行，按同样的列宽继续', () => {
    const many: RenderableFramework[] = [{
      name: 'x',
      color: tag('g'),
      variants: [{ name: 'aa' }, { name: 'bb' }, { name: 'cc' }, { name: 'dd' }, { name: 'ee' }],
    }]

    // 列宽 = 2 + 2 = 4，宽度 12 → 每行 3 个
    const out = plain(renderTemplateList(many, 12))

    expect(out).toBe('aa  bb  cc\ndd  ee')
  })

  it('行尾不留补齐用的空格', () => {
    const out = renderTemplateList(frameworks, 80)

    for (const line of plain(out).split('\n')) {
      expect(line, `这一行末尾有多余空格：${JSON.stringify(line)}`).toBe(line.trimEnd())
    }
  })

  it('每一行都用所属框架的颜色', () => {
    const out = renderTemplateList(frameworks, 80)

    expect(out).toBe('<y>vanilla-ts  vanilla</y>\n<r>lit-ts      lit</r>')
  })

  /**
   * 没有 variants 的框架，它自己就是一个可选项——这正是 `TEMPLATES` 的
   * `f.variants?.length ? ... : f.name` 那条规则，两边必须一致，
   * 否则 help 会漏掉一个 `-t` 真正接受的值。
   */
  it('没有 variants 的框架，列出框架自己的名字', () => {
    const bare: RenderableFramework[] = [{ name: 'solo', color: tag('b') }]

    expect(plain(renderTemplateList(bare, 80))).toBe('solo')
  })

  it('variants 是空数组时同样退回框架自己的名字', () => {
    const bare: RenderableFramework[] = [{ name: 'solo', color: tag('b'), variants: [] }]

    expect(plain(renderTemplateList(bare, 80))).toBe('solo')
  })

  it('宽度窄到放不下一列时，每行仍至少放一个，不会死循环或产出空行', () => {
    const many: RenderableFramework[] = [{
      name: 'x',
      color: tag('g'),
      variants: [{ name: 'aaaaaaaa' }, { name: 'bbbbbbbb' }],
    }]

    expect(plain(renderTemplateList(many, 1))).toBe('aaaaaaaa\nbbbbbbbb')
  })
})
