// 三个任务都写成零参函数，这是 lint-staged 官方指定的「不把匹配到的文件名
// 追加为参数」的写法。tsc 和 vitest 拿到一个任意的变更文件子集会行为错误，
// 必须对整个项目跑。
export default {
  '*': [
    () => 'pnpm typecheck',
    () => 'pnpm lint:fix',
    () => 'pnpm test',
  ],
}
