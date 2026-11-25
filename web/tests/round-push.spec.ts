import { expect, test, type Page } from '@playwright/test';
import { observeAudio, trace } from './audio-observer';
import { startIsolatedFakeServer } from './helpers';
import { closeLobbyDialog, openLobbyDialog } from './lobby-navigation';

async function join(page: Page, url: string, name: string): Promise<void> {
  await page.goto(url);
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('button', { name: 'Понятно', exact: true }).click();
}

test('a confirmed human push uses the configured cap on both clocks, cues the other player, and expires on the server', async ({
  page: host,
  browser,
}) => {
  const server = await startIsolatedFakeServer({ rounds: 1, roundDurationSec: 120 });
  const guest = await browser.newPage();
  try {
    await observeAudio(guest);
    await Promise.all([join(host, server.hostUrl, 'Оля'), join(guest, server.guestUrl, 'Дима')]);
    const hostSettings = await openLobbyDialog(host, 'Настройки партии');
    const guestSettings = await openLobbyDialog(guest, 'Настройки партии');
    const push = { name: 'Пуш: сократить время после ответа' };
    const bots = { name: 'Разрешить ИИ пушить' };
    await expect(hostSettings.getByRole('checkbox', push)).not.toBeChecked();
    await hostSettings.getByRole('checkbox', push).check();
    await expect(guestSettings.getByRole('checkbox', push)).toBeChecked();
    await expect(guestSettings.getByRole('checkbox', push)).toBeDisabled();
    const pushSeconds = { name: 'Оставить после пуша (с)' };
    await expect(hostSettings.getByRole('spinbutton', pushSeconds)).toHaveValue('15');
    await hostSettings.getByRole('spinbutton', pushSeconds).fill('11');
    await hostSettings.getByRole('spinbutton', pushSeconds).press('Tab');
    await expect(guestSettings.getByRole('spinbutton', pushSeconds)).toHaveValue('11');
    await expect(guestSettings.getByRole('spinbutton', pushSeconds)).toBeDisabled();
    await expect(hostSettings.getByRole('checkbox', bots)).toBeChecked();
    await hostSettings.getByRole('checkbox', bots).uncheck();
    await expect(guestSettings.getByRole('checkbox', bots)).not.toBeChecked();
    await Promise.all([closeLobbyDialog(hostSettings), closeLobbyDialog(guestSettings)]);

    await host.getByRole('button', { name: 'Начать', exact: true }).click();
    const map = host.getByTestId('fake-guess-map').locator('canvas');
    await expect(map).toBeVisible({ timeout: 12_000 });
    await map.click({ position: { x: 140, y: 110 } });
    const guestClock = guest.locator('.timer-pill .digits');
    await expect(guestClock).toHaveText(/^[12]:/);
    await host.getByRole('button', { name: 'Угадать', exact: true }).click();
    for (const player of [host, guest]) {
      await expect(player.locator('.timer-pill .digits')).toHaveText(/^0:(?:1[01]|0[1-9])$/);
    }
    await expect
      .poll(
        async () =>
          (await trace(guest)).starts.filter((s) => s.url.includes('effect-timer-countdown'))
            .length,
      )
      .toBe(1);
    await expect(guest.getByText(/Правильный ответ:/)).toBeVisible({ timeout: 20_000 });
    await expect(host.getByText(/Правильный ответ:/)).toBeVisible();
  } finally {
    await guest.close();
    await server.stop();
  }
});
