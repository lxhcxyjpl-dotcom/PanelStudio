import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
const {chromium}=createRequire(new URL('../package.json',import.meta.url))('playwright');
const out=process.argv[2];if(!out)throw new Error('Pass an output directory');mkdirSync(out,{recursive:true});
const base=process.env.PANELSTUDIO_PREVIEW_URL||'http://127.0.0.1:5283';
const browser=await chromium.launch({channel:process.env.PANELSTUDIO_E2E_CHANNEL||'msedge',headless:true});
for(const [name,locale,theme,width,height] of [['desktop','zh-CN','light',1440,900],['english','en-US','light',1280,800],['dark','zh-CN','dark',1024,768],['mobile','en-US','dark',390,844]]){
 const ctx=await browser.newContext({viewport:{width,height}});
 await ctx.addInitScript(p=>localStorage.setItem('panelstudio.prefs',JSON.stringify(p)),{locale,theme,motion:'on'});
 const page=await ctx.newPage();await page.goto(base);await page.locator('.hero-showcase img').waitFor();
 await page.locator('[data-action=choose-example]').first().click();
 await page.locator('#examples').scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>[...document.querySelectorAll('.brand-example-image img')].every(img=>img.complete&&img.naturalWidth>0));
 await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:path.join(out,'home-'+name+'.png')});
 if(name==='desktop')await page.screenshot({path:path.join(out,'home-complete.png'),fullPage:true});
 await page.locator('[data-action=open-scientific-example]').first().click();await page.locator('.panel-frame').first().waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('.panel-artwork img')].every(img=>img.complete&&img.naturalWidth>0));
 await page.screenshot({path:path.join(out,'editor-'+name+'.png')});
 if(name==='desktop'){
  await page.getByTestId('layout-button').click();await page.getByTestId('candidate-card').first().locator('img').waitFor();
  await page.screenshot({path:path.join(out,'arrange.png')});
  await page.getByTestId('export-button').click();await page.getByRole('dialog').waitFor();await page.screenshot({path:path.join(out,'export.png')});
 }
 await ctx.close();
}
const page=await browser.newPage({viewport:{width:1200,height:630}});await page.goto(base);
const imageBytes=readFileSync(new URL('../apps/web/public/showcase/single-cell.png',import.meta.url));
await page.setContent(`<style>@font-face{font-family:Newsreader;src:url('${base}/brand-fonts/Newsreader-latin.woff2')}@font-face{font-family:Inter;src:url('${base}/brand-fonts/Inter-latin.woff2')}*{box-sizing:border-box}body{margin:0;background:#F7F7F5;color:#252525;font:15px Inter}main{height:630px;padding:54px 58px;display:grid;grid-template-columns:440px 1fr;gap:35px;align-items:center}.brand{font:24px Newsreader;display:flex;gap:12px;align-items:center}.mark{display:grid;grid-template:12px 11px/12px 11px;gap:3px}.mark i{background:#252525}.mark i:first-child{grid-row:span 2}.mark i:last-child{background:#C47755}h1{font:56px/1.08 Newsreader;letter-spacing:-.035em;margin:55px 0 24px}p{line-height:1.8}.art{width:100%;background:white;padding:20px;box-shadow:0 2px 14px #00000014}.art img{width:100%}.caption{font-size:13px;color:#666;margin-top:18px}</style><main><section><div class=brand><span class=mark><i></i><i></i><i></i></span>PanelStudio</div><h1>Your research,<br>beautifully arranged.</h1><p>Arrange scientific panels. Refine every detail.<br>Export editable SVG for Illustrator.</p></section><section><div class=art><img src='data:image/png;base64,${imageBytes.toString('base64')}'></div><p class=caption>Original synthetic demonstration data</p></section></main>`);
await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(out,'social-preview.png')});
await browser.close();console.log(out);
