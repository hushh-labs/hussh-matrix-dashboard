#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const chromePath = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const dashboardUrl = process.env.DEMO_DASHBOARD_URL || 'https://metrics.hushh.ai';
const outDir = path.resolve(process.env.DEMO_ASSET_DIR || 'artifacts/demo');
const frameDir = path.join(outDir, 'frames');
const port = Number(process.env.DEMO_CHROME_PORT || 9339);
const width = 1920;
const height = 1080;

const shots = [
  { name: '01-opening', tab: 'Overview', scroll: 0 },
  { name: '02-key-metrics', tab: 'Overview', scroll: 360 },
  { name: '03-kai-production', tab: 'Overview', scroll: 900 },
  { name: '04-hushh-ai', tab: 'Overview', scroll: 1580 },
  { name: '05-hushhtech-report', tab: 'Overview', scroll: 2200 },
  { name: '06-hushhtech-database', tab: 'Overview', scroll: 2720 },
  { name: '07-source-health', tab: 'Platforms', scroll: 0 },
  { name: '08-closing', tab: 'Overview', scroll: 0 },
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForJson(url, timeoutMs = 15_000) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function connectToPage() {
  const targets = await waitForJson(`http://127.0.0.1:${port}/json/list`);
  const page = targets.find((target) => target.type === 'page') || targets[0];
  if (!page?.webSocketDebuggerUrl) throw new Error('Chrome DevTools page target was not available');

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) {
      entry.reject(new Error(`${message.error.message}: ${message.error.data || ''}`));
    } else {
      entry.resolve(message.result);
    }
  });

  return {
    send(method, params = {}) {
      const messageId = ++id;
      socket.send(JSON.stringify({ id: messageId, method, params }));
      return new Promise((resolve, reject) => pending.set(messageId, { resolve, reject }));
    },
    close() {
      socket.close();
    },
  };
}

async function waitForDashboard(cdp) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `
        Boolean(
          document.body &&
          document.body.innerText.includes('Analytics control center') &&
          document.body.innerText.includes('Live metrics loaded from connected sources') &&
          !document.body.innerText.includes('Loading live metrics')
        )
      `,
      returnByValue: true,
    });
    if (result.result?.value) return;
    await delay(500);
  }
  throw new Error('Dashboard did not render the expected hero text');
}

async function selectTab(cdp, tabName) {
  await cdp.send('Runtime.evaluate', {
    expression: `
      (() => {
        const button = [...document.querySelectorAll('button')]
          .find((node) => node.textContent.trim().toLowerCase() === '${tabName.toLowerCase()}');
        if (button) button.click();
      })()
    `,
  });
  await delay(500);
}

async function captureShot(cdp, shot) {
  await selectTab(cdp, shot.tab);
  await cdp.send('Runtime.evaluate', {
    expression: `window.scrollTo({ top: ${shot.scroll}, left: 0, behavior: 'instant' })`,
  });
  await delay(900);
  const screenshot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const file = path.join(frameDir, `${shot.name}.png`);
  await writeFile(file, Buffer.from(screenshot.data, 'base64'));
  return file;
}

await mkdir(frameDir, { recursive: true });
await rm(path.join(outDir, 'chrome-profile'), { recursive: true, force: true });

const chrome = spawn(chromePath, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${path.join(outDir, 'chrome-profile')}`,
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  `--window-size=${width},${height}`,
  dashboardUrl,
], { stdio: ['ignore', 'ignore', 'pipe'] });

let stderr = '';
chrome.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

try {
  await waitForJson(`http://127.0.0.1:${port}/json/version`);
  const cdp = await connectToPage();
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: dashboardUrl });
    await delay(2_500);
    await waitForDashboard(cdp);

    const files = [];
    for (const shot of shots) {
      files.push(await captureShot(cdp, shot));
    }

    await writeFile(
      path.join(outDir, 'shots.json'),
      JSON.stringify({ dashboardUrl, width, height, generatedAt: new Date().toISOString(), files }, null, 2),
    );
    console.log(JSON.stringify({ ok: true, outDir, frames: files.length }, null, 2));
  } finally {
    cdp.close();
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    chromeStderr: stderr.slice(-1000),
  }, null, 2));
  process.exitCode = 1;
} finally {
  chrome.kill('SIGTERM');
}
