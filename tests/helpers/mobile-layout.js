import assert from 'node:assert/strict';

// Uses the page's real drawer and controls. No application handlers are replaced.
export async function checkDrawer(page, target) {
  const observed = target || page.locator('main button').first();
  await observed.evaluate(element => {
    window.__drawerClicks = 0;
    element.addEventListener('click', () => window.__drawerClicks++);
  });
  await page.getByRole('button', {name:'Open navigation', exact:true}).click();
  assert.equal(await page.locator('main').evaluate(element => element.inert), true);
  // A synthetic direct target click cannot bypass the capture guard either.
  await observed.evaluate(element => element.click());
  assert.equal(await page.evaluate(() => window.__drawerClicks), 0);
  assert.equal(await page.locator('#drawer').evaluate(element => element.hidden), true);
  await page.getByRole('button', {name:'Open navigation', exact:true}).click();
  const viewport = page.viewportSize();
  await page.mouse.click(viewport.width - 4, viewport.height / 2);
  assert.equal(await page.locator('#drawer').evaluate(element => element.hidden), true);
  assert.equal(await page.evaluate(() => window.__drawerClicks), 0);
  assert.equal(await page.locator('main').evaluate(element => element.inert), false);
  await page.getByRole('button', {name:'Open navigation', exact:true}).click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#menuButton').evaluate(element => element === document.activeElement), true);
  await page.getByRole('button', {name:'Open navigation', exact:true}).click();
  await page.getByRole('button', {name:'Close menu', exact:true}).click();
  assert.equal(await page.locator('.navigation-backdrop').evaluate(element => element.hidden), true);
  assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
}
