import { openLobbyDialog } from './lobby-navigation';
import { expect, test } from '@playwright/test';
import { assertNoHorizontalOverflow, startIsolatedFakeServer } from './helpers';

// Regression: ISSUE-004 — quota readings looked like selected toggle buttons.
// Found by /qa on 2026-11-16
// Report: .gstack/qa-reports/run-results-feedback/qa-report-geoaissr-2026-11-16.md
// Value: protects=quota meters and unboxed detail affordance; fails_when=usage bars or overflow values disappear; why_new=existing tests only cover tooltip text and input methods; seam=none; no_claim=does not independently test quota arithmetic.
test('quotas show usage meters and keep details accessible', async ({ page }) => {
  const server = await startIsolatedFakeServer({
    quotaCeilings: { staticRequests: 20, panoLoads: 10, mapLoads: 20 },
    initialQuota: { staticRequests: 5, panoLoads: 10, mapLoads: 30 },
  });
  try {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(server.hostUrl);
    const continueButton = page.getByRole('button', { name: 'Всё равно войти' });
    await page.getByLabel('Ваше имя').or(continueButton).first().waitFor();
    if (await continueButton.isVisible()) await continueButton.click();
    await page.getByLabel('Ваше имя').fill('Оля');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await openLobbyDialog(page, 'Настройки партии');
    await expect(page.getByRole('meter')).toHaveCount(3);
    for (const [name, used, max, percent] of [
      ['Static Street View', 5, 20, 25],
      ['Dynamic Pano', 10, 10, 100],
      ['Maps JS', 30, 20, 150],
    ] as const) {
      const meter = page.getByRole('meter', { name });
      await expect(meter).toHaveAttribute('max', String(max));
      await expect(meter).toHaveAttribute('value', String(Math.min(used, max)));
      const detailsTrigger = page.getByRole('button', {
        name: `${name}: ${percent}%`,
        exact: true,
      });
      await expect(detailsTrigger).toHaveCSS('border-top-width', '0px');
      await expect(detailsTrigger).not.toHaveAttribute('aria-pressed');
      await detailsTrigger.click();
      await expect(page.getByRole('region', { name })).toContainText(`${used} / ${max}`);
      await page.keyboard.press('Escape');
    }
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: test.info().outputPath('quota-meters.png'), fullPage: true });
  } finally {
    await server.stop();
  }
});
