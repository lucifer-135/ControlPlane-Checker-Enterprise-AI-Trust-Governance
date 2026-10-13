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

    // 2. Live Stream / Feed Tab - Top View & Interception Stream
    console.log('Navigating to Live Stream tab...');
    await page.click('#tab-live-feed');
    await new Promise((r) => setTimeout(r, 1000));
    await snap('02-live-stream-inspection.png', 1000);

    // 2b. Multi-Provider LLM Judge Engine with Three Buttons (Gemini, Qwen, Dual Consensus)
    console.log('Expanding interaction card and configuring Multi-Provider Judge...');
    const firstInteraction = await page.$('[id^="interaction-"] > div:first-child');
    if (firstInteraction) {
      await firstInteraction.click();
      await new Promise((r) => setTimeout(r, 800));

      // Select Dual Consensus judge provider
      await page.evaluate(() => {
        const dualBtns = Array.from(document.querySelectorAll('button'));
        const dualBtn = dualBtns.find((b) => b.textContent?.includes('Dual Consensus'));
        if (dualBtn) dualBtn.click();
      });
      await new Promise((r) => setTimeout(r, 500));

      // Trigger the Judge evaluation
      await page.evaluate(() => {
        const judgeBtns = Array.from(document.querySelectorAll('button'));
        const runBtn = judgeBtns.find(
          (b) =>
            b.textContent?.includes('Run Dual Judge') ||
            b.textContent?.includes('Run Local Qwen') ||
            b.textContent?.includes('Evaluate with') ||
            b.textContent?.includes('Judge'),
        );
        if (runBtn) runBtn.click();
      });

      // Wait until the judge evaluation completes
      console.log('Waiting for Judge evaluation to resolve...');
      await page
        .waitForFunction(
          () => {
            const text = document.body.innerText;
            return (
              text.includes('Consensus Verdict') ||
              text.includes('Re-evaluate with Judge') ||
              text.includes('Dual Consensus Adjudication') ||
              text.includes('Score Deltas')
            );
          },
          { timeout: 8000 },
        )
        .catch(() => console.log('Judge wait timed out, continuing...'));

      await new Promise((r) => setTimeout(r, 1500));

      // Scroll inside the interaction so the 3 buttons: Gemini 3.6, Qwen 2.5: 7B, Dual Consensus and Judge results are centered
      await page.evaluate(() => {
        const acc = Array.from(document.querySelectorAll('span')).find((s) =>
          s.textContent?.includes('Session risk accumulator'),
        );
        if (acc) {
          const rect = acc.getBoundingClientRect();
          window.scrollTo({ top: window.scrollY + rect.top - 80, behavior: 'instant' });
        }
      });
      await snap('02b-multi-provider-judge.png', 1200);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    }

    // 3. Human Review Queue with Three Buttons (Confirm Block, Sanitize & Edit, Override to Allow)
    console.log('Navigating directly to Review Queue...');
    await page.click('#tab-review-queue');
    await new Promise((r) => setTimeout(r, 1200));

    // Ensure the first item is expanded
    console.log('Ensuring first item in Review Queue is expanded...');
    await page.evaluate(() => {
      const firstCard = document.querySelector('[id^="queue-item-"]');
      if (firstCard) {
        const toggleBtn = firstCard.querySelector('[role="button"]');
        const isExpanded = toggleBtn?.getAttribute('aria-expanded') === 'true';
        if (!isExpanded && toggleBtn) {
          toggleBtn.click();
        }
      }
    });
    await new Promise((r) => setTimeout(r, 1000));

    // Verify buttons exist
    const triageStatus = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const blockBtn = btns.find((b) => b.textContent?.includes('Confirm Block'));
      const sanitizeBtn = btns.find((b) => b.textContent?.includes('Sanitize & Edit'));
      const allowBtn = btns.find((b) => b.textContent?.includes('Override to Allow'));
      return {
        block: !!blockBtn,
        sanitize: !!sanitizeBtn,
        allow: !!allowBtn,
      };
    });
    console.log('Review Queue triage buttons found:', triageStatus);

    // If not found yet, try clicking directly on the first card
    if (!triageStatus.block) {
      console.log('Triage buttons not visible, attempting Puppeteer click on first card header...');
      const firstHeader = await page.$('[id^="queue-item-"] [role="button"]');
      if (firstHeader) {
        await firstHeader.click();
        await new Promise((r) => setTimeout(r, 1200));
      }
    }

    // Scroll so that the expanded card, prompt, highlighted response, and the 3 action buttons are in view
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const blockBtn = btns.find((b) => b.textContent?.includes('Confirm Block'));
      if (blockBtn) {
        const rect = blockBtn.getBoundingClientRect();
        window.scrollTo({
          top: window.scrollY + rect.top - 760,
          behavior: 'instant',
        });
      }
    });
    await new Promise((r) => setTimeout(r, 800));
    await snap('03-human-review-queue.png', 1200);

    // 3b. Cryptographic Audit Chain Panel (Append-Only Decision Log with Verified Chain)
    // Only click confirm block if we don't already have decisions logged or need to refresh
    console.log('Checking audit chain decisions...');
    const decisionCount = await page.evaluate(() => {
      const rows = document.querySelectorAll('table tbody tr');
      return rows.length;
    });
    if (decisionCount === 0) {
      console.log('Clicking Confirm Block to log a signed decision for audit chain...');
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const blockBtn = btns.find((b) => b.textContent?.includes('Confirm Block'));
        if (blockBtn) blockBtn.click();
      });
      await new Promise((r) => setTimeout(r, 1200));
    }

    console.log('Scrolling Review Queue to Cryptographic Audit Chain...');
    await page.evaluate(() => {
      const auditHeader = Array.from(document.querySelectorAll('h3')).find((h) =>
        h.textContent?.includes('Review Decision Audit Trail'),
      );
      if (auditHeader) {
        const rect = auditHeader.getBoundingClientRect();
        window.scrollTo({ top: window.scrollY + rect.top - 120, behavior: 'instant' });
      } else {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
      }
    });
    await snap('03b-cryptographic-audit-chain.png', 1200);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));

    // 4. Policy Studio (Interactive Mode - Cutoff Sliders)
    console.log('Navigating to Policy Studio tab...');
    await page.click('#tab-policy-profiles');
    await snap('04-policy-studio-interactive.png', 1200);

    // 4b. Four-Tier Policy Enactment (ALLOW, BADGE, SOFT_CORRECT, BLOCK_ESCALATE) of an interaction
    console.log('Capturing Four-Tier Policy Enactment across interaction stream...');
    await page.click('#tab-live-feed');
    await new Promise((r) => setTimeout(r, 1000));

    // Expand interaction #1 to show its verdict tier badge and delivery treatment
    const feedChevron = await page.$(
      '[id^="interaction-"] button[aria-label*="inspection details"]',
    );
    if (feedChevron) {
      await feedChevron.click();
    } else {
      const feedHeader = await page.$('[id^="interaction-"] > div:first-child');
      if (feedHeader) await feedHeader.click();
    }
    await new Promise((r) => setTimeout(r, 1000));

    // Scroll to display the 4-tier filter bar (Allow, Badge, Soft-Correct, Block) and the enacted interaction
    await page.evaluate(() => window.scrollTo({ top: 220, behavior: 'instant' }));
    await snap('04b-four-tier-enactment.png', 1200);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));

    // 5. Policy Studio (YAML Code Mode)
    console.log('Switching to YAML Code view...');
    await page.click('#tab-policy-profiles');
    await new Promise((r) => setTimeout(r, 800));
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
