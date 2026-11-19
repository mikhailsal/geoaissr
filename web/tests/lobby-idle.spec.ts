import { expect, test, type Locator } from '@playwright/test';
import { startIsolatedFakeServer } from './helpers';

function pixels(canvas: Locator): Promise<string> {
  return canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
}

async function expectMoving(canvas: Locator): Promise<void> {
  await expect(canvas).toBeInViewport();
  for (let frame = 0; frame < 2; frame++) {
    const first = await pixels(canvas);
    await expect.poll(async () => (await pixels(canvas)) !== first).toBe(true);
  }
}

async function expectStill(canvas: Locator): Promise<void> {
  await expect
    .poll(() =>
      canvas.evaluate(async (element: HTMLCanvasElement) => {
        const first = element.toDataURL();
        await new Promise((resolve) => setTimeout(resolve, 500));
        return first === element.toDataURL();
      }),
    )
    .toBe(true);
}

test('idle rigs move on stage and in the wardrobe, pause offscreen and respect reduced motion', async ({
  page,
}) => {
  const server = await startIsolatedFakeServer({ seedBot: true });
  try {
    await page.goto(server.hostUrl);
    await page.getByLabel('Ваше имя').fill('Полина');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await page.getByRole('button', { name: 'Понятно', exact: true }).click();
    const human = page
      .getByRole('img', { name: 'Аватар Полина' })
      .locator('canvas[data-avatar-renderer]');
    const robot = page
      .getByRole('img', { name: 'Аватар Клод' })
      .locator('canvas[data-avatar-renderer]');
    await Promise.all([expectMoving(human), expectMoving(robot)]);

    await page.getByRole('button', { name: 'Изменить аватар', exact: true }).click();
    const preview = page.getByRole('dialog').locator('canvas[data-avatar-renderer]');
    await expectMoving(preview);
    await page.getByRole('button', { name: 'Робот', exact: true }).click();
    await expectMoving(preview);
    await page.keyboard.press('Escape');

    // The lobby fits one screen. Move its lineup to exercise the real intersection observer.
    const lineup = page.locator('.lineup');
    await lineup.evaluate((element: HTMLElement) => {
      element.style.translate = '0 -200vh';
    });
    await expect(human).not.toBeInViewport();
    await expect(robot).not.toBeInViewport();
    await Promise.all([expectStill(human), expectStill(robot)]);
    await lineup.evaluate((element: HTMLElement) => {
      element.style.translate = '';
    });
    await expectMoving(human);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await Promise.all([expectStill(human), expectStill(robot)]);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await Promise.all([expectMoving(human), expectMoving(robot)]);
  } finally {
    await server.stop();
  }
});
