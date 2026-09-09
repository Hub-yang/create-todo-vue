<script setup lang="ts">
import Prism from 'prismjs'
import 'prismjs/components/prism-javascript.min.js'
import 'prismjs/themes/prism-okaidia.css'

const router = useRouter()
const id = ref(0)

function goToArticle() {
  router.push(`/article/${id.value}`)
}

const useUnocss = ref(true)
const cssMode = computed(() => useUnocss.value ? 'unocss' : 'scss')

watch(useUnocss, () => nextTick(() => Prism.highlightAll()), { immediate: true })

const code = computed(() => {
  if (useUnocss.value) {
    return `
    <div v-if="useUnocss" overflow-hidden text-ellipsis text-nowrap>
      Lorem ipsum dolor...
    </div>
    `
  }
  return `
    @mixin text-overflow-ellipsis {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    <style scoped lang="scss">
      .text-overflow {
          @include text-overflow-ellipsis();
      }
    </style>
  `
})

function toggleCssMode() {
  useUnocss.value = !useUnocss.value
}
</script>

<template>
  <div w-full flex="~ col items-center">
    <div flex="~ justify-center items-center" gap-2>
      <button btn @click="id--">
        -
      </button>
      <a
        class="cursor-pointer font-bold underline underline-offset-3 decoration-dashed transition-duration-250 transition-property-color hover:color-#646cff"
        @click="goToArticle"
      >
        Go To Article {{ id }}
      </a>
      <button btn @click="id++">
        +
      </button>
    </div>
    <div mt-10 h-fit w="50%">
      <button btn w-26 @click="toggleCssMode">
        use {{ cssMode }}
      </button>
      <div bg="#272822" mt-3 rounded-1 p-2 color-white>
        <div v-if="useUnocss" overflow-hidden text-ellipsis text-nowrap>
          这一行文本刻意写得比容器宽，用来演示单行省略号——上面的按钮可以在 UnoCSS 原子类与 SCSS mixin 两种实现之间切换，效果是一样的。
        </div>
        <div v-else class="text-overflow">
          这一行文本刻意写得比容器宽，用来演示单行省略号——上面的按钮可以在 UnoCSS 原子类与 SCSS mixin 两种实现之间切换，效果是一样的。
        </div>
      </div>
      <div>
        <pre><code class="language-javascript">{{ code }}</code></pre>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.text-overflow {
  @include text-overflow-ellipsis();
}
</style>
