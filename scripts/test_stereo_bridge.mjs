import { chromium } from 'playwright';

async function test() {
  console.log('Launching browser to test arena with stereo bridge...');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const context = await browser.newContext();
  const page = await context.newPage();

  const logs = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => logs.push(`[ERROR] ${err.message}`));

  try {
    await page.goto('http://localhost:5173/arena.html', { waitUntil: 'domcontentloaded', timeout: 15000 });
    console.log('Page loaded!');

    // Wait for vision source select
    await page.waitForSelector('#visionSource', { timeout: 10000 });
    console.log('Found #visionSource!');

    // Check options
    const options = await page.$$eval('#visionSource option', opts => opts.map(o => o.value));
    console.log('Available vision sources:', options);

    // Select Touch+ stereo snapshot
    console.log('Selecting touchplus_latest...');
    await page.selectOption('#visionSource', 'touchplus_latest');

    // Wait 2 seconds for processing
    await page.waitForTimeout(2000);

    // Select looming threat
    console.log('Selecting loom stimulus...');
    await page.selectOption('#visionSource', 'loom');
    await page.waitForTimeout(1000);

    // Select optomotor grating
    console.log('Selecting grating stimulus...');
    await page.selectOption('#visionSource', 'grating');
    await page.waitForTimeout(1000);

    console.log('SUCCESS: All stereo vision sources tested without error!');
  } catch (err) {
    console.error('Test failed:', err);
    console.log('Page logs:', logs.slice(-20));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

test();
