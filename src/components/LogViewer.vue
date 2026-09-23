<template>
  <div class="log-container">
    <!-- 文件上传组件（支持多选/多次添加，检索范围=全部已添加文件） -->
    <el-upload
      class="upload-demo"
      action=""
      :auto-upload="false"
      :multiple="true"
      :on-change="handleFileUpload"
      :on-remove="handleFileRemove"
      accept=".log,.txt"
    >
      <el-button type="primary">选择日志文件（可多选）</el-button>
      <template #tip>
        <div class="upload-tip">可多次添加或一次多选，检索范围为全部已添加文件；在文件列表中移除某文件即排除其日志</div>
      </template>
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
        width="100"
        class-name="service-cell"
      />
      <el-table-column
        prop="file"
        label="来源文件"
        width="140"
        show-overflow-tooltip
      />
      <el-table-column
        prop="level"
        label="类型"
        width="60"
      />
      <el-table-column
        prop="content"
        label="内容"
        min-width="500"
      >
        <template #default="{ row }">
          <CollapsibleLogContent :content="row.content" :search-text="searchText" />
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import CollapsibleLogContent from './CollapsibleLogContent.vue';

// 日志解析正则表达式（匹配：时间 [服务] | 级别 | 内容）
// 使用多行合并机制：当检测到新日志行时创建条目，非匹配行作为内容追加
const LOG_REGEX = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[([^\]]+)\] \| (\w+) +\| (.+)/;
const rawLogs = ref([]);
const searchText = ref('');
const startTime = ref('');
const endTime = ref('');
const filteredLogs = ref([]);

// 处理文件上传（多文件累积：解析结果追加到 rawLogs，不覆盖）
const handleFileUpload = (file) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    parseLogFile(e.target.result, file);
    // 已有检索条件时自动重搜，保证新文件结果并入；否则等用户点搜索（避免大文件全量渲染）
    if (searchText.value.trim() || startTime.value || endTime.value) {
      performSearch();
    }
  };
  reader.readAsText(file.raw);
};

// 移除文件时同步剔除其日志并重搜
const handleFileRemove = (file) => {
  rawLogs.value = rawLogs.value.filter(entry => entry.uid !== file.uid);
  if (searchText.value.trim() || startTime.value || endTime.value) {
    performSearch();
  } else {
    filteredLogs.value = [];
  }
};

// 解析日志文件（支持多行日志合并）
// 1. 逐行解析，识别新日志行开始
// 2. 未匹配行追加到当前条目的content，保留原始格式
// 3. 条目追加到 rawLogs（不覆盖），并标记来源文件名/uid
const parseLogFile = (content, file) => {
  // 按 \r?\n 切行，避免 Windows CRLF 行尾的 \r 混入内容
  const lines = content.split(/\r?\n/);
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
        content: match[4], // 捕获组调整后索引变化
        file: file.name,
        uid: file.uid
      };
    } else if (currentEntry) {
      // 保留原始缩进
      currentEntry.content += '\n' + line;
    }
  });

  if (currentEntry) entries.push(currentEntry);
  rawLogs.value = rawLogs.value.concat(entries);
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
</script>

<style scoped>
.log-container {
  padding: 20px;
}
.upload-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 6px;
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
/* 收窄单元格左右内边距，让内容列拿到更多宽度 */
:deep(.el-table .cell) {
  padding: 0 6px;
}
/* 服务列允许折行（逗号/长串任意断行），不截断 */
:deep(.el-table td.service-cell .cell) {
  white-space: normal;
  word-break: break-all;
}
::v-deep .highlight {
  background-color: yellow;
  padding: 0 2px;
  border-radius: 2px;
}
</style>