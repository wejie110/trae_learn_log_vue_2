import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import http from 'node:http'
import https from 'node:https'
import crypto from 'node:crypto'
import fs from 'node:fs'
import iconv from 'iconv-lite'

/**
 * AIP 网关签名（算法与 aip-dev-mcp/handlers/gateway_call.py、ScrmGatewayUtils.java 一致）：
 * 1. 参数集 app_id/charset/data/format/key(md5_key)/method/timestamp(毫秒)/version=1.0
 * 2. 按 key 字典序拼 k=v&k=v
 * 3. MD5 → 32位小写 hex → 对 hex 的 UTF-8 字节做 Base64
 * 4. 请求体为 form：method/sign/sign_type/app_id/timestamp/charset/format/version + data（key 不进 body，仅参与签名）
 */
function loadGatewayConf() {
  const def = {
    app_id: '951413',
    md5_key: '321513',
    defaultUrl: 'http://10.18.8.195:9999/aip-gateway/gateway.action'
  }
  try {
    // 单源：优先读 aip-dev-mcp 的配置
    const yaml = fs.readFileSync('D:\\histoneGitFiles\\aip-dev-mcp\\config.yaml', 'utf-8')
    const block = yaml.match(/^gateway:\n((?:  .+\n)+)/m)
    if (block) {
      const get = (k) => (block[1].match(new RegExp(`${k}: "([^"]+)"`)) || [])[1]
      return {
        app_id: get('app_id') || def.app_id,
        md5_key: get('md5_key') || def.md5_key,
        defaultUrl: get('url') || def.defaultUrl
      }
    }
  } catch (e) { /* 读不到用默认 */ }
  return def
}

const gatewayConf = loadGatewayConf()

function signAip(method, bizJson) {
  const ts = String(Date.now())
  const params = {
    app_id: gatewayConf.app_id,
    charset: 'utf-8',
    data: bizJson,
    format: 'JSON',
    key: gatewayConf.md5_key,
    method,
    timestamp: ts,
    version: '1.0'
  }
  const content = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&')
  const md5 = crypto.createHash('md5').update(content, 'utf8').digest('hex')
  return { ts, sign: Buffer.from(md5, 'utf8').toString('base64') }
}

const jsonEnd = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}

// dev 中间件：POST /gateway/aip  { target?, method, data(object) } → 签名后转发网关，规避浏览器跨域
function gatewayMiddleware() {
  return {
    name: 'aip-gateway-sign-proxy',
    configureServer(server) {
      server.middlewares.use('/gateway/aip', (req, res) => {
        if (req.method !== 'POST') return jsonEnd(res, 405, { code: '-1', message: '仅支持 POST' })
        let body = ''
        req.on('data', c => (body += c))
        req.on('end', () => {
          try {
            const { target, method, data } = JSON.parse(body || '{}')
            if (!method) return jsonEnd(res, 400, { code: '-1', message: '缺少 method' })
            // 容错：允许省略协议前缀，只填 host:port/path 也行
            let targetUrl = (target || '').trim() || gatewayConf.defaultUrl
            if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'http://' + targetUrl
            const dest = new URL(targetUrl)
            // data 序列化与签名串必须完全一致（4 空格缩进 + \r\n，与 Apifox/aip-dev-mcp 口径一致）
            const bizJson = JSON.stringify(data ?? {}, null, 4).replace(/\n/g, '\r\n')
            const { ts, sign } = signAip(method, bizJson)
            const head = new URLSearchParams({
              method, sign, sign_type: 'MD5', app_id: gatewayConf.app_id,
              timestamp: ts, charset: 'utf-8', format: 'JSON', version: '1.0'
            }).toString()
            const formBody = head + '&' + new URLSearchParams({ data: bizJson }).toString()

            const client = dest.protocol === 'https:' ? https : http
            const proxyReq = client.request({
              hostname: dest.hostname,
              port: dest.port || (dest.protocol === 'https:' ? 443 : 80),
              path: dest.pathname + dest.search,
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(formBody)
              },
              timeout: 10000
            }, (proxyRes) => {
              const chunks = []
              proxyRes.on('data', c => chunks.push(c))
              proxyRes.on('end', () => {
                const buf = Buffer.concat(chunks)
                const ctype = proxyRes.headers['content-type'] || ''
                // 网关后挂多个 onsale 实例，响应编码不统一（GBK/UTF-8 都有）：
                // 优先按声明 charset；未声明则先试严格 UTF-8，失败再按 GBK 兜底
                const declared = (ctype.match(/charset=([\w-]+)/i) || [])[1]
                let bodyBuf = buf
                try {
                  let bodyStr
                  if (declared) {
                    bodyStr = iconv.decode(buf, declared)
                  } else {
                    try {
                      bodyStr = new TextDecoder('utf-8', { fatal: true }).decode(buf)
                    } catch (e) {
                      bodyStr = iconv.decode(buf, 'gbk')
                    }
                  }
                  // 网关报文尾部自带残缺字节（产生 U+FFFD），顺手剔除
                  bodyBuf = Buffer.from(bodyStr.replace(/\uFFFD/g, ''), 'utf8')
                } catch (e) { /* 解码失败保持原样 */ }
                const headers = { ...proxyRes.headers }
                delete headers['content-length']
                delete headers['content-encoding']
                headers['content-type'] = /charset=/i.test(ctype)
                  ? ctype.replace(/charset=[\w-]+/i, 'charset=utf-8')
                  : (ctype || 'application/json') + '; charset=utf-8'
                res.writeHead(proxyRes.statusCode || 502, headers)
                res.end(bodyBuf)
              })
            })
            proxyReq.on('timeout', () => proxyReq.destroy(new Error('网关请求超时(10s)')))
            proxyReq.on('error', (e) => jsonEnd(res, 502, { code: '-1', message: `无法连接网关 ${dest.host}：${e.message}` }))
            proxyReq.write(formBody)
            proxyReq.end()
          } catch (e) {
            jsonEnd(res, 400, { code: '-1', message: '代理参数错误：' + e.message })
          }
        })
      })
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), gatewayMiddleware()],
  server: {
    port: 5177
  }
})
