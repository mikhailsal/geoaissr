import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { ServerMessage } from '../../shared/protocol';
import { startIsolatedFakeServer } from './helpers';

test.beforeAll(() => {
  mkdirSync('.gstack/tmp', { recursive: true });
  execFileSync('bun', [
    'build',
    'web/src/lib/maps-loader.ts',
    '--target=browser',
    '--outfile=.gstack/tmp/maps-loader-test.js',
  ]);
});

async function startRound(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.getByLabel('Ваше имя').fill('Оля');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.getByTestId('fake-guess-map')).toBeVisible({ timeout: 12_000 });
}

// protects=idle, hover, focus, keyboard and mobile opacity plus actual pin geometry under global CSS; fails_when=any state or cascade stretches pins; no_claim=fake mode does not load Google tiles.
test('round minimap opacity and real pin geometry', async ({ page }) => {
  const server = await startIsolatedFakeServer({ seedBot: true, rounds: 1 });
  try {
    await startRound(page, server.hostUrl);
    const dock = page.locator('.map-dock');
    await page.mouse.move(0, 0);
    await expect(dock).toHaveCSS('opacity', '0.8');
    await dock.hover();
    await expect(dock).toHaveCSS('opacity', '1');
    await page.mouse.move(0, 0);
    await dock.getByRole('button', { name: 'Приблизить карту' }).focus();
    await expect(dock).toHaveCSS('opacity', '1');
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    await page.keyboard.press('m');
    await expect(dock).toHaveCSS('opacity', '1');
    const bundle = readFileSync('.gstack/tmp/maps-loader-test.js', 'utf8');
    const geometry = await page.evaluate(async (source) => {
      const module = (await import(
        URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
      )) as typeof import('../src/lib/maps-loader');
      return [{}, { isAi: true }, { isTarget: true }].map((kind) => {
        const pin = module.buildPinElement({
          id: 'test',
          lat: 0,
          lng: 0,
          fillHex: 'red',
          inkHex: 'black',
          label: 'A',
          ...kind,
        });
        document.body.appendChild(pin);
        const rect = pin.getBoundingClientRect();
        const result = {
          width: rect.width,
          height: rect.height,
          radius: getComputedStyle(pin).borderRadius,
        };
        pin.remove();
        return result;
      });
    }, bundle);
    for (const pin of geometry) {
      expect(pin.width).toBe(pin.height);
      expect(pin.height).toBeLessThan(44);
      expect(pin.radius).not.toBe('5px');
      expect(Number.parseFloat(pin.radius)).toBeGreaterThanOrEqual(pin.width / 2);
    }
    await page.setViewportSize({ width: 375, height: 800 });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Карта' }).click();
    await page.mouse.move(-20, -20);
    expect(await dock.evaluate((element) => element.matches(':hover'))).toBe(false);
    expect(await dock.evaluate((element) => element.contains(document.activeElement))).toBe(false);
    await expect(dock).toHaveCSS('opacity', '1');
  } finally {
    await server.stop();
  }
});

// protects=physical overlapping target click opens exact pano URL in a new tab; fails_when=target loses hit priority or open arguments differ; no_claim=fake canvas does not exercise Google OverlayView.
test('results target opens Street View', async ({ page }) => {
  const server = await startIsolatedFakeServer({ seedBot: true, rounds: 1 });
  let target = { lat: 0, lng: 0 };
  try {
    await page.routeWebSocket('**/*', (socket) => {
      const remote = socket.connectToServer();
      remote.onMessage((message) => {
        if (typeof message !== 'string') {
          socket.send(message);
          return;
        }
        const parsed = JSON.parse(message) as ServerMessage;
        if (parsed.type === 'state' && parsed.view.results) {
          const results = parsed.view.results;
          target = { lat: results.targetLat, lng: results.targetLng };
          for (const entry of results.entries) {
            entry.lat = target.lat;
            entry.lng = target.lng;
          }
        }
        socket.send(JSON.stringify(parsed));
      });
    });
    await page.addInitScript(() => {
      window.open = (...args) => {
        (window as unknown as { openArgs: unknown[] }).openArgs = args;
        return null;
      };
    });
    await startRound(page, server.hostUrl);
    await page
      .getByTestId('fake-guess-map')
      .locator('canvas')
      .click({ position: { x: 100, y: 100 } });
    await page.getByRole('button', { name: 'Угадать' }).click();
    await expect(page.getByText(/Правильный ответ:/)).toBeVisible({ timeout: 15_000 });
    const canvas = page.getByTestId('fake-results-map').locator('canvas');
    await expect(page.getByTestId('results-map')).toHaveCSS('opacity', '1');
    await canvas.click();
    expect(
      await page.evaluate(() => (window as unknown as { openArgs: unknown[] }).openArgs),
    ).toEqual([
      `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${target.lat},${target.lng}`,
      '_blank',
      'noopener,noreferrer',
    ]);
  } finally {
    await server.stop();
  }
});
