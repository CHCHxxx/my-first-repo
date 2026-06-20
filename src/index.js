// ============================================================
// 主入口 — 微博检查 + 百度网盘自动转存
// 每天 12:00 由 Windows 任务计划触发
// 支持补跑：如果几天没执行，自动回溯检查期间所有帖子
// ============================================================

const fs = require('fs');
const config = require('../config');
const logger = require('./logger');
const { fetchRecentPosts } = require('./weibo-fetcher');
const { extractLinks } = require('./link-extractor');
const { saveAll } = require('./baidupan-saver');

// ============================================================
// 去重管理
// ============================================================

function loadProcessed() {
  try {
    if (fs.existsSync(config.PROCESSED_FILE)) {
      const raw = fs.readFileSync(config.PROCESSED_FILE, 'utf-8');
      return new Set(JSON.parse(raw));
    }
  } catch (err) {
    logger.warn('读取 processed.json 失败，将创建新的', err);
  }
  return new Set();
}

function saveProcessed(set) {
  try {
    fs.writeFileSync(config.PROCESSED_FILE, JSON.stringify([...set], null, 2), 'utf-8');
  } catch (err) {
    logger.error('写入 processed.json 失败', err);
  }
}

// ============================================================
// 上次运行时间管理 — 用于计算需要回溯多少小时
// ============================================================

const LAST_RUN_FILE = config.DATA_DIR + '/last-run.json';

function loadLastRun() {
  try {
    if (fs.existsSync(LAST_RUN_FILE)) {
      const data = JSON.parse(fs.readFileSync(LAST_RUN_FILE, 'utf-8'));
      return new Date(data.lastRun);
    }
  } catch (err) {
    logger.warn('读取 last-run.json 失败', err);
  }
  return null; // 从未运行过
}

function saveLastRun(date) {
  try {
    fs.writeFileSync(LAST_RUN_FILE, JSON.stringify({ lastRun: date.toISOString() }), 'utf-8');
  } catch (err) {
    logger.error('写入 last-run.json 失败', err);
  }
}

/**
 * 计算需要回溯的小时数
 * - 从未运行过 → 用默认 24 小时
 * - 距上次运行 < 24h → 用 24 小时（正常每日运行）
 * - 距上次运行 > 24h → 回溯实际间隔 + 1 小时缓冲，最多 7 天
 */
function calculateHoursBack(lastRun) {
  if (!lastRun) {
    logger.info('首次运行，回溯默认 24 小时');
    return config.WEIBO_HOURS_BACK;
  }

  const now = new Date();
  const hoursSinceLastRun = (now.getTime() - lastRun.getTime()) / (1000 * 3600);

  if (hoursSinceLastRun <= config.WEIBO_HOURS_BACK) {
    logger.info(`距上次运行 ${hoursSinceLastRun.toFixed(1)} 小时，回溯默认 24 小时`);
    return config.WEIBO_HOURS_BACK;
  }

  // 有间隔，需要补跑
  const daysMissed = Math.floor(hoursSinceLastRun / 24);
  const hoursBack = Math.min(hoursSinceLastRun + 1, 168); // 最多回溯 7 天（168 小时）
  logger.info(`⚠ 距上次运行 ${hoursSinceLastRun.toFixed(1)} 小时（约 ${daysMissed} 天），回溯 ${hoursBack.toFixed(0)} 小时`);
  return Math.ceil(hoursBack);
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  const runStart = Date.now();
  logger.info('='.repeat(55));
  logger.info('微博 → 百度网盘 自动转存 开始运行');
  logger.info('='.repeat(55));

  // 统计
  const stats = {
    postsChecked: 0,
    postsMatched: 0,
    linksFound: 0,
    linksSaved: 0,
    errors: 0,
    skipped: 0,
  };

  // 加载已处理列表
  const processed = loadProcessed();
  logger.info(`已处理帖子数: ${processed.size}`);

  // 计算回溯时间
  const lastRun = loadLastRun();
  if (lastRun) {
    logger.info(`上次运行: ${lastRun.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  } else {
    logger.info('首次运行（无历史记录）');
  }
  const hoursBack = calculateHoursBack(lastRun);

  try {
    // === 第一步：获取微博帖子 ===
    logger.info('--- 第一步：获取微博帖子 ---');
    let posts;
    try {
      posts = await fetchRecentPosts(config.WEIBO_UID, hoursBack);
    } catch (err) {
      logger.error('获取微博帖子失败，无法继续', err);
      return;
    }

    stats.postsChecked = posts.length;

    if (posts.length === 0) {
      logger.info('没有获取到帖子，退出');
      // 即使没帖子也更新最后运行时间
      saveLastRun(new Date());
      logger.summary(stats);
      return;
    }

    // === 第二步：筛选含关键词的帖子 ===
    logger.info(`--- 第二步：筛选含「${config.WEIBO_KEYWORD}」的帖子 ---`);
    const matchedPosts = posts.filter(post => {
      const plainText = post.text.replace(/<[^>]+>/g, '');
      return plainText.includes(config.WEIBO_KEYWORD);
    });

    stats.postsMatched = matchedPosts.length;
    logger.info(`找到 ${matchedPosts.length} 条含「${config.WEIBO_KEYWORD}」的帖子`);

    if (matchedPosts.length === 0) {
      logger.info('没有匹配的帖子，退出');
      saveLastRun(new Date());
      logger.summary(stats);
      return;
    }

    // === 第三步：提取百度网盘链接 ===
    logger.info('--- 第三步：提取百度网盘链接 ---');
    const allLinks = [];

    for (const post of matchedPosts) {
      if (processed.has(post.id)) {
        logger.info(`帖子 ${post.id.slice(-8)} 已处理过，跳过`);
        stats.skipped++;
        continue;
      }

      const links = extractLinks(post.text);
      if (links.length > 0) {
        logger.info(`帖子 ${post.id.slice(-8)} (${post.created_at}): 找到 ${links.length} 个链接`);
        for (const link of links) {
          allLinks.push({
            ...link,
            postId: post.id,
            permalink: post.permalink,
            created_at: post.created_at,
          });
        }
      } else {
        logger.info(`帖子 ${post.id.slice(-8)} (${post.created_at}): 未找到百度网盘链接`);
      }
    }

    stats.linksFound = allLinks.length;
    logger.info(`共提取 ${allLinks.length} 个新百度网盘链接`);

    if (allLinks.length === 0) {
      logger.info('没有新链接需要处理');
      // 标记所有检查过的匹配帖子为已处理
      for (const post of matchedPosts) {
        if (!processed.has(post.id)) processed.add(post.id);
      }
      saveProcessed(processed);
      saveLastRun(new Date());
      logger.summary(stats);
      return;
    }

    // 打印找到的链接
    for (const link of allLinks) {
      logger.info(`  → ${link.url} ${link.password ? '(提取码: ' + link.password + ')' : '(无密码)'}`);
    }

    // === 第四步：保存到百度网盘 ===
    logger.info('--- 第四步：自动转存到百度网盘 ---');
    const results = await saveAll(allLinks);

    // 统计结果
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const link = allLinks[i];

      if (result.success) {
        stats.linksSaved++;
        processed.add(link.postId);
      } else {
        stats.errors++;
        logger.warn(`链接保存失败，帖子不标记为已处理，下次会重试: ${result.url}`);
      }
    }

  } catch (err) {
    logger.error('主流程异常', err);
    stats.errors++;
  }

  // === 保存状态 ===
  saveProcessed(processed);
  saveLastRun(new Date());

  // === 输出摘要 ===
  const elapsed = ((Date.now() - runStart) / 1000).toFixed(1);
  logger.info(`总耗时: ${elapsed} 秒`);
  logger.summary(stats);
  logger.info('运行结束。');
}

// 运行
main().catch(err => {
  logger.error('致命错误', err);
  process.exitCode = 1;
});
