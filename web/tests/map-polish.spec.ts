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
  execFileSync('bun', [
    'build',
    'web/src/lib/fake-canvas.ts',
    '--tsconfig-override',
    'tsconfig.web.json',
    '--target=browser',
    '--outfile=.gstack/tmp/fake-canvas-test.js',
  ]);
});

async function startRound(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.getByLabel('Ваше имя').fill('Оля');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.getByTestId('fake-guess-map')).toBeVisible({ timeout: 12_000 });
}

async function assertComparableMapMarkers(page: Page, bundle: string): Promise<void> {
  const fakeCanvasBundle = readFileSync('.gstack/tmp/fake-canvas-test.js', 'utf8');
  const markerBounds = await page.evaluate(
    async ({ source, pinSource }) => {
      const fake = (await import(
        URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
      )) as typeof import('../src/lib/fake-canvas');
      const pinModule = (await import(
        URL.createObjectURL(new Blob([pinSource], { type: 'text/javascript' }))
      )) as typeof import('../src/lib/maps-loader');
      const baseline = document.createElement('canvas');
      const marked = document.createElement('canvas');
      baseline.width = marked.width = 100;
      baseline.height = marked.height = 100;
      const baselineContext = baseline.getContext('2d');
      const context = marked.getContext('2d');
      if (!baselineContext || !context) throw new Error('2D canvas context unavailable');
      const camera = { centerLat: 0, centerLng: 0, zoom: 1 };
      fake.renderFakeMapCanvas(baselineContext, 100, 100, camera, [], []);
      fake.renderFakeMapCanvas(
        context,
        100,
        100,
        camera,
        [{ id: 'participant', label: '', lat: 0, lng: 0, fillHex: '#c81414', inkHex: '#000000' }],
        [],
      );
      const before = baselineContext.getImageData(0, 0, 100, 100).data;
      const after = context.getImageData(0, 0, 100, 100).data;
      const points: Array<{ x: number; y: number }> = [];
      for (let y = 35; y < 65; y += 1) {
        for (let x = 35; x < 65; x += 1) {
          const offset = (y * 100 + x) * 4;
          if (
            before[offset] !== after[offset] ||
            before[offset + 1] !== after[offset + 1] ||
            before[offset + 2] !== after[offset + 2]
          ) {
            points.push({ x, y });
          }
        }
      }
      const fakeDiameter =
        Math.max(...points.map((point) => point.x)) -
        Math.min(...points.map((point) => point.x)) +
        1;
      const pin = pinModule.buildPinElement({
        id: 'participant',
        lat: 0,
        lng: 0,
        fillHex: '#c81414',
        inkHex: '#000000',
        label: '',
      });
      document.body.appendChild(pin);
      const domDiameter = pin.getBoundingClientRect().width;
      pin.remove();
      return { fakeDiameter, domDiameter };
    },
    { source: fakeCanvasBundle, pinSource: bundle },
  );
  // Allow 3px for the fake 2px outline and subpixel rasterization.
  expect(markerBounds.fakeDiameter).toBeGreaterThan(0);
  expect(Math.abs(markerBounds.fakeDiameter - markerBounds.domDiameter)).toBeLessThanOrEqual(3);
}

// Value: protects=minimap opacity states, pin geometry under global CSS and comparable fake canvas marker size;
// fails_when=an active state stays translucent, idle stays opaque or marker dimensions diverge;
// why_new=existing game flow does not compare these map contracts; seam=none;
// no_claim=fake mode does not load Google tiles or dispatch live Google overlays.
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
    await assertComparableMapMarkers(page, bundle);
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

// Value: protects=physical overlapping target click opens exact pano URL in a new tab;
// fails_when=target loses hit priority or open arguments differ; why_new=existing results flow has no target popup assertion;
// seam=none; no_claim=fake canvas does not exercise Google OverlayView.
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
