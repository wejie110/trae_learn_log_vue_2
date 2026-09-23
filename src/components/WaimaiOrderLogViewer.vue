<template>
  <div class="waimai-container">
    <!-- ① 网关与订单操作区 -->
    <el-card shadow="never" class="op-card">
      <div class="op-row">
        <el-input
          v-model="gatewayBase"
          placeholder="中台网关完整地址（含路径），默认 http://10.18.8.195:9999/aip-gateway/gateway.action"
          class="gateway-input"
          clearable
        />
        <el-input v-model="orderNo" placeholder="订单号 orderNo" class="field-input" clearable />
        <el-input v-model="ptOrderNo" placeholder="平台单号 ptOrderNo" class="field-input" clearable />
        <el-select v-model="orderFrom" placeholder="渠道" class="channel-select" clearable>
          <el-option v-for="c in CHANNELS" :key="c.code" :label="c.label" :value="c.code" />
        </el-select>
        <el-button type="primary" :loading="detailLoading" @click="queryOrderDetail">
          查询订单详情
        </el-button>
      </div>
    </el-card>

    <!-- ② 日志上传与检索区 -->
    <el-card shadow="never" class="op-card">
      <div class="op-row">
        <el-upload
          action=""
          :auto-upload="false"
          :multiple="true"
          :on-change="handleFileUpload"
          :on-remove="handleFileRemove"
          accept=".log,.txt"
          class="log-upload"
        >
          <el-button type="primary">上传日志（可多选）</el-button>
        </el-upload>
        <span class="upload-tip">支持 aip-onsale / aip-ocs / aip-ws 日志混合上传，自动识别格式与服务</span>
      </div>
      <div class="op-row">
        <el-input
          v-model="searchText"
          placeholder="检索关键字，&& 分隔多条件；查订单详情后自动带入订单号"
          class="search-input"
          clearable
          @keyup.enter="performSearch"
        />
        <el-select v-model="serviceFilter" multiple collapse-tags placeholder="服务筛选" class="filter-select">
          <el-option v-for="s in serviceOptions" :key="s" :label="s" :value="s" />
        </el-select>
        <el-select v-model="stageFilter" multiple collapse-tags placeholder="环节筛选" class="filter-select">
          <el-option v-for="s in stageOptions" :key="s" :label="s" :value="s" />
        </el-select>
        <el-button type="primary" @click="performSearch" :disabled="!searchText.trim()">搜索</el-button>
        <span class="result-count" v-if="searched">共 {{ filteredLogs.length }} 条（点时间列头可切换正/倒序）</span>
      </div>
    </el-card>

    <!-- ③ 主体：左日志时间线 / 右订单详情 -->
    <div class="main-split">
      <el-card shadow="never" class="log-panel">
        <el-table
          :data="filteredLogs"
          :cell-style="{ verticalAlign: 'top' }"
          :default-sort="{ prop: 'timestamp', order: 'ascending' }"
          class="log-table"
          height="100%"
        >
          <el-table-column prop="timestamp" label="时间" width="155" sortable />
          <el-table-column prop="service" label="服务" width="100" show-overflow-tooltip />
          <el-table-column label="环节" width="100">
            <template #default="{ row }">
              <el-tag v-if="row.stage" :type="row.stageType" size="small">{{ row.stage }}</el-tag>
              <span v-else>-</span>
            </template>
          </el-table-column>
          <el-table-column prop="level" label="级别" width="60" />
          <el-table-column label="内容" min-width="300">
            <template #default="{ row }">
              <div v-if="row.ocsMethod" class="ocs-method">{{ row.ocsMethod }}</div>
              <CollapsibleLogContent :content="row.content" :search-text="searchText" />
            </template>
          </el-table-column>
          <el-table-column prop="file" label="来源文件" width="130" show-overflow-tooltip />
        </el-table>
        <el-empty v-if="searched && !filteredLogs.length" description="无匹配日志" />
      </el-card>

      <el-card shadow="never" class="detail-panel">
        <template #header>
          <div class="detail-header">
            <span>订单详情（onsale.queryOutOrderDetail）</span>
            <el-tag v-if="detailMeta" :type="detailMeta.ok ? 'success' : 'danger'" size="small">
              {{ detailMeta.text }}
            </el-tag>
          </div>
        </template>
        <div v-loading="detailLoading" class="detail-body">
          <pre v-if="detailJson !== null" class="json-view">{{ detailJson }}</pre>
          <el-alert v-else-if="detailError" :title="detailError" type="error" :closable="false" />
          <el-empty v-else description="填写网关地址与单号后点击查询" :image-size="60" />
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import axios from 'axios';
import { ElMessage } from 'element-plus';
import CollapsibleLogContent from './CollapsibleLogContent.vue';

/* ============ 渠道枚举（与 aip-ocs ChannelEnum / aip OrderFromEnum 对齐） ============ */
const CHANNELS = [
  { code: '132', label: '美团闪购(132)' },
  { code: '132f', label: '美团餐饮(132f)' },
  { code: '133', label: '饿了么零售(133)' },
  { code: '133f', label: '饿了么餐饮(133f)' },
  { code: '134', label: '京东秒送(134)' },
  { code: '135', label: '有赞(135)' },
  { code: '137', label: '企迈(137)' },
  { code: '139', label: '抖店(139)' },
  { code: '140', label: '美团团购(140)' },
  { code: '143', label: '淘鲜达(143)' },
  { code: '144', label: '抖音随心团(144)' },
  { code: '145', label: '淘宝闪购(145)' },
  { code: 'lyfyd', label: '来伊份云店(lyfyd)' }
];

/* ============ 日志行解析 ============
 * aip4 系(onsale/ws)：2026-09-23 15:30:00.123 [aip-onsale,10.18.8.5:8080,thread] | INFO  | logger | [trace] | msg
 * aip-ocs           ：2026-09-23 15:30:00 [aip-ocs-server,thread] | INFO  | logger | [trace] | msg
 * 差异：毫秒可选、括号段数不同 → 统一行首正则，服务名取括号第一段
 */
const LOG_REGEX = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,3})?) \[([^\]]+)\]\s*\|\s*(\w+)\s*\| (.*)$/;

/* aip-ocs HistoneLogger 打印的 LogMsgVo：msg 部分为 JSON，含 ordNo/direction/method/jsonMsg */
const OCS_JSON_MARK = '{"tId"';

/* 平台代号 → 名称（用于 direction 标签） */
const PLATFORM_NAMES = {
  '132': '美团闪购', '132F': '美团餐饮', '133': '饿了么零售', '133F': '饿了么餐饮',
  '134': '京东', '135': '有赞', '137': '企迈', '139': '抖店', 'LYFYD': '来伊份云店',
  'DySXT': '抖音随心团', 'SIHUI': '斯慧', 'PEANUT': '花生', 'TXD': '淘鲜达',
  'TBSG': '淘宝闪购', 'MYT': '麦芽田', 'ONSALE': '中台'
};

/* direction 原始值 → 环节标签 */
const directionToStage = (direction) => {
  if (!direction || direction === '-') return null;
  if (direction === 'OCS2ONSALE') return { text: 'OCS→中台', type: 'primary' };
  if (direction === 'ONSALE2OCS') return { text: '中台→OCS', type: 'warning' };
  const toOcs = direction.match(/^(.+)2OCS$/);
  if (toOcs) return { text: `${PLATFORM_NAMES[toOcs[1]] || toOcs[1]}→OCS`, type: 'success' };
  const fromOcs = direction.match(/^OCS2(.+)$/);
  if (fromOcs) return { text: `OCS→${PLATFORM_NAMES[fromOcs[1]] || fromOcs[1]}`, type: 'danger' };
  return { text: direction, type: 'info' };
};

/* aip-ws 文本日志 → 环节标签 */
const WS_STAGES = [
  { pattern: '推送消息', stage: { text: 'WS→POS', type: 'danger' } },
  { pattern: '收到文本消息', stage: { text: 'POS→WS', type: 'success' } },
  { pattern: '已上线', stage: { text: 'POS上线', type: 'success' } },
  { pattern: '已下线', stage: { text: 'POS下线', type: 'info' } },
  { pattern: '已确认收到', stage: { type: 'success', text: 'POS ACK' } }
];

const rawLogs = ref([]);
const searchText = ref('');
const serviceFilter = ref([]);
const stageFilter = ref([]);
const filteredLogs = ref([]);
const searched = ref(false);

const serviceOptions = computed(() => [...new Set(rawLogs.value.map(e => e.service))].sort());
const stageOptions = computed(() => [...new Set(rawLogs.value.map(e => e.stage).filter(Boolean))].sort());

const handleFileUpload = (file) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    parseLogFile(e.target.result, file);
    if (searchText.value.trim()) performSearch();
  };
  reader.readAsText(file.raw);
};

const handleFileRemove = (file) => {
  rawLogs.value = rawLogs.value.filter(entry => entry.uid !== file.uid);
  if (searchText.value.trim()) performSearch();
  else filteredLogs.value = [];
};

const parseLogFile = (content, file) => {
  // 按 \r?\n 切行：Windows 日志 CRLF 行尾的 \r 会让带 $ 锚点的行首正则失配（JS 的 . 不匹配 \r）
  const lines = content.split(/\r?\n/);
  const entries = [];

  // 一行日志 = 一行表格（不做多行合并）：不匹配行首格式的行也独立成行
  let lastTimestamp = '';
  lines.forEach(line => {
    if (!line.trim()) return;
    const match = line.match(LOG_REGEX);
    if (match) {
      lastTimestamp = match[1];
      entries.push({
        timestamp: match[1],
        service: match[2].split(',')[0].trim(),
        level: match[3],
        content: match[4],
        stage: null,
        stageType: 'info',
        ocsMethod: '',
        file: file.name,
        uid: file.uid
      });
    } else {
      // 裸行（无行首格式）：继承上一行时间戳，保证排序时不沉底/置顶
      entries.push({
        timestamp: lastTimestamp,
        service: '-',
        level: '',
        content: line,
        stage: null,
        stageType: 'info',
        ocsMethod: '',
        file: file.name,
        uid: file.uid
      });
    }
  });

  // 二次加工：识别 OCS 结构化日志（LogMsgVo JSON）与 aip-ws 文本特征，打环节标签
  entries.forEach(enrichEntry);
  rawLogs.value = rawLogs.value.concat(entries);
};

const enrichEntry = (entry) => {
  const jsonStart = entry.content.indexOf(OCS_JSON_MARK);
  if (jsonStart >= 0) {
    try {
      const vo = JSON.parse(entry.content.slice(jsonStart));
      const stage = directionToStage(vo.direction);
      if (stage) {
        entry.stage = stage.text;
        entry.stageType = stage.type;
      }
      entry.ocsMethod = vo.method || '';
      entry.content = vo.jsonMsg || entry.content;
      return;
    } catch (e) { /* 非完整 JSON，按普通文本处理 */ }
  }
  for (const rule of WS_STAGES) {
    if (entry.content.includes(rule.pattern)) {
      entry.stage = rule.stage.text;
      entry.stageType = rule.stage.type;
      return;
    }
  }
};

const performSearch = () => {
  const keywords = searchText.value.split('&&').map(k => k.trim()).filter(k => k);
  searched.value = true;
  // 排序交给 el-table（时间列 sortable，默认正序，列头可切换倒序）
  filteredLogs.value = rawLogs.value.filter(entry => {
    const matchKw = keywords.length === 0 || keywords.every(k =>
      entry.content.includes(k) || entry.service.includes(k) || entry.ocsMethod.includes(k)
    );
    const matchService = serviceFilter.value.length === 0 || serviceFilter.value.includes(entry.service);
    const matchStage = stageFilter.value.length === 0 || (entry.stage && stageFilter.value.includes(entry.stage));
    return matchKw && matchService && matchStage;
  });
};

/* ============ 网关订单详情查询 ============
 * 与 aip-dev-mcp gateway_call 同口径：POST {网关}/aip-gateway/gateway.action，
 * 真 MD5 签名（app_id=951413 / md5_key=321513 / 毫秒时间戳）。
 * 浏览器 → POST /gateway/aip（vite dev 中间件负责签名并转发，规避跨域 + 密钥不落前端）。
 * 网关地址留空时由中间件用默认（http://10.18.8.195:9999/aip-gateway/gateway.action）。
 */
const DEFAULT_GATEWAY = 'http://10.18.8.195:9999/aip-gateway/gateway.action';
// 旧 key（waimai.gatewayBase）可能存了历史错误地址，换新 key 让默认值重新生效
const gatewayBase = ref(localStorage.getItem('waimai.gatewayUrl') || DEFAULT_GATEWAY);
const orderNo = ref('');
const ptOrderNo = ref('');
const orderFrom = ref('');
const detailLoading = ref(false);
const detailJson = ref(null);
const detailError = ref('');
const detailMeta = ref(null);

const queryOrderDetail = async () => {
  const base = gatewayBase.value.trim();
  if (!orderNo.value.trim() && !ptOrderNo.value.trim()) {
    ElMessage.warning('订单号 / 平台单号至少填一个');
    return;
  }
  localStorage.setItem('waimai.gatewayUrl', base);
  detailLoading.value = true;
  detailError.value = '';
  detailJson.value = null;
  detailMeta.value = null;
  try {
    // data 以对象形式交给中间件统一序列化（4空格缩进+\r\n），保证与签名串一致
    const res = await axios.post('/gateway/aip', {
      target: base || undefined,
      method: 'onsale.queryOutOrderDetail',
      data: {
        ptOrderNo: ptOrderNo.value.trim(),
        orderNo: orderNo.value.trim(),
        orderFrom: orderFrom.value
      }
    });
    const resp = res.data || {};
    if (String(resp.code) === '1') {
      let data = resp.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) { /* 保留原字符串 */ }
      }
      detailJson.value = JSON.stringify(data, null, 2);
      detailMeta.value = { ok: true, text: '成功' };
      // 自动带入订单号作为日志关键字并检索
      const kw = orderNo.value.trim() || ptOrderNo.value.trim();
      if (kw) {
        searchText.value = kw;
        if (rawLogs.value.length) performSearch();
      }
    } else {
      detailError.value = `接口返回失败：${resp.message || resp.msg || JSON.stringify(resp)}`;
      detailMeta.value = { ok: false, text: '失败' };
    }
  } catch (e) {
    // 中间件会把真实原因放在响应体 message 里（目标不可达/超时/参数错误）
    const srvMsg = e.response?.data?.message;
    detailError.value = srvMsg
      ? `请求异常：${srvMsg}`
      : `请求异常：${e.message}（仅 dev 中间件可用，请确认 npm run dev 已启动）`;
    detailMeta.value = { ok: false, text: '异常' };
  } finally {
    detailLoading.value = false;
  }
};
</script>

<style scoped>
.waimai-container {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  box-sizing: border-box;
}
.op-card :deep(.el-card__body) {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.op-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.gateway-input {
  flex: 1;
  min-width: 280px;
}
.field-input {
  width: 200px;
}
.channel-select {
  width: 180px;
}
.log-upload {
  display: inline-flex;
}
.upload-tip {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.search-input {
  flex: 1;
  min-width: 240px;
}
.filter-select {
  width: 180px;
}
.result-count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.main-split {
  display: flex;
  gap: 12px;
  flex: 1;
  min-height: 0;
}
.log-panel {
  flex: 3;
  min-width: 0;
}
.log-panel :deep(.el-card__body) {
  padding: 0;
  height: 100%;
}
.log-table {
  width: 100%;
}
/* 收窄单元格左右内边距，让内容列拿到更多宽度 */
.log-panel :deep(.el-table .cell) {
  padding: 0 6px;
}
.detail-panel {
  flex: 2;
  min-width: 320px;
  display: flex;
  flex-direction: column;
}
.detail-panel :deep(.el-card__body) {
  flex: 1;
  overflow: auto;
}
.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.detail-body {
  min-height: 120px;
}
.json-view {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  text-align: left;
}
.ocs-method {
  font-size: 12px;
  color: var(--el-color-primary);
  font-weight: 600;
  margin-bottom: 2px;
}
:deep(.highlight) {
  background-color: yellow;
  padding: 0 2px;
  border-radius: 2px;
}
</style>
