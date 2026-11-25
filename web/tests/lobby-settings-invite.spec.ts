import { expect, test, type Locator, type Page } from '@playwright/test';
import { assertNoHorizontalOverflow, startIsolatedFakeServer } from './helpers';

async function join(page: Page, url: string, name: string): Promise<void> {
  await page.goto(url);
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('button', { name: 'Понятно', exact: true }).click();
}

async function commit(field: Locator, draft: string): Promise<void> {
  await field.fill(draft);
  await field.press('Tab');
}

test('host numeric settings show the accepted value after invalid or empty edits', async ({
  page,
  browser,
}) => {
  const server = await startIsolatedFakeServer({ seedBot: true, rounds: 2 });
  const guest = await browser.newPage();
  try {
    await join(page, server.hostUrl, 'Оля');
    await join(guest, server.guestUrl, 'Дима');
    for (const viewer of [page, guest]) {
      await viewer.getByRole('button', { name: 'Настройки партии', exact: true }).click();
    }
    await page.getByRole('checkbox', { name: 'Пуш: сократить время после ответа' }).check();
    await expect(guest.getByRole('spinbutton', { name: 'Раунды' })).toBeDisabled();
    for (const [label, bound, outside] of [
      ['Раунды', '20', '21'],
      ['Время раунда (с)', '60', '59'],
      ['Ожидание ИИ (с)', '0', '-1'],
      ['Оставить после пуша (с)', '1', '0'],
    ] as const) {
      const field = page.getByRole('spinbutton', { name: label });
      const guestField = guest.getByRole('spinbutton', { name: label });
      await commit(field, bound);
      await expect(guestField).toHaveValue(bound);
      await commit(field, outside);
      await expect(field).toHaveValue(bound);
      await commit(field, '');
      await expect(field).toHaveValue(bound);
      await expect(guestField).toHaveValue(bound);
    }
  } finally {
    await guest.close();
    await server.stop();
  }
});

for (const mode of ['denied', 'unavailable'] as const) {
  test(`clipboard ${mode}: shows the selected guest invitation for manual copying`, async ({
    page,
    context,
  }) => {
    const server = await startIsolatedFakeServer();
    try {
      if (mode === 'denied') await context.grantPermissions([], { origin: server.baseUrl });
      else
        await page.addInitScript(() =>
          Object.defineProperty(navigator, 'clipboard', { value: undefined }),
        );
      await join(page, server.hostUrl, 'Оля');
      if (mode === 'denied') {
        expect(
          await page.evaluate(
            async () =>
              (await navigator.permissions.query({ name: 'clipboard-write' as PermissionName }))
                .state,
          ),
        ).toBe('denied');
      }
      await page.setViewportSize({ width: 375, height: 667 });
      const trigger = page.getByRole('button', { name: 'Скопировать приглашение' });
      await trigger.focus();
      await trigger.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Приглашение в игру' });
      const url = dialog.getByRole('textbox', { name: 'Ссылка для гостей' });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAccessibleDescription(/Скопируйте ссылку вручную/);
      await expect(url).toBeFocused();
      await expect(url).toHaveValue(server.guestUrl);
      expect(
        await url.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]),
      ).toEqual([0, server.guestUrl.length]);
      await assertNoHorizontalOverflow(page);
      if (mode === 'denied') await page.keyboard.press('Escape');
      else await dialog.getByRole('button', { name: 'Закрыть' }).click();
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    } finally {
      await server.stop();
    }
  });
}
