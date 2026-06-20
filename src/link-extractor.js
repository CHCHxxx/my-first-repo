// ============================================================
// 链接提取模块 — 从微博正文中提取百度网盘链接和提取码
// ============================================================

/**
 * 支持的文本格式（微博常见）：
 *   链接: https://pan.baidu.com/s/1iyG-AvNR7P6BASEWWRQaA 提取码: a5g8
 *   链接：https://pan.baidu.com/s/1g7kTqBl 提取码：1234
 *   通过百度网盘分享的文件：xxxx...链接:https://pan.baidu.com/s/1xxx?pwd=xxxx
 *   https://pan.baidu.com/s/1xxxx 提取码: abcd
 *   pan.baidu.com/s/1xxxx 码:abcd
 *   链接: http://pan.baidu.com/s/1xxxx 密码: 1234
 */

// 匹配百度网盘分享链接（完整 URL）
// 覆盖 https?://pan.baidu.com/s/xxxxx 以及带 ?pwd= 参数的格式
const URL_PATTERN = /https?:\/\/pan\.baidu\.com\/s\/([a-zA-Z0-9\-_]{4,})(?:\?[^?\s]*pwd=([a-zA-Z0-9]{4})[^?\s]*)?/gi;

// 匹配裸域名格式：pan.baidu.com/s/xxxxx
const BARE_URL_PATTERN = /(?:链接[：:]?\s*)?(pan\.baidu\.com\/s\/([a-zA-Z0-9\-_]{4,}))/gi;

// 提取码的模式（按优先级排列）
const PASSWORD_PATTERNS = [
  /提取码[：:]\s*([a-zA-Z0-9]{4})/i,
  /密码[：:]\s*([a-zA-Z0-9]{4})/i,
  /码[：:]\s*([a-zA-Z0-9]{4})/i,
  /提取[：:]\s*([a-zA-Z0-9]{4})/i,
];

/**
 * 从文本中提取所有百度网盘链接及提取码
 * @param {string} text - 微博正文（可能含 HTML）
 * @returns {Array<{url: string, password: string|null}>}
 */
function extractLinks(text) {
  if (!text || typeof text !== 'string') return [];

  // 先把 HTML 标签去掉，保留纯文本
  const plainText = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    // 还原常见的 HTML 实体
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  const found = [];

  // 第一步：找所有完整 URL（https?://pan.baidu.com/s/xxxxx）
  const urlPattern = new RegExp(URL_PATTERN.source, URL_PATTERN.flags);
  let match;
  while ((match = urlPattern.exec(plainText)) !== null) {
    const fullUrl = match[0];
    const pwdFromUrl = match[2] || null; // ?pwd=xxxx 中的密码
    found.push({ url: normalizeUrl(fullUrl), password: pwdFromUrl });
  }

  // 第二步：找裸域名格式（pan.baidu.com/s/xxxxx），排除已被第一步捕获的
  const barePattern = new RegExp(BARE_URL_PATTERN.source, BARE_URL_PATTERN.flags);
  while ((match = barePattern.exec(plainText)) !== null) {
    const normalizedUrl = normalizeUrl(match[1].startsWith('http') ? match[1] : 'https://' + match[1]);
    // 检查是否已经在列表里
    if (!found.some(f => f.url === normalizedUrl)) {
      found.push({ url: normalizedUrl, password: null });
    }
  }

  // 去重（按 URL，忽略 query string 避免 ?pwd=xxx 导致重复）
  const seen = new Set();
  const results = [];
  for (const item of found) {
    // 用 base URL（去掉 query string）做去重 key
    const baseUrl = item.url.split('?')[0];
    if (seen.has(baseUrl)) continue;
    seen.add(baseUrl);

    // 如果 URL 里没带密码，尝试从周围文本提取
    if (!item.password) {
      // 找到该 URL 在原文中的位置，取前后各 100 个字符
      const idx = plainText.indexOf(item.url.replace('https://', '').replace('http://', ''));
      const contextStart = Math.max(0, (idx > 0 ? idx : 0) - 100);
      const contextEnd = Math.min(plainText.length, (idx > 0 ? idx : 0) + item.url.length + 100);
      const context = plainText.slice(contextStart, contextEnd);

      for (const pwdPattern of PASSWORD_PATTERNS) {
        const pwdMatch = context.match(pwdPattern);
        if (pwdMatch) {
          item.password = pwdMatch[1];
          break;
        }
      }
    }

    results.push({ url: item.url, password: item.password || null });
  }

  return results;
}

/**
 * 规范化 URL
 */
function normalizeUrl(url) {
  // 确保以 https:// 开头
  if (!url.startsWith('http')) {
    url = 'https://' + url;
  }
  // 去掉 URL 中可能混入的标点符号
  url = url.replace(/[，。；）、》「」\s]*$/, '');
  // 如果有 ?pwd= 参数，保留；其他 query 参数也保留
  return url;
}

module.exports = { extractLinks };

// ============================================================
// 内置测试（直接运行此文件可测试提取逻辑）
// ============================================================
if (require.main === module) {
  const testCases = [
    {
      text: '链接: https://pan.baidu.com/s/1iyG-AvNR7P6BASEWWRQaA 提取码: a5g8',
      expect: [{ url: 'https://pan.baidu.com/s/1iyG-AvNR7P6BASEWWRQaA', password: 'a5g8' }],
    },
    {
      text: '链接：https://pan.baidu.com/s/1g7kTqBl 提取码：1234',
      expect: [{ url: 'https://pan.baidu.com/s/1g7kTqBl', password: '1234' }],
    },
    {
      text: '通过百度网盘分享的文件：演唱会视频\n链接:https://pan.baidu.com/s/1abc?pwd=xyz1\n复制这段内容打开百度网盘',
      expect: [{ url: 'https://pan.baidu.com/s/1abc?pwd=xyz1', password: 'xyz1' }],
    },
    {
      text: 'https://pan.baidu.com/s/1NINO 提取码: bb66',
      expect: [{ url: 'https://pan.baidu.com/s/1NINO', password: 'bb66' }],
    },
    {
      text: 'pan.baidu.com/s/1test 码:abcd',
      expect: [{ url: 'https://pan.baidu.com/s/1test', password: 'abcd' }],
    },
  ];

  let passed = 0;
  for (const tc of testCases) {
    const result = extractLinks(tc.text);
    const ok =
      result.length === tc.expect.length &&
      result.every((r, i) => r.url === tc.expect[i].url && r.password === tc.expect[i].password);
    console.log(ok ? '✓ PASS' : '✗ FAIL', '→', JSON.stringify(result));
    if (ok) passed++;
  }
  console.log(`\n${passed}/${testCases.length} tests passed`);
}
