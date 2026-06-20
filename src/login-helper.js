// ============================================================
// 登录辅助 — 手动打开浏览器登录百度网盘，保存登录态
// 直接运行: node src/login-helper.js
// ============================================================

const puppeteer = require('puppeteer');
const config = require('../config');
const logger = require('./logger');

async function main() {
  console.log('');
  console.log('='.repeat(55));
  console.log('  百度网盘登录助手');
  console.log('='.repeat(55));
  console.log('');
  console.log('即将打开浏览器，请在浏览器中手动登录百度网盘。');
  console.log('登录成功后，关闭浏览器窗口即可。');
  console.log('登录状态会保存在 browser-profile 目录中。');
  console.log('');

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      userDataDir: config.BROWSER_PROFILE,
      executablePath: config.CHROME_PATH,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1280,900',
        '--window-position=200,100',
      ],
    });

    const page = await browser.newPage();
    await page.goto('https://pan.baidu.com', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    console.log('浏览器已打开，请在浏览器窗口中操作。');
    console.log('');
    console.log('操作步骤：');
    console.log('  1. 点击右上角"登录"');
    console.log('  2. 使用你的百度账号登录（手机扫码或账号密码）');
    console.log('  3. 登录成功后，确认能看到你的网盘文件列表');
    console.log('  4. 直接关闭浏览器窗口');
    console.log('');

    // 等待浏览器被关闭
    await new Promise((resolve) => {
      browser.on('disconnected', () => {
        console.log('');
        console.log('浏览器已关闭，登录态已保存。');
        console.log('');
        console.log('可以通过以下命令测试:');
        console.log('  node src/index.js');
        console.log('');
        resolve();
      });
    });

  } catch (err) {
    logger.error('登录助手出错', err);
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
  }
}

main();
