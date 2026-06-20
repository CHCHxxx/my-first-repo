// ============================================================
// 微博 → 百度网盘 自动转存 配置文件
// ============================================================

const path = require('path');

const ROOT = __dirname;

module.exports = {
  // ---- 微博相关 ----
  WEIBO_UID: '6588822770',
  WEIBO_KEYWORD: '二宫和也',
  WEIBO_HOURS_BACK: 24, // 检查最近多少小时的帖子

  // ---- 百度网盘相关 ----
  BAIDUPAN_LOGIN_URL: 'https://pan.baidu.com',

  // ---- 路径 ----
  ROOT: ROOT,
  BROWSER_PROFILE: path.join(ROOT, 'browser-profile'),
  DATA_DIR: path.join(ROOT, 'data'),
  LOG_DIR: path.join(ROOT, 'data', 'logs'),
  PROCESSED_FILE: path.join(ROOT, 'data', 'processed.json'),

  // ---- Chrome 路径（使用系统已安装的 Chrome）----
  CHROME_PATH: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',

  // ---- Puppeteer ----
  PUPPETEER: {
    headless: false,            // 百度会检测无头模式，必须有窗口
    defaultViewport: null,      // 跟随窗口大小
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,900',
      '--window-position=100,50',
    ],
  },

  // ---- 超时设置（毫秒）----
  TIMEOUT: {
    WEIBO_API: 15000,           // 微博 API 请求超时
    PAGE_LOAD: 30000,           // 页面加载超时
    SELECTOR: 15000,            // 等待元素超时
    SAVE_CONFIRM: 10000,        // 保存确认等待
  },

  // ---- 重试 ----
  MAX_RETRIES: 1,               // 单个链接失败重试次数
};
