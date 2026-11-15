import { expect, test, type Page } from '@playwright/test';
import { assertNoHorizontalOverflow, startIsolatedFakeServer } from './helpers';

async function join(page: Page, url: string, name: string) {
  await page.goto(url);
  const continueButton = page.getByRole('button', { name: 'Всё равно войти' });
  if (await continueButton.isVisible()) await continueButton.click();
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByText(/ИГРОКИ/)).toBeVisible();
}

// Value: protects=host and guest see configured quota values and zero/nonzero details; fails_when=metrics use defaults, hide from guests, or show a forecast for zero; no_claim=does not verify server arithmetic independently
test('host and guest see configured quota metrics', async ({ browser }) => {
  const server = await startIsolatedFakeServer({
    quotaCeilings: { staticRequests: 200, panoLoads: 100, mapLoads: 100 },
    initialQuota: { staticRequests: 0, panoLoads: 100, mapLoads: 20 },
  });
  const host = await browser.newPage();
  const guest = await browser.newPage();
  try {
    await join(host, server.hostUrl, 'Host');
    await join(guest, server.guestUrl, 'Guest');
    for (const page of [host, guest]) {
      const staticButton = page.getByRole('button', { name: 'Static Street View' });
      await expect(staticButton).toHaveText('0%');
      await expect(staticButton).toHaveAccessibleName('Static Street View: 0%');
      await staticButton.hover();
      const staticDetails = page.getByRole('region', { name: 'Static Street View' });
      await expect(staticDetails).toContainText('0 / 200');
      await expect(staticDetails).not.toContainText('сутки');
      await expect(staticDetails).not.toContainText('месяц');
      const pano = page.getByRole('button', { name: 'Dynamic Pano' });
      await expect(pano).toHaveText('100%');
      await expect(pano).toHaveAccessibleName('Dynamic Pano: 100%');
      await pano.hover();
      const panoDetails = page.getByRole('region', { name: 'Dynamic Pano' });
      await expect(panoDetails).toContainText('100 / 100');
      await expect(panoDetails).toContainText('сутки');
      await expect(panoDetails).toContainText('Лимит исчерпан');
      if (page === host) await page.screenshot({ path: '/tmp/geoaissr-quota-widget.png' });
      await expect(page.getByRole('button', { name: 'Maps JS' })).toHaveText('20%');
      await assertNoHorizontalOverflow(page);
    }
  } finally {
    await host.close();
    await guest.close();
    await server.stop();
  }
});

// Value: protects=keyboard focus, Escape, tap toggle and outside dismissal of quota details; fails_when=details cannot be opened or dismissed on these input paths; no_claim=does not emulate a physical touch device
test('quota details support keyboard and touch dismissal', async ({ browser }) => {
  const server = await startIsolatedFakeServer();
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
    await join(page, server.hostUrl, 'Host');
    const button = page.getByRole('button', { name: 'Static Street View' });
    const details = page.getByRole('region', { name: 'Static Street View' });
    await button.focus();
    await expect(details).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(details).toHaveCount(0);
    await button.blur();
    await button.tap();
    await expect(details).toBeVisible();
    await button.tap();
    await expect(details).toHaveCount(0);
    await button.tap();
    await expect(details).toBeVisible();
    await page.getByRole('heading', { name: 'ПАРТИЯ' }).tap();
    await expect(details).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
  } finally {
    await context.close();
    await server.stop();
  }
});
