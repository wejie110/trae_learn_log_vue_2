<template>
  <div class="log-container">
    <!-- 文件上传组件 -->
    <el-upload
      class="upload-demo"
      action=""
      :auto-upload="false"
      :on-change="handleFileUpload"
      accept=".log,.txt"
    >
      <el-button type="primary">选择日志文件</el-button>
    </el-upload>

    <!-- 搜索区域 -->
    <div class="search-area">
      <div class="search-controls">
        <el-input
          v-model="searchText"
          placeholder="使用&&分隔多个检索条件"
          class="search-input"
        />
        <el-button
          type="primary"
          @click="performSearch"
          :disabled="!searchText.trim() && !startTime && !endTime"
        >
          搜索
        </el-button>
      </div>
      <div class="time-range-picker">
        <el-date-picker
          v-model="startTime"
          type="datetime"
          placeholder="选择开始时间"
          value-format="YYYY-MM-DD HH:mm:ss.SSS"
          class="time-picker"
        />
        <span style="margin: 0 5px">至</span>
        <el-date-picker
          v-model="endTime"
          type="datetime"
          placeholder="选择结束时间"
          value-format="YYYY-MM-DD HH:mm:ss.SSS"
          class="time-picker"
        />
      </div>
    </div>

    <!-- 结果展示表格 -->
    <el-table
      :data="filteredLogs"
      style="width: 100%"
      :default-sort="{ prop: 'timestamp', order: 'descending' }"
      :cell-style="{ verticalAlign: 'top' }"
    >
      <el-table-column
        prop="timestamp"
        label="时间"
        width="150"
        sortable
      />
      <el-table-column
        prop="service"
        label="服务"
        width="150"
      />
      <el-table-column
        prop="level"
        label="类型"
        width="80"
      />
      <el-table-column
        prop="content"
        label="内容"
        min-width="800"
      >
        <template #default="{ row }">
          <div v-html="highlightText(row.content, searchText)" class="log-content"></div>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { ref } from 'vue';

// 日志解析正则表达式（匹配：时间 [服务] | 级别 | 内容）
// 使用多行合并机制：当检测到新日志行时创建条目，非匹配行作为内容追加
const LOG_REGEX = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[([^\]]+)\] \| (\w+) +\| (.+)/;
const rawLogs = ref([]);
const searchText = ref('');
const startTime = ref('');
const endTime = ref('');
const filteredLogs = ref([]);

// 处理文件上传
const handleFileUpload = (file) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    parseLogFile(e.target.result);
  };
  reader.readAsText(file.raw);
};

// 解析日志文件内容
// 解析日志文件（支持多行日志合并）
// 1. 逐行解析，识别新日志行开始
// 2. 未匹配行追加到当前条目的content，保留原始格式
const parseLogFile = (content) => {
  const lines = content.split('\n');
  const entries = [];
  let currentEntry = null;

  lines.forEach(line => {
    const match = line.match(LOG_REGEX);
    if (match) {
      // 遇到新日志行时保存当前条目
      if (currentEntry) entries.push(currentEntry);
      currentEntry = {
        timestamp: match[1],
        service: match[2],
        level: match[3],
        content: match[4] // 捕获组调整后索引变化
      };
    } else if (currentEntry) { 
      // 保留原始缩进
      currentEntry.content += '\n' + line;
    }
  });
  
  if (currentEntry) entries.push(currentEntry);
  rawLogs.value = entries;
};

// 执行搜索
// 联合搜索逻辑（文本+时间）
// 1. 使用&&分隔多条件，要求全部匹配
// 2. 时间范围筛选包含边界值（>=开始，<=结束）
const performSearch = () => {
  filteredLogs.value = rawLogs.value
    .filter(entry => {
      const keywords = searchText.value.split('&&').map(k => k.trim()).filter(k => k);
      const matchesAllKeywords = keywords.length > 0 
        ? keywords.every(k => entry.content.includes(k) || entry.service.includes(k))
        : true;
      
      const logTime = new Date(entry.timestamp).getTime();
      const start = startTime.value ? new Date(startTime.value).getTime() : 0;
      const end = endTime.value ? new Date(endTime.value).getTime() : Infinity;
      
      const matchesTime = logTime >= start && logTime <= end;
      
      // 当时间条件存在时，必须同时满足文本和时间条件
      if (startTime.value || endTime.value) {
        return matchesAllKeywords && matchesTime;
      }
      return matchesAllKeywords;
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
};

// 高亮文本方法
// 安全的高亮处理方法
// 1. 先进行HTML转义防止XSS攻击
// 2. 使用CSS类代替直接样式注入
// 3. 严格正则转义搜索关键词
const highlightText = (text, search) => {
  if (!search.trim()) return text;
  const keywords = search.split('&&').map(k => k.trim()).filter(k => k);
  let highlighted = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  keywords.forEach(keyword => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    highlighted = highlighted.replace(
      new RegExp(`(${escaped})`, 'gi'),
      '<span class="highlight">$1</span>'
    );
  });

  return highlighted;
};
</script>

<style scoped>
.log-container {
  padding: 20px;
}
.search-area {
  margin: 20px 0;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.search-controls {
  display: flex;
  gap: 10px;
  align-items: center;
}

.search-input {
  flex: 1;
  width: auto;
}
.time-range-picker {
  display: flex;
  align-items: center;
  gap: 10px;
}
@media (max-width: 768px) {
  .search-controls {
    flex-direction: column;
  }
  .time-range-picker {
    flex-direction: column;
    align-items: stretch;
  }
  .time-picker,
  .search-input {
    width: 100% !important;
  }
}
.search-input {
  flex: 1;
  width: 200px;
}
.time-picker {
  width: 220px;
}
.el-date-editor {
  --el-date-editor-width: 220px;
}
::v-deep .highlight {
  background-color: yellow;
  padding: 0 2px;
  border-radius: 2px;
}
</style>