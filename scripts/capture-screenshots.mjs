import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUTPUT_DIR = path.resolve('assets/screenshots');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function capture() {
  console.log('Launching Chrome from:', CHROME_PATH);
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    defaultViewport: {
      width: 1440,
      height: 960,
      deviceScaleFactor: 2, // 2x Retina clarity
    },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--force-device-scale-factor=2',
      '--hide-scrollbars',
    ],
  });

  const page = await browser.newPage();

  const snap = async (filename, waitTime = 1000) => {
    await new Promise((r) => setTimeout(r, waitTime));
    const targetPath = path.join(OUTPUT_DIR, filename);
    await page.screenshot({ path: targetPath, fullPage: false });
    console.log(`Saved screenshot: ${filename}`);
  };

  try {
    // 1. Overview / Dashboard Top View
    console.log('Navigating to http://localhost:3000 (Dashboard Top)...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    await page.waitForSelector('#tab-dashboard', { timeout: 10000 });
    await page.click('#tab-dashboard');
    await snap('01-executive-dashboard.png', 1200);

    // 1b. Dashboard Scrolled: Governance Modules & Recent Interceptions
    console.log('Scrolling Dashboard to Governance Modules...');
    await page.evaluate(() => window.scrollTo({ top: 480, behavior: 'instant' }));
    await snap('01b-dashboard-governance-modules.png', 1000);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));

    // 2. Live Stream / Feed Tab
    console.log('Navigating to Live Stream tab...');
    await page.click('#tab-live-feed');
    await new Promise((r) => setTimeout(r, 1000));
    const interactionHeader = await page.$(
      '[id^="interaction-"] > div:first-child',
    );
    if (interactionHeader) {
      console.log('Expanding first interaction card in live feed...');
      await interactionHeader.click();
    }
    await snap('02-live-stream-inspection.png', 1200);

    // 3. Review Queue
    console.log('Navigating to Review Queue tab...');
    await page.click('#tab-review-queue');
    await snap('03-human-review-queue.png', 1200);

    // 4. Policy Studio (Interactive Mode)
    console.log('Navigating to Policy Studio tab...');
    await page.click('#tab-policy-profiles');
    await snap('04-policy-studio-interactive.png', 1200);

    // 5. Policy Studio (YAML Code Mode)
    console.log('Switching to YAML Code view...');
    const yamlButton = await page.evaluateHandle(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find((b) => b.textContent?.includes('YAML Code'));
    });
    if (yamlButton && yamlButton.asElement()) {
      await yamlButton.asElement().click();
      await snap('05-policy-gitops-yaml.png', 1000);
    }

    // 6. Trust Metrics & Tradeoff Curve
    console.log('Navigating to Trust Metrics tab...');
    await page.click('#tab-trust-metrics');
    await snap('06-trust-metrics-tradeoff.png', 1200);

    // 6b. Trust Metrics Scrolled: Confusion Matrix & Drilldown
    console.log('Scrolling Trust Metrics to Confusion Matrix...');
    await page.evaluate(() => window.scrollTo({ top: 480, behavior: 'instant' }));
    await snap('06b-confusion-matrix-drilldown.png', 1000);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));

    // 7. Gateway Playground Modal with Live Execution
    console.log('Opening Gateway Playground modal...');
    const playgroundBtn = await page.$('.group\\/playground');
    if (playgroundBtn) {
      await playgroundBtn.click();
      await new Promise((r) => setTimeout(r, 800));
      // Select scenario "DAN jailbreak"
      const scenarioBtn = await page.evaluateHandle(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.find((b) => b.textContent?.includes('DAN jailbreak'));
      });
      if (scenarioBtn && scenarioBtn.asElement()) {
        await scenarioBtn.asElement().click();
        await new Promise((r) => setTimeout(r, 500));
      }
      // Click "Send through gateway"
      const sendBtn = await page.evaluateHandle(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.find((b) => b.textContent?.includes('Send through gateway'));
      });
      if (sendBtn && sendBtn.asElement()) {
        console.log('Executing prompt through gateway...');
        await sendBtn.asElement().click();
        await new Promise((r) => setTimeout(r, 1200));
      }

      // Open the "Same request from your app (OpenAI SDK / curl)" details
      await page.evaluate(() => {
        const details = document.querySelector('details.group');
        if (details) {
          details.setAttribute('open', '');
          // Scroll the response container down so the commands are in view
          const respContainer = details.parentElement;
          if (respContainer) {
            respContainer.scrollTop = 120;
          }
        }
      });
      await new Promise((r) => setTimeout(r, 600));

      // Click the curl tab to display the command
      const curlBtn = await page.evaluateHandle(() => {
        const details = document.querySelector('details.group');
        if (!details) return null;
        const buttons = Array.from(details.querySelectorAll('button'));
        return buttons.find((b) => b.textContent?.trim() === 'curl');
      });
      if (curlBtn && curlBtn.asElement()) {
        await curlBtn.asElement().click();
        await new Promise((r) => setTimeout(r, 400));
      }

      await snap('07-gateway-playground-interactive.png', 1000);
    }
  } catch (err) {
    console.error('Error during capture:', err);
  } finally {
    await browser.close();
    console.log('Finished capturing all screenshots.');
  }
}

capture();
