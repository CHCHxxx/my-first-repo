// ============================================================
// 日志模块 — 同时输出到控制台和文件
// ============================================================

const fs = require('fs');
const path = require('path');
const config = require('../config');

// 确保日志目录存在
if (!fs.existsSync(config.LOG_DIR)) {
  fs.mkdirSync(config.LOG_DIR, { recursive: true });
}

// 日志文件路径：data/logs/run-2026-06-20.log
const today = new Date().toISOString().slice(0, 10);
const logFilePath = path.join(config.LOG_DIR, `run-${today}.log`);

// 时间戳格式化
function ts() {
  return new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// 写入日志文件
function writeFile(level, message, meta) {
  try {
    let line = `[${ts()}] ${level}  ${message}`;
    if (meta !== undefined) {
      if (meta instanceof Error) {
        line += `\n  Error: ${meta.message}`;
        if (meta.stack) line += `\n  Stack: ${meta.stack}`;
      } else if (typeof meta === 'object') {
        line += `\n  ${JSON.stringify(meta, null, 2).split('\n').join('\n  ')}`;
      } else {
        line += ` ${meta}`;
      }
    }
    line += '\n';
    fs.appendFileSync(logFilePath, line, 'utf-8');
  } catch (_) {
    // 写文件失败就忽略，不要因为日志导致主流程崩溃
  }
}

const logger = {
  info(message, meta) {
    console.log(`[${ts()}] ℹ ${message}`);
    writeFile('INFO', message, meta);
  },

  warn(message, meta) {
    console.warn(`[${ts()}] ⚠ ${message}`);
    writeFile('WARN', message, meta);
  },

  error(message, meta) {
    console.error(`[${ts()}] ✖ ${message}`);
    writeFile('ERROR', message, meta);
  },

  success(message, meta) {
    console.log(`[${ts()}] ✔ ${message}`);
    writeFile('OK', message, meta);
  },

  summary(stats) {
    const lines = [
      '',
      '='.repeat(60),
      '  运行摘要',
      '='.repeat(60),
      `  检查帖子数: ${stats.postsChecked}`,
      `  匹配关键词: ${stats.postsMatched}`,
      `  找到链接数: ${stats.linksFound}`,
      `  成功保存数: ${stats.linksSaved}`,
      `  失败数量:   ${stats.errors}`,
      `  跳过(已处理): ${stats.skipped}`,
      '='.repeat(60),
    ];
    const text = lines.join('\n');
    console.log(text);
    writeFile('SUMMARY', text);
  },

  getLogFile() {
    return logFilePath;
  },
};

module.exports = logger;
