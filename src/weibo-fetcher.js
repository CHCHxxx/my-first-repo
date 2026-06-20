// ============================================================
// 微博获取模块 — m.weibo.cn API + Puppeteer 浏览器回退
// ============================================================

const config = require('../config');
const logger = require('./logger');

const WEIBO_API = 'https://m.weibo.cn/api/container/getIndex';

/**
 * 解析微博的相对时间字符串为 Date 对象
 */
function parseWeiboTime(timeStr) {
  if (!timeStr) return new Date(0);
  const now = new Date();

  if (timeStr === '刚刚') return now;

  const minMatch = timeStr.match(/^(\d+)分钟前$/);
  if (minMatch) return new Date(now.getTime() - parseInt(minMatch[1]) * 60 * 1000);

  const hourMatch = timeStr.match(/^(\d+)小时前$/);
  if (hourMatch) return new Date(now.getTime() - parseInt(hourMatch[1]) * 3600 * 1000);

  if (timeStr.startsWith('昨天')) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const timePart = timeStr.replace('昨天', '').trim();
    const [h, m] = timePart.split(':').map(Number);
    yesterday.setHours(h || 0, m || 0, 0, 0);
    return yesterday;
  }

  const mdMatch = timeStr.match(/^(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (mdMatch) {
    const [, month, day, hour, minute] = mdMatch.map(Number);
    const d = new Date(now.getFullYear(), month - 1, day, hour, minute, 0);
    if (d > now) d.setFullYear(d.getFullYear() - 1);
    return d;
  }

  const d = new Date(timeStr);
  if (!isNaN(d.getTime())) return d;

  return new Date(0);
}

// ============================================================
// 方案 A：HTTP API（快速，优先尝试）
// ============================================================

async function fetchViaApi(uid, hoursBack) {
  const containerId = `107603${uid}`;
  const cutoffTime = new Date(Date.now() - hoursBack * 3600 * 1000);
  logger.info('尝试 HTTP API 方式获取微博...');

  const allPosts = [];
  let page = 1;
  let stop = false;

  while (!stop) {
    const url = `${WEIBO_API}?type=uid&value=${uid}&containerid=${containerId}&page=${page}`;

    let response;
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Referer': `https://m.weibo.cn/u/${uid}`,
          'X-Requested-With': 'XMLHttpRequest',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
        signal: AbortSignal.timeout(config.TIMEOUT.WEIBO_API),
      });
    } catch (err) {
      logger.warn(`API 请求失败 (page=${page}): ${err.message}`);
      break;
    }

    if (!response.ok) {
      logger.warn(`API 返回 HTTP ${response.status}，切换到浏览器模式`);
      return null;
    }

    let data;
    try { data = await response.json(); } catch {
      logger.warn('API 返回 JSON 解析失败');
      return null;
    }

    if (data.ok !== 1) return null;

    const cards = data.data?.cards || [];
    if (cards.length === 0) break;

    let oldestTimeInPage = null;

    for (const card of cards) {
      if (card.card_type !== 9 || !card.mblog) continue;
      const mblog = card.mblog;
      const post = {
        id: mblog.id || '',
        text: mblog.text || '',
        created_at: mblog.created_at || '',
        time: parseWeiboTime(mblog.created_at),
        permalink: mblog.scheme || `https://m.weibo.cn/status/${mblog.id}`,
      };
      if (!oldestTimeInPage || post.time < oldestTimeInPage) oldestTimeInPage = post.time;
      if (post.time < cutoffTime) { stop = true; break; }
      allPosts.push(post);
    }

    logger.info(`API 第${page}页: 收集 ${allPosts.length} 条`);
    page++;
    if (!stop && oldestTimeInPage && oldestTimeInPage >= cutoffTime) {
      if (page > 10) { logger.info('已达最大翻页数'); break; }
    } else if (!stop) { stop = true; }
    await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
  }

  return allPosts;
}

// ============================================================
// 方案 B：Puppeteer 浏览器抓取
// 策略：提取 body 纯文本 → 正则拆分成帖子 → 提取每个帖子附近的链接
// ============================================================

async function fetchViaBrowser(puppeteer, uid, hoursBack) {
  const cutoffTime = new Date(Date.now() - hoursBack * 3600 * 1000);
  logger.info('使用浏览器模式抓取微博...');

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: config.CHROME_PATH,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=800,1200',
      ],
    });
  } catch (err) {
    logger.error('启动浏览器失败', err);
    return [];
  }

  const allPosts = [];

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
    );
    await page.setViewport({ width: 390, height: 844, isMobile: true });

    logger.info(`导航至 m.weibo.cn/u/${uid}`);
    await page.goto(`https://m.weibo.cn/u/${uid}`, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    await new Promise(r => setTimeout(r, 2000));

    let scrollCount = 0;
    let stop = false;
    const seenIds = new Set();

    while (!stop && scrollCount < 12) {
      // 核心提取：遍历所有卡片，提取每个卡片的文本和链接
      const cardData = await page.evaluate(() => {
        const results = [];

        // m.weibo.cn 的卡片结构：class 含 "card" 的 div，内部有文本和链接
        // 选取策略：找所有 class 包含 card 的 div，按文档顺序
        const cards = document.querySelectorAll('div[class*="card"]');
        const processedTexts = new Set();

        cards.forEach(card => {
          const text = card.innerText?.trim();
          // 跳过太短的（可能是导航等）
          if (!text || text.length < 30) return;
          // 去重（同一个帖子可能被多个 card div 包裹）
          const key = text.slice(0, 60);
          if (processedTexts.has(key)) return;
          processedTexts.add(key);

          // 提取这个卡片内所有 sinaurl 链接（解码后的真实 URL）
          const links = [];
          card.querySelectorAll('a[href*="sinaurl"]').forEach(a => {
            try {
              const urlObj = new URL(a.href);
              const u = urlObj.searchParams.get('u');
              if (u) links.push(decodeURIComponent(u));
            } catch (_) {}
          });

          // 也提取直接包含 pan.baidu.com 的链接
          card.querySelectorAll('a[href*="pan.baidu.com"]').forEach(a => {
            if (!links.includes(a.href)) links.push(a.href);
          });

          results.push({ text, links });
        });

        return results;
      });

      // 处理提取结果
      let newCount = 0;
      for (const card of cardData) {
        // 提取时间
        const timeMatch = card.text.match(/(?:昨天\s*\d{2}:\d{2}|\d{1,2}-\d{1,2}\s+\d{2}:\d{2}|\d+分钟前|\d+小时前|刚刚)/);
        const timeStr = timeMatch ? timeMatch[0] : '';
        const postTime = parseWeiboTime(timeStr);

        if (postTime.getTime() === 0 || postTime < cutoffTime) {
          if (postTime.getTime() > 0 && postTime < cutoffTime) stop = true;
          continue;
        }

        // 生成唯一 ID
        const id = card.text.slice(0, 100).replace(/[^a-zA-Z0-9一-鿿]/g, '').slice(0, 32);
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        newCount++;

        // 将解码后的链接插入文本，替换 "网页链接" 占位
        let enrichedText = card.text;
        if (card.links.length > 0) {
          // 链接在文本中以 "BD：网页链接" / "KK：网页链接" 等形式出现
          // 把真实的 URL 附加到文本后面，方便 link-extractor 提取
          enrichedText += '\n' + card.links.map(l => `链接: ${l}`).join('\n');
        }

        allPosts.push({
          id,
          text: enrichedText,
          created_at: timeStr,
          time: postTime,
          permalink: `https://m.weibo.cn/u/${uid}`,
        });
      }

      logger.info(`浏览器模式: 滚动${scrollCount + 1}次, +${newCount}条, 共${allPosts.length}条`);

      if (!stop) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 1000));
        scrollCount++;
      }
    }

  } catch (err) {
    logger.error('浏览器抓取出错', err);
  } finally {
    await browser.close();
  }

  return allPosts;
}

// ============================================================
// 主入口：API 优先，失败则用浏览器回退
// ============================================================

async function fetchRecentPosts(uid, hoursBack) {
  const cutoffTime = new Date(Date.now() - hoursBack * 3600 * 1000);
  logger.info(`获取微博帖子, uid=${uid}, 回溯${hoursBack}小时, 截止=${cutoffTime.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);

  const apiResult = await fetchViaApi(uid, hoursBack);

  if (apiResult !== null && apiResult.length > 0) {
    logger.info(`API 模式获取到 ${apiResult.length} 条帖子`);
    return apiResult;
  }

  if (apiResult !== null && apiResult.length === 0) {
    logger.info('API 模式未获取到24h内帖子');
    return [];
  }

  logger.info('API 不可用，切换到浏览器抓取模式...');
  const puppeteer = require('puppeteer');
  const browserResult = await fetchViaBrowser(puppeteer, uid, hoursBack);
  logger.info(`浏览器模式获取到 ${browserResult.length} 条帖子`);

  return browserResult;
}

module.exports = { fetchRecentPosts, parseWeiboTime };
