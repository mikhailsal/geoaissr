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
    await expect(inspect.getByRole('heading', { name: 'Образ персонажа' })).toBeVisible();
    await expect(inspect.getByRole('img', { name: 'Предпросмотр: Луна' })).toBeVisible();
    await expect(inspect.getByRole('button', { name: 'Сохранить образ' })).toHaveCount(0);
    await expect(inspect.getByRole('button', { name: 'Профиль', exact: true })).toHaveCount(0);
    await expect(inspect.locator('input')).toHaveCount(0);
    await guest.mouse.click(2, 2);
    await expect(inspect).toHaveCount(0);
  } finally {
    await guest.close();
    await host.close();
    await server.stop();
  }
});

test('double clicking a stage avatar supplies overlapping spin impulses to both renderers', async ({
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
              const state = data.state as {
                gesture?: { kind: string; spinTimes?: number[] };
              } | null;
              if (state?.gesture?.kind === 'spin' && state.gesture.spinTimes) {
                document.documentElement.dataset.lastSpin = JSON.stringify(state.gesture.spinTimes);
              }
            }
            super.postMessage(data);
          }
        };
      });
    }
    await join(host, server.hostUrl, 'Луна');
    await join(guest, server.guestUrl, 'Гость');
    await guest.getByRole('button', { name: 'Повернуть на 360°: Клод', exact: true }).dblclick();
    for (const page of [host, guest]) {
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const impulses = JSON.parse(
              document.documentElement.dataset.lastSpin ?? '[]',
            ) as number[];
            const [first, second] = impulses;
            return (
              impulses.length === 2 &&
              first !== undefined &&
              second !== undefined &&
              second > first &&
              second - first < 1340
            );
          }),
        )
        .toBe(true);
    }
  } finally {
    await guest.close();
    await host.close();
    await server.stop();
  }
});
