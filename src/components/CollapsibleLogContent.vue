<template>
  <div class="clc-wrap" :class="{ collapsible: isCollapsible }" @click="toggle">
    <div v-if="isCollapsible && !expanded && hiddenAbove > 0" class="clc-hint">
      ▲ 上方省略约 {{ hiddenAbove }} 行
    </div>
    <div ref="boxRef" class="clc-content" :class="{ clipped: isCollapsible && !expanded }">
      <div ref="innerRef" v-html="fullHtml"></div>
    </div>
    <div v-if="isCollapsible" class="clc-hint clc-toggle">
      <template v-if="!expanded">▼ 下方省略约 {{ hiddenBelow }} 行 · 共约 {{ totalLines }} 行，点击展开</template>
      <template v-else>▲ 点击收起</template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';

/* 日志内容折叠组件（按视觉行折叠）：
 * 内容渲染后超过 VISIBLE 个视觉行（含自动换行）时折叠；折叠态通过 scrollTop 定位到
 * 搜索关键词首次出现处（上方 ABOVE 行、下方 VISIBLE-ABOVE-1 行），点击切换展开/收起。
 * 无关键词命中时显示前 VISIBLE 行。高亮：先 HTML 转义防 XSS，再正则转义关键字。
 */
const props = defineProps({
  content: { type: String, default: '' },
  searchText: { type: String, default: '' }
});

const LH = 20;      // 与 .clc-content 的 line-height 保持一致
const VISIBLE = 10; // 折叠态可见行数
const ABOVE = 3;    // 关键词行上方保留行数

const boxRef = ref(null);
const innerRef = ref(null);
const expanded = ref(false);
const isCollapsible = ref(false);
const hiddenAbove = ref(0);
const hiddenBelow = ref(0);
const totalLines = ref(0);

const keywords = computed(() =>
  (props.searchText || '').split('&&').map(k => k.trim()).filter(Boolean)
);

// 完整内容（转义 + 高亮），折叠靠裁剪与滚动，不截断文本
const fullHtml = computed(() => {
  let html = (props.content || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  keywords.value.forEach(keyword => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(`(${escaped})`, 'gi'), '<span class="highlight">$1</span>');
  });
  return html;
});

const measure = async () => {
  await nextTick();
  const box = boxRef.value;
  const inner = innerRef.value;
  if (!box || !inner) return;
  const maxH = LH * VISIBLE;
  const fullH = inner.offsetHeight;
  isCollapsible.value = fullH > maxH + 2;
  totalLines.value = Math.round(fullH / LH);
  if (!isCollapsible.value || expanded.value) {
    box.scrollTop = 0;
    hiddenAbove.value = 0;
    hiddenBelow.value = isCollapsible.value ? totalLines.value - VISIBLE : 0;
    return;
  }
  // 折叠态：定位第一个关键词高亮，滚动到其上方 3 行处（贴底时夹紧）
  const hit = inner.querySelector('.highlight');
  let top = 0;
  if (hit) {
    top = hit.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - ABOVE * LH;
  }
  const maxScroll = fullH - maxH;
  box.scrollTop = Math.max(0, Math.min(top, maxScroll));
  hiddenAbove.value = Math.round(box.scrollTop / LH);
  hiddenBelow.value = Math.max(0, Math.round((fullH - box.scrollTop - maxH) / LH));
};

const toggle = () => {
  if (!isCollapsible.value) return;
  expanded.value = !expanded.value;
  measure();
};

let observer = null;
onMounted(() => {
  measure();
  // 列宽变化（窗口缩放/面板拖拽）会改变视觉行数，需要重测
  observer = new ResizeObserver(() => measure());
  observer.observe(innerRef.value);
});
onBeforeUnmount(() => observer && observer.disconnect());
watch(() => [props.content, props.searchText], measure);
</script>

<style scoped>
.clc-wrap.collapsible {
  cursor: pointer;
}
.clc-content {
  text-align: left;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 20px; /* 与脚本中 LH 常量一致 */
}
.clc-content.clipped {
  max-height: 200px; /* LH * VISIBLE */
  overflow: hidden;
}
.clc-hint {
  font-size: 12px;
  color: var(--el-color-primary);
  user-select: none;
}
.clc-toggle {
  margin-top: 2px;
}
.clc-wrap:hover .clc-toggle {
  text-decoration: underline;
}
:deep(.highlight) {
  background-color: yellow;
  padding: 0 2px;
  border-radius: 2px;
}
</style>
