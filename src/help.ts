/**
 * 帮助信息里「可用模板」那一块的渲染。
 *
 * CTV-16：这份清单此前是**手写**的 ASCII 表格，加删模板必然漂移——CTV-05 记的
 * 「同一份清单手写三遍」就是这个病，CTV-01 那次只把三份对齐了，根因没动。
 * 现在它由 `FRAMEWORKS` 派生，漏掉在结构上不可能发生。
 *
 * **本文件不 import `constants`**，数据一律靠参数传进来：反过来 `constants` 要
 * import 本文件来拼 `HELP_MESSAGE`，两边互相 import 就成了循环依赖。
 *
 * 排版是确定性算法，不复刻旧版的手工对齐（旧版第一块列宽 14、custom 块 21，
 * 折行位置也是手挑的）。复刻那些就得把随意决定重新编码成数据，正是本条目要消灭的。
 */

/** 渲染只需要名字，`display` / `link` / `customCommand` 都跟这份清单无关 */
export interface RenderableVariant {
  name: string
}

export interface RenderableFramework {
  name: string
  color: (s: string | number) => string
  variants?: RenderableVariant[]
}

/** 列与列之间的间隔。列宽 = 最长模板名 + 它 */
const GUTTER = 2

/**
 * 把框架树渲染成按框架分组、按列对齐的模板清单
 *
 * 列宽按**全部**模板里最长的那个算（不是每块各算），这样跨框架的列也能对齐。
 * @param {RenderableFramework[]} frameworks - 框架树
 * @param {number} width - 可用宽度，超过就折行
 * @returns 多行文本，每行已经套上所属框架的颜色
 */
export function renderTemplateList(
  frameworks: RenderableFramework[],
  width = 80,
): string {
  // 没有 variants 的框架，它自己就是一个可选项——与 TEMPLATES 的派生规则一致，
  // 两边不一致的话 help 会漏掉一个 `-t` 真正接受的值
  const namesOf = (f: RenderableFramework): string[] =>
    f.variants?.length ? f.variants.map(v => v.name) : [f.name]

  const longest = Math.max(
    0,
    ...frameworks.flatMap(namesOf).map(name => name.length),
  )
  const column = longest + GUTTER
  // 至少放一个：宽度窄到放不下一列时，Math.floor 会给 0，那会导致空行与死循环
  const perLine = Math.max(1, Math.floor(width / column))

  return frameworks
    .map((f) => {
      const names = namesOf(f)
      const lines: string[] = []
      for (let i = 0; i < names.length; i += perLine) {
        lines.push(
          names
            .slice(i, i + perLine)
            .map(name => name.padEnd(column))
            .join('')
            // 补齐是为了对齐列，行尾那截没有对齐对象，留着只是尾随空格
            .trimEnd(),
        )
      }
      return lines.map(line => f.color(line)).join('\n')
    })
    .join('\n')
}
