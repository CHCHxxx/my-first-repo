// ============================================================
// 百度网盘转存模块 — Puppeteer 自动化
// ============================================================

const puppeteer = require('puppeteer');
const config = require('../config');
const logger = require('./logger');

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// 要保存到的目标文件夹路径
const SAVE_PATH = ['我的资源', 'nino'];

/**
 * 尝试多种方式点击元素：XPath 文本 + CSS 选择器
 */
async function smartClick(page, { texts = [], selectors = [] } = {}) {
  // XPath 文本匹配
  for (const text of texts) {
    const xpaths = [
      `//a[contains(.,'${text}')]`,
      `//*[contains(text(),'${text}')]`,
      `//button[contains(.,'${text}')]`,
      `//div[contains(.,'${text}')]`,
      `//span[contains(.,'${text}')]`,
    ];
    for (const xpath of xpaths) {
      try {
        const els = await page.$x(xpath);
        for (const el of els) {
          const box = await el.boundingBox();
          if (box && box.height > 0 && box.width > 0) {
            const tag = await el.evaluate(e => e.tagName);
            const txt = await el.evaluate(e => (e.innerText || '').slice(0, 30));
            const cl = await el.evaluate(e => (e.className || '').slice(0, 60));
            logger.info(`点击 [${tag}] "${txt}" (${cl})`);
            await el.click({ delay: rand(50, 150) });
            await delay(rand(800, 1500));
            return el;
          }
        }
      } catch (_) {}
    }
  }

  // CSS 选择器
  for (const sel of selectors) {
    try {
      const els = await page.$$(sel);
      for (const el of els) {
        const box = await el.boundingBox();
        if (box && box.height > 0 && box.width > 0) {
          const tag = await el.evaluate(e => e.tagName);
          const txt = await el.evaluate(e => (e.innerText || '').slice(0, 30));
          logger.info(`CSS点击 [${tag}] "${txt}" (${sel})`);
          await el.click({ delay: rand(50, 150) });
          await delay(rand(800, 1500));
          return el;
        }
      }
    } catch (_) {}
  }

  return null;
}

/**
 * 在文件夹选择弹窗中导航到指定路径
 * 弹窗结构：ul.treeview > li > div.treeview-node > span.treeview-txt
 */
async function navigateToFolder(page, pathParts) {
  logger.info(`导航到文件夹: ${pathParts.join(' > ')}`);

  for (const folderName of pathParts) {
    // 用 page.evaluate 在浏览器里查找并点击文件夹
    const found = await page.evaluate((name) => {
      // 找所有 treeview-txt 元素
      const nodes = document.querySelectorAll('span.treeview-txt');
      for (const node of nodes) {
        const text = (node.textContent || '').trim();
        // 精确匹配文件夹名
        if (text === name) {
          // 检查父节点是否已展开，如果未展开先展开
          const parentLi = node.closest('li');
          if (parentLi) {
            const ul = parentLi.querySelector(':scope > ul, [class*="treeview"]');
            if (ul && ul.classList.contains('treeview-collapse')) {
              // 点击展开按钮
              const expander = parentLi.querySelector('em.icon-operate.plus');
              if (expander) {
                expander.click();
              }
            }
          }
          // 点击文件夹名选中
          node.click();
          return true;
        }
      }
      return false;
    }, folderName);

    if (found) {
      logger.info(`已选择: ${folderName}`);
      await delay(rand(500, 1000));
    } else {
      logger.warn(`未找到文件夹: ${folderName}`);
    }
  }
}

/**
 * 检查百度网盘登录状态
 */
async function checkLoginStatus(page) {
  logger.info('检查百度网盘登录状态...');
  try {
    await page.goto(config.BAIDUPAN_LOGIN_URL, {
      waitUntil: 'domcontentloaded',
      timeout: config.TIMEOUT.PAGE_LOAD,
    });
    await delay(2000);

    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('passport')) {
      logger.error('未登录百度网盘！请先运行: node src/login-helper.js');
      return false;
    }

    const userIndicator = await page.evaluate(() => {
      const el = document.querySelector('.user-name, .username, [class*="user-name"], [class*="username"]');
      return el ? el.textContent?.trim() : (document.body.innerText.includes('登录') ? null : '已登录');
    });

    if (userIndicator) {
      logger.success(`百度网盘已登录: ${userIndicator}`);
      return true;
    }
    logger.warn('无法确认登录状态，继续尝试...');
    return true;
  } catch (err) {
    logger.error('检查登录状态出错', err);
    return false;
  }
}

/**
 * 保存单个分享链接到自己的网盘
 */
async function save(browser, shareUrl, password) {
  logger.info(`处理: ${shareUrl} ${password ? '(密码: ' + password + ')' : ''}`);

  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 900 });

    // 构建 URL（带密码）
    const navUrl = password && !shareUrl.includes('pwd=')
      ? `${shareUrl}${shareUrl.includes('?') ? '&' : '?'}pwd=${password}`
      : shareUrl;

    logger.info(`导航至分享页...`);
    await page.goto(navUrl, {
      waitUntil: 'networkidle2',
      timeout: config.TIMEOUT.PAGE_LOAD,
    });
    await delay(rand(3000, 4000));

    // 检查错误
    const pageText = await page.evaluate(() => document.body.innerText || '');
    if (pageText.includes('分享的文件已经被删除') || pageText.includes('分享的文件已经被取消了')) {
      throw new Error('分享已失效');
    }
    if (pageText.includes('分享链接中有违规')) throw new Error('分享链接违规');
    if (pageText.includes('访问人数上限')) throw new Error('分享访问人数超限');

    // 处理提取码
    if (pageText.includes('请输入提取码') || pageText.includes('请输入密码')) {
      logger.info('输入提取码...');
      if (!password) throw new Error('需要提取码但未提供');

      let inputFound = false;
      for (const sel of ['input[placeholder*="提取码"]', 'input[placeholder*="密码"]', 'input[name="pwd"]', 'input[type="text"]']) {
        const input = await page.$(sel);
        if (input) {
          await input.click({ clickCount: 3 });
          await delay(100);
          for (const char of password) await input.type(char, { delay: rand(80, 150) });
          await delay(500);
          inputFound = true;
          break;
        }
      }
      if (!inputFound) throw new Error('找不到提取码输入框');

      await smartClick(page, {
        texts: ['提取文件', '提交', '确定'],
        selectors: ['a.submit-btn', '.pickpw-submit-btn', 'a[class*="submit"]'],
      });
      await delay(rand(2000, 4000));

      const afterPwd = await page.evaluate(() => document.body.innerText || '');
      if (afterPwd.includes('提取码错误') || afterPwd.includes('密码错误')) {
        throw new Error('提取码错误');
      }
    }

    await delay(1500);

    // ============================================================
    // 第一步：打开文件夹选择器（底部栏路径区域）
    // ============================================================
    logger.info('打开文件夹选择器...');

    // 滚到底部
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(1000);

    // 点击底部栏的路径选择区域（ "保存到：我的网盘"）
    await smartClick(page, {
      texts: ['保存到：'],
      selectors: [
        '.bottom-save-path-wrap',
        '[class*="save-path"]',
      ],
    });

    await delay(2500);

    // 检查文件夹弹窗
    const dialogEl = await page.$('.dialog-fileTreeDialog, [class*="fileTreeDialog"]');
    if (dialogEl) {
      logger.info('文件夹选择弹窗已打开');

      // 导航到目标文件夹
      await navigateToFolder(page, SAVE_PATH);
      await delay(500);

      // 点击确定
      await smartClick(page, {
        texts: ['确定'],
        selectors: [
          '.dialog-fileTreeDialog .dialog-footer a',
          '.dialog-footer a',
          'a[class*="confirm"]',
          '.dialog-submit',
        ],
      });
      await delay(1500);
      logger.info('已选择文件夹: ' + SAVE_PATH.join(' > '));
    } else {
      logger.info('文件夹选择器未打开，将保存到默认位置');
    }

    // ============================================================
    // 第二步：点击「保存到网盘」
    // ============================================================
    logger.info('点击「保存到网盘」...');

    const clicked = await smartClick(page, {
      texts: ['保存到网盘', '保存至网盘'],
      selectors: [
        'a.tools-share-save-hb',
        'a.save_btn',
        'a.bottom_save_btn',
        'a[class*="save_btn"]',
      ],
    });

    if (!clicked) throw new Error('未找到「保存到网盘」按钮');

    await delay(rand(2000, 3000));

    // 检查成功提示
    await delay(1500);
    const finalText = await page.evaluate(() => document.body.innerText || '');
    const successWords = ['保存成功', '已保存', '已添加', '保存文件成功', '转存成功'];

    if (successWords.some(s => finalText.includes(s))) {
      logger.success(`保存成功！ ${shareUrl}`);
      return { success: true, url: shareUrl };
    }

    // 点了弹窗确定+保存按钮，算成功
    if (dialogEl) {
      logger.success(`保存完成 ${shareUrl}`);
      return { success: true, url: shareUrl };
    }

    logger.warn(`保存结果无法确认，但无报错: ${shareUrl}`);
    return { success: true, url: shareUrl };

  } catch (err) {
    logger.error(`保存失败: ${shareUrl}`, err);
    return { success: false, url: shareUrl, error: err.message };
  } finally {
    await page.close();
  }
}

/**
 * 批量保存
 */
async function saveAll(links) {
  if (!links || links.length === 0) {
    logger.info('没有需要保存的链接');
    return [];
  }

  logger.info(`准备处理 ${links.length} 个链接`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: config.PUPPETEER.headless,
      defaultViewport: config.PUPPETEER.defaultViewport,
      userDataDir: config.BROWSER_PROFILE,
      executablePath: config.CHROME_PATH,
      args: config.PUPPETEER.args,
    });
  } catch (err) {
    logger.error('无法启动浏览器', err);
    return links.map(l => ({ success: false, url: l.url, error: '浏览器启动失败' }));
  }

  const results = [];
  try {
    const loginPage = await browser.newPage();
    const loggedIn = await checkLoginStatus(loginPage);
    await loginPage.close();

    if (!loggedIn) {
      logger.error('百度网盘未登录，请先运行: node src/login-helper.js');
      await browser.close();
      return links.map(l => ({ success: false, url: l.url, error: '未登录' }));
    }

    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      logger.info(`[${i + 1}/${links.length}] ${link.url}`);

      let result = await save(browser, link.url, link.password);
      if (!result.success && config.MAX_RETRIES > 0) {
        logger.info(`重试: ${link.url}`);
        await delay(rand(2000, 4000));
        result = await save(browser, link.url, link.password);
      }
      results.push(result);
      if (i < links.length - 1) await delay(rand(1500, 3000));
    }
  } finally {
    await browser.close();
    logger.info('浏览器已关闭');
  }

  return results;
}

module.exports = { save, saveAll, checkLoginStatus };
