import { expect, test, type Locator, type Page } from '@playwright/test';
import { startIsolatedFakeServer } from './helpers';

async function join(page: Page, url: string, name: string) {
  await page.goto(url);
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('button', { name: 'Понятно', exact: true }).click();
}

async function wardrobe(page: Page, name: string) {
  await page.getByRole('button', { name: 'Открыть гардероб: ' + name, exact: true }).click();
  return page.getByRole('dialog');
}

test('foreign wardrobe, profile and AI settings show the owner’s controls and current selections', async ({
  browser,
}) => {
  const server = await startIsolatedFakeServer({ seedBot: true });
  const host = await browser.newPage();
  const guest = await browser.newPage();
  try {
    await join(host, server.hostUrl, 'Луна');
    await join(guest, server.guestUrl, 'Саша');
    const own = await wardrobe(host, 'Луна');
    const foreign = await wardrobe(guest, 'Луна');
    const categories = { name: 'Разделы гардероба' };
    const ownSections = own.getByRole('group', categories).getByRole('button');
    const visitorSections = foreign.getByRole('group', categories).getByRole('button');
    await expect(visitorSections).toHaveText(await ownSections.allTextContents());
    await expect(foreign.getByRole('button', { name: 'Человек', pressed: true })).toBeDisabled();
    await expect(foreign.getByRole('button', { name: 'Случайный образ' })).toBeDisabled();
    await expect(foreign.getByRole('button', { name: 'Вернуть сохранённый образ' })).toBeDisabled();
    const pilot = { name: 'Лунный пилот', exact: true };
    await expect(foreign.getByRole('button', pilot)).toBeDisabled();
    await own.getByRole('button', pilot).click();
    await own.getByRole('button', { name: 'Сохранить образ' }).click();
    await expect(foreign.getByRole('button', pilot)).toHaveAttribute('aria-pressed', 'true');
    await foreign.getByRole('button', { name: 'Одежда', exact: true }).click();
    await foreign.getByRole('button', { name: 'Верх', exact: true }).click();
    const tops = foreign.getByRole('group', { name: 'Верх', exact: true });
    await expect(tops.getByRole('button', { pressed: true })).toBeDisabled();
    await expect(tops.locator('button:enabled')).toHaveCount(0);
    await expect(foreign.getByLabel('Свой цвет')).toBeDisabled();
    await foreign.getByRole('button', { name: 'Профиль', exact: true }).click();
    await host.getByRole('button', { name: 'Профиль', exact: true }).click();
    const ownProfile = host.getByRole('dialog');
    await expect(ownProfile.getByLabel('Код профиля')).toBeVisible();
    await ownProfile.getByRole('radio', { name: 'сиреневый', exact: true }).click();
    await ownProfile.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(foreign.getByRole('radio', { name: 'сиреневый', checked: true })).toBeDisabled();
    await expect(foreign.getByLabel('Имя', { exact: true })).toHaveValue('Луна');
    await expect(foreign.getByLabel('Имя', { exact: true })).toBeDisabled();
    await expect(foreign.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
    await expect(foreign.getByText(/Код профиля|Скопировать код|Выйти/)).toHaveCount(0);
    await guest.keyboard.press('Escape');

    // A host inspecting another human has the same public view as a guest.
    const other = await wardrobe(host, 'Саша');
    await other.getByRole('button', { name: 'Профиль', exact: true }).click();
    await expect(other.getByLabel('Имя', { exact: true })).toHaveValue('Саша');
    await expect(other.getByRole('button', { name: 'Сохранить', exact: true })).toBeDisabled();
    await expect(other.getByText(/Код профиля|Скопировать код|Выйти/)).toHaveCount(0);
    await host.keyboard.press('Escape');

    const robot = await wardrobe(guest, 'Клод');
    await expect(robot.getByRole('button', { name: 'Робот', pressed: true })).toBeDisabled();
    await robot.getByRole('button', { name: 'Настройки ИИ', exact: true }).click();
    await robot.getByText('Дополнительно', { exact: true }).click();
    await expect(robot.getByLabel('Размер снимка')).toBeDisabled();
    await expect(robot.getByRole('button', { name: 'Проверить зрение' })).toBeDisabled();
    await expect(robot.getByRole('button', { name: 'Сбросить победы Клод' })).toBeDisabled();
    await expect(robot.getByRole('button', { name: 'Удалить', exact: true })).toBeDisabled();
    await expect(robot.getByRole('button', { name: 'Повернуть на 360°: Клод' })).toBeEnabled();
  } finally {
    await guest.close();
    await host.close();
    await server.stop();
  }
});

async function previewFrame(canvas: Locator, switchTab = false) {
  return canvas.evaluate(async (node: HTMLCanvasElement, changeTab) => {
    if (changeTab) {
      const nextTab = node
        .closest('dialog')
        ?.querySelector<HTMLButtonElement>('nav button[aria-pressed="false"]');
      if (!nextTab) throw new Error('No other character tab');
      nextTab.click();
      // Read the first updated layout before ResizeObserver or a renderer worker replaces the bitmap.
      await Promise.resolve();
    }
    const { width, height } = node;
    const box = node.getBoundingClientRect();
    const buffer = document.createElement('canvas');
    buffer.width = width;
    buffer.height = height;
    const pixels = buffer.getContext('2d');
    if (!pixels) throw new Error('Cannot read avatar pixels without a 2D context');
    pixels.drawImage(node, 0, 0);
    const rgba = pixels.getImageData(0, 0, width, height).data;
    let left = width,
      right = -1,
      top = height,
      bottom = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((rgba[(y * width + x) * 4 + 3] ?? 0) < 128) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    const pixelWidth = box.width / width;
    const pixelHeight = box.height / height;
    const scaleRatio = pixelWidth / pixelHeight;
    const silhouette = (right - left + 1) / (bottom - top + 1);
    return {
      aspectError: Math.abs(scaleRatio - 1),
      silhouette:
        getComputedStyle(node).objectFit === 'fill' ? silhouette * scaleRatio : silhouette,
      paintedRows: bottom - top + 1,
    };
  }, switchTab);
}

test('changing AI tabs preserves the bitmap aspect and visible robot proportions from the first frame', async ({
  page,
}) => {
  const server = await startIsolatedFakeServer({ seedBot: true });
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await join(page, server.hostUrl, 'Луна');
    const dialog = await wardrobe(page, 'Клод');
    const canvas = dialog.locator('canvas[data-avatar-renderer]');
    for (const [width, height] of [
      [1280, 720],
      [390, 740],
      [844, 390],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expect.poll(async () => (await previewFrame(canvas)).aspectError).toBeLessThan(0.02);
      const before = await previewFrame(canvas);
      expect(before.paintedRows).toBeGreaterThan(60);
      for (const name of ['Настройки ИИ', 'Гардероб']) {
        const first = await previewFrame(canvas, true);
        await expect(
          dialog.getByRole('button', { name, exact: true, pressed: true }),
        ).toBeVisible();
        expect(first.aspectError).toBeLessThan(0.02);
        expect(first.silhouette / before.silhouette).toBeCloseTo(1, 1);
        const settled = await previewFrame(canvas);
        expect(settled.silhouette / before.silhouette).toBeCloseTo(1, 1);
      }
    }
  } finally {
    await server.stop();
  }
});
