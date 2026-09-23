<script setup>
import { ref, computed } from 'vue'
import LogViewer from './components/LogViewer.vue'
import WaimaiOrderLogViewer from './components/WaimaiOrderLogViewer.vue'

const tabs = [
  { key: 'general', label: 'aip通用日志检索', component: LogViewer },
  { key: 'waimai', label: '外卖订单日志检索', component: WaimaiOrderLogViewer }
]

const activeKey = ref('general')
const activeComponent = computed(
  () => tabs.find(t => t.key === activeKey.value)?.component || LogViewer
)

const handleSelect = (key) => {
  activeKey.value = key
}
</script>

<template>
  <el-container class="layout">
    <el-aside width="220px" class="aside">
      <div class="aside-title">日志排查工具</div>
      <el-menu
        :default-active="activeKey"
        class="aside-menu"
        @select="handleSelect"
      >
        <el-menu-item v-for="tab in tabs" :key="tab.key" :index="tab.key">
          {{ tab.label }}
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-main class="main">
      <!-- keep-alive：切 tab 保留已上传/已检索的日志状态 -->
      <keep-alive>
        <component :is="activeComponent" />
      </keep-alive>
    </el-main>
  </el-container>
</template>

<style scoped>
.layout {
  height: 100vh;
}
.aside {
  border-right: 1px solid var(--el-border-color);
  display: flex;
  flex-direction: column;
}
.aside-title {
  padding: 16px;
  font-size: 15px;
  font-weight: 600;
  text-align: center;
  border-bottom: 1px solid var(--el-border-color);
}
.aside-menu {
  border-right: none;
  flex: 1;
}
.main {
  padding: 0;
  overflow: auto;
}
</style>
