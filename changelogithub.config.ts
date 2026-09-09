/**
 * changelogithub 的配置（CTV-32）。
 *
 * 它只在 `release.yml` 里以 `pnpm dlx changelogithub@15` 的形式跑，配置由 c12 从
 * cwd 自动发现，所以 workflow 那行命令不用动。刻意不放进 `package.json` 的
 * `changelogithub` 字段（那份会随包发布给使用者），独立文件也不在 `files` 的
 * `["bin", "dist", "template-*&#47;**"]` 里，发布产物仍是 82 个文件。
 *
 * 这里只列**要新增的类型**：默认的 feat / fix / perf 是被合并而不是被替换的
 * （实测 15.0.5：带这份配置时 types 为 feat, fix, perf, refactor, docs, build）。
 *
 * 刻意不收 chore / test / ci。仓库里 11 条 chore 全是 `chore: release vX.Y.Z`，
 * 收进来等于每份发布说明都挂一条废话；test / ci 对使用者没有意义。而 build 里有
 * 「修 files 通配、让模板真的发得出去」、refactor 里有 CTV-15 那次 265 行的分层
 * 重构，都是使用者该看到却一直隐形的东西。
 *
 * 标题的 emoji 沿用 changelogen 的惯例，与上游生态保持一致。
 */
export default {
  types: {
    refactor: { title: '💅 Refactors' },
    docs: { title: '📖 Documentation' },
    build: { title: '📦 Build' },
  },
}
