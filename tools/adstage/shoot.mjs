// usage: node shoot2.mjs <stage.html> <outprefix> <durationMs> [--shots t1:name1,t2:name2,...]
import { chromium } from 'playwright';
const [file, prefix, durMs] = process.argv.slice(2);
const shotsArg = process.argv.find((a) => a.startsWith('--shots='));
const shots = shotsArg ? shotsArg.slice(8).split(',').map((p) => { const [t, n] = p.split(':'); return [Number(t), n]; }) : null;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-proxy-server'] });
const ctx = await browser.newContext({ viewport: { width: 1080, height: 1350 }, recordVideo: shots ? undefined : { dir: `${prefix}-video`, size: { width: 1080, height: 1350 } } });
const page = await ctx.newPage();
await page.goto(`file://${process.cwd()}/${file}`);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
await page.evaluate(() => window.__START());
if (shots) {
  let prev = 0;
  for (const [t, name] of shots) { await page.waitForTimeout(t - prev); prev = t; await page.screenshot({ path: `${prefix}-${name}.png` }); }
} else {
  await page.waitForTimeout(Number(durMs));
}
const video = shots ? null : page.video();
await ctx.close();
if (video) console.log('VIDEO:', await video.path());
await browser.close();
