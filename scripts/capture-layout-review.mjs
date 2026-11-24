import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

// Run against a local preview with a dedicated demo database. Both sizes open
// independent copies of the same six-panel sample through the normal UI.
const [base, output, videoFlag] = process.argv.slice(2);
if (!output || !['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw Error('Pass the local preview URL and an output folder.');
await mkdir(output, { recursive: true });
// Use a short workspace path for Chrome's temporary downloads on Windows.
const downloadsPath = path.resolve('test-results/review-downloads');
await mkdir(downloadsPath,{recursive:true});
const browser = await chromium.launch({ channel: process.env.PANELSTUDIO_E2E_CHANNEL || 'chrome', downloadsPath });
try {
  for (const [width,height] of [[1440,900],[390,844]]) {
    const viewport = {width,height}, mobile = width < 600, film = videoFlag === '--video' && !mobile;
    const ctx = await browser.newContext({ viewport, locale:'zh-CN', acceptDownloads:true, ...(film ? {recordVideo:{dir:path.join(output,'raw'),size:viewport}} : {}) });
    await ctx.addInitScript(() => localStorage.setItem('panelstudio.prefs', JSON.stringify({theme:'light',locale:'zh-CN',motion:'on'})));
    const page = await ctx.newPage(), video = page.video(), errors=[];
    page.setDefaultTimeout(15000);
    page.on('pageerror', err => errors.push(err.message));
    const act = id => page.locator(`[data-action="${id}"]:visible`).first();
    const cards = page.getByTestId('candidate-card');
    const pause = ms => film ? page.waitForTimeout(ms) : Promise.resolve();
    const snap = async name => {
      await page.evaluate(() => document.fonts.ready); await page.mouse.move(2,2);
      await page.screenshot({path:path.join(output, `${name}-${width}.png`), animations:'disabled'});
      await pause(name.startsWith('12-') ? 1700 : 1200);
    };
    const exportSvg = async (filename, expectedRevision) => {
      const ready = page.waitForEvent('download');
      await act('export-svg').click(); const dest = path.join(output,filename);
      await (await ready).saveAs(dest); const bytes = await readFile(dest);
      const revision = await page.evaluate(svg => JSON.parse(new DOMParser().parseFromString(svg,'image/svg+xml').querySelector('metadata').textContent).revision,bytes.toString('utf8'));
      assert.equal(revision,expectedRevision); await act('download-again').waitFor();
    };
    await page.goto(base); await act('home-gallery').click(); await act('open-scientific-example').click();
    await page.locator('.panel-frame').nth(5).waitFor();
    const docUrl = new URL(`/api/v1/projects/${new URL(page.url()).pathname.split('/').at(-1)}/document`, base).href;
    const read = async () => (await page.request.get(docUrl)).json();
    const saved = await read();
    await act(mobile ? 'mobile-refine' : 'tab-ai').click(); await act('publication-context').click();
    await snap('10-brief'); await act('skip-publication').click();
    if (mobile) await act('close-inspector').click();
    await act('layout-tools').click(); await act('guided-layout').click(); await snap('11-guide');
    await page.getByTestId('guide-words').pressSequentially('间距 4 mm', {delay:film ? 90 : 0});
    await snap('11-preferences');
    const manual = page.getByTestId('guide-manual').locator('summary');
    if (await manual.count()) { await manual.click(); await snap('11-manual'); await manual.click(); }
    await act('generate-guided').click();
    await cards.first().locator('img').waitFor(); await cards.nth(1).locator('img').waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="candidate-card"]')].every(card => card.querySelector('img')?.naturalWidth > 0));
    await cards.locator('img').evaluateAll(imgs => Promise.all(imgs.map(i => i.decode())));
    await snap('12-compare'); await cards.nth(1).click(); await snap('12-selected');
    if (await page.getByRole('tab',{name:'候选版式'}).count()) {
      await act('manual-edit').click(); await snap('12-kept');
      assert.equal((await read()).documentHash,saved.documentHash);
      if (mobile) await act('mobile-properties').click();
      await act('tab-layout').click(); assert.equal(await cards.nth(1).getAttribute('aria-pressed'),'true');
      await pause(600);
    }
    if (mobile) await act('close-inspector').click();
    await page.getByTestId('export-button').click(); await snap('14-export');
    assert.equal((await read()).documentHash,saved.documentHash);
    const exportDetails = page.locator('.export-font-details');
    if (await exportDetails.count() && await exportDetails.getAttribute('open') === null) {
      await exportDetails.locator('summary').click(); await snap('14-details'); await exportDetails.locator('summary').click();
    }
    if (film) await exportSvg('saved-before-apply.svg',saved.revision);
    await act('format-png').click(); await snap('14-png'); await act('export-close').click();
    if (mobile) { await act('mobile-properties').click(); await act('tab-layout').click(); }
    await act('apply-layout').click(); await page.waitForFunction(() => document.querySelectorAll('[data-testid="candidate-card"]').length === 0);
    assert.equal((await read()).revision,saved.revision+1);
    if (mobile && await act('close-inspector').count()) await act('close-inspector').click();
    await snap('12-applied');
    if (film) {
      await page.getByTestId('export-button').click(); await snap('14-applied-revision');
      await exportSvg('applied-layout.svg',saved.revision+1);
    }
    assert.deepEqual(errors,[]);
    console.log(`${width}: ${saved.document.panelOrder.length} panels; preview kept r${saved.revision}, applied r${saved.revision+1}. ${page.url()}`);
    await ctx.close(); if(video) await video.saveAs(path.join(output,'walkthrough.webm'));
  }
} finally { await browser.close(); }
