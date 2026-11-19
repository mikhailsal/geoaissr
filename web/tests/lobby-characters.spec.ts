import { expect, test, type Page } from '@playwright/test';
import { startIsolatedFakeServer } from './helpers';

async function join(page: Page, url: string, nick: string): Promise<void> {
  await page.goto(url);
  await page.getByLabel('Ваше имя').fill(nick);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('button', { name: 'Понятно', exact: true }).click();
}

test('the stage reveals its lineup only after all visible characters have a painted frame', async ({
  page,
}) => {
  const server = await startIsolatedFakeServer({ seedBot: true });
  try {
    await page.addInitScript(() => {
      const queued: (() => void)[] = [];
      let blocked = true;
      window.Worker = class extends Worker {
        override postMessage(data: unknown): void {
          const deliver = () => {
            super.postMessage(data);
          };
          if (blocked && data && typeof data === 'object' && 'id' in data && 'state' in data)
            queued.push(deliver);
          else deliver();
        }
      };
      window.addEventListener(
        'resume-avatar-workers',
        () => {
          blocked = false;
          for (const deliver of queued.splice(0)) deliver();
        },
        { once: true },
      );
    });
    await page.goto(server.hostUrl);
    await page.getByLabel('Ваше имя').fill('Луна');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    const stage = page.getByRole('region', { name: 'Сцена лобби' });
    const loading = page.getByText('Загружаем персонажей', { exact: true });
    await expect(loading).toBeVisible();
    await expect(stage.locator('article canvas[data-avatar-renderer]')).toHaveCount(0);
    await expect(stage.getByRole('progressbar')).toHaveAttribute('max', '2');
    await page.evaluate(() => window.dispatchEvent(new Event('resume-avatar-workers')));
    await expect(loading).toHaveCount(0);
    await expect(stage.locator('article canvas[data-avatar-renderer]')).toHaveCount(2);
  } finally {
    await server.stop();
  }
});

test('character windows share appearance with settings, preserve privacy and dismiss on the backdrop', async ({
  browser,
}) => {
  const server = await startIsolatedFakeServer({ seedBot: true });
  const host = await browser.newPage();
  const guest = await browser.newPage();
  try {
    await join(host, server.hostUrl, 'Луна');
    await join(guest, server.guestUrl, 'Гость');
    await host.getByRole('button', { name: 'Профиль', exact: true }).click();
    const modal = host.getByRole('dialog');
    await expect(modal.getByLabel('Имя', { exact: true })).toHaveValue('Луна');
    await expect(modal.getByLabel('Код профиля')).toBeVisible();
    await modal.getByRole('button', { name: 'Гардероб', exact: true }).click();
    await expect(modal.getByRole('button', { name: 'Сохранить образ' })).toBeVisible();
    await host.mouse.click(2, 2);
    await expect(modal).toHaveCount(0);
    await host.getByRole('button', { name: 'Открыть гардероб: Клод', exact: true }).click();
    await modal.getByRole('button', { name: 'Настройки ИИ', exact: true }).click();
    await expect(modal.getByLabel('Имя бота')).toBeEditable();
    await host.mouse.click(2, 2);
    await expect(modal).toHaveCount(0);
    await guest.getByRole('button', { name: 'Открыть гардероб: Луна', exact: true }).click();
    const inspect = guest.getByRole('dialog');
    await expect(inspect.getByRole('group', { name: 'Разделы гардероба' })).toBeVisible();
    await expect(inspect.getByRole('img', { name: 'Предпросмотр: Луна' })).toBeVisible();
    await expect(inspect.getByRole('button', { name: 'Сохранить образ' })).toBeDisabled();
    await inspect.getByRole('button', { name: 'Профиль', exact: true }).click();
    await expect(inspect.getByLabel('Имя', { exact: true })).toHaveValue('Луна');
    await expect(inspect.getByLabel('Имя', { exact: true })).toBeDisabled();
    await expect(inspect.getByLabel('Код профиля')).toHaveCount(0);
    await expect(
      inspect.getByRole('button', { name: 'Скопировать код', includeHidden: true }),
    ).toHaveCount(0);
    await expect(inspect.getByRole('button', { name: 'Выйти', includeHidden: true })).toHaveCount(
      0,
    );
    await guest.mouse.click(2, 2);
    await expect(inspect).toHaveCount(0);
  } finally {
    await guest.close();
    await host.close();
    await server.stop();
  }
});

test('rapid avatar clicks boost both renderers and stop arriving when the guest stops clicking', async ({
  browser,
}) => {
  const server = await startIsolatedFakeServer({ seedBot: true });
  const host = await browser.newPage();
  const guest = await browser.newPage();
  try {
    for (const page of [host, guest]) {
      await page.addInitScript(() => {
        window.Worker = class extends Worker {
          override postMessage(data: unknown): void {
            if (typeof data === 'object' && data !== null && 'state' in data) {
              const state = data.state as { gesture?: { spinStartSpeed?: number } } | null;
              if (state?.gesture?.spinStartSpeed) document.documentElement.dataset.boosted = 'yes';
            }
            super.postMessage(data);
          }
        };
      });
    }
    const receipts: number[] = [];
    host.on('websocket', (socket) =>
      socket.on('framereceived', ({ payload }) => {
        const event = JSON.parse(String(payload)) as { type: string; gesture?: string };
        if (event.type === 'avatar_gesture' && event.gesture === 'spin') receipts.push(Date.now());
      }),
    );
    await join(host, server.hostUrl, 'Луна');
    await join(guest, server.guestUrl, 'Гость');
    const turn = guest.getByRole('button', { name: 'Повернуть на 360°: Клод', exact: true });
    await turn.dblclick();
    // Dispatch the rest of the burst in the page; browser actionability waits must not pace it.
    await turn.evaluate((button: HTMLButtonElement) => {
      for (let i = 0; i < 4; i++) button.click();
    });
    for (const page of [host, guest]) {
      await expect(page.locator('html')).toHaveAttribute('data-boosted', 'yes');
    }
    await expect.poll(() => receipts.length).toBe(6);
    expect(Math.max(...receipts) - Math.min(...receipts)).toBeLessThan(700);
    for (const page of [host, guest]) {
      await expect(page.locator('article[data-gesture="spin"]')).toHaveCount(0, { timeout: 850 });
    }
  } finally {
    await guest.close();
    await host.close();
    await server.stop();
  }
});

test('dragging an avatar sends its angle to the other player and releases without spinning', async ({
  browser,
}) => {
  const server = await startIsolatedFakeServer({ seedBot: true });
  const host = await browser.newPage();
  const guest = await browser.newPage();
  try {
    for (const page of [host, guest]) {
      await page.addInitScript(() => {
        window.Worker = class extends Worker {
          override postMessage(data: unknown): void {
            if (typeof data === 'object' && data !== null && 'state' in data) {
              const state = data.state as { appearance: { base: string }; yaw: number } | null;
              if (state?.appearance.base === 'robot')
                document.documentElement.dataset.botYaw = String(state.yaw);
            }
            super.postMessage(data);
          }
        };
      });
    }
    await join(host, server.hostUrl, 'Луна');
    await join(guest, server.guestUrl, 'Гость');
    const button = guest.getByRole('button', { name: 'Повернуть на 360°: Клод', exact: true });
    for (const page of [host, guest]) {
      await expect(page.locator('article canvas[data-avatar-renderer]')).toHaveCount(3);
      await expect(page.locator('html')).toHaveAttribute('data-bot-yaw', /^-?\d/);
    }
    const yaw = (page: Page) =>
      page.evaluate(() => Number(document.documentElement.dataset.botYaw));
    const unwrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
    const [localBase, remoteBase] = await Promise.all([yaw(guest), yaw(host)]);
    const box = await button.boundingBox();
    if (!box) throw Error('The bot is missing from the stage');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await guest.mouse.move(x, y);
    await guest.mouse.down();
    await guest.mouse.move(x + box.width * 0.24, y, { steps: 7 });
    await expect
      .poll(async () => Math.abs(unwrap((await yaw(host)) - remoteBase)))
      .toBeGreaterThan(0.2);
    await guest.mouse.move(x + box.width * 0.1, y, { steps: 4 });
    await guest.mouse.up();
    const localDelta = unwrap((await yaw(guest)) - localBase);
    expect(Math.abs(localDelta)).toBeGreaterThan(0.1);
    await expect
      .poll(async () => unwrap((await yaw(host)) - remoteBase))
      .toBeCloseTo(localDelta, 3);
    for (const page of [host, guest]) {
      await expect(page.getByRole('article', { name: 'Клод', exact: true })).not.toHaveAttribute(
        'data-gesture',
        'spin',
      );
    }
  } finally {
    await guest.close();
    await host.close();
    await server.stop();
  }
});
