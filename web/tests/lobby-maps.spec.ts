import { expect, test, type Page } from '@playwright/test';
import { startIsolatedFakeServer } from './helpers';
import { closeLobbyDialog, openLobbyDialog } from './lobby-navigation';

async function join(page: Page, url: string, name: string): Promise<void> {
  await page.goto(url);
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('button', { name: 'Понятно', exact: true }).click();
}

async function guess(page: Page): Promise<void> {
  const map = page.getByTestId('fake-guess-map').locator('canvas');
  await expect(map).toBeVisible({ timeout: 12_000 });
  await map.click({ position: { x: 100, y: 100 } });
  await page.getByRole('button', { name: 'Угадать' }).click();
}

// Value: protects=the host picks a map and a country in the lobby, the guest sees both, and the round is played in that country; fails_when=a select does not send its value, the guest keeps the old settings or the round ignores the choice;
// why_new=the lobby had one region select and no map; seam=none; no_claim=live Street View sampling (fake mode)
test('the host picks a map and a country and the round is played there', async ({
  page,
  browser,
}) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  const guest = await browser.newPage();
  try {
    await join(page, server.hostUrl, 'Оля');
    await join(guest, server.guestUrl, 'Дима');
    const settings = await openLobbyDialog(page, 'Настройки партии');
    const guestSettings = await openLobbyDialog(guest, 'Настройки партии');
    const map = settings.getByTestId('map-select');
    await expect(map).toHaveValue('standard');
    await expect(settings.getByTestId('map-description')).toContainText('Половина раундов');
    await map.selectOption({ label: 'Столицы' });
    await expect(settings.getByTestId('map-description')).toHaveText('Только столицы стран');
    await settings.getByTestId('region-select').selectOption({ label: 'Япония' });

    await expect(guestSettings.getByTestId('map-select')).toHaveValue('capitals');
    await expect(guestSettings.getByTestId('map-select')).toBeDisabled();
    await expect(guestSettings.getByTestId('region-select')).toHaveValue('country:JPN');
    await expect(guestSettings.getByText(/Начать может только хост/)).toContainText(
      'Столицы · Япония',
    );
    await closeLobbyDialog(guestSettings);
    await closeLobbyDialog(settings);

    await page.getByRole('button', { name: 'Начать' }).click();
    await guess(page);
    await guess(guest);
    await expect(page.getByText('Правильный ответ: Япония')).toBeVisible({ timeout: 15_000 });
    await expect(guest.getByText('Правильный ответ: Япония')).toBeVisible({ timeout: 15_000 });
  } finally {
    await guest.close();
    await server.stop();
  }
});

// Value: protects=a map with no places in the chosen region cannot be picked, and a region the chosen map does not reach cannot be picked either; fails_when=an empty combination is offered and the match fails to find a round;
// why_new=every region had places before; seam=none; no_claim=the server-side start check (engine test)
test('a map without places in the region is greyed out, and so is a region the map misses', async ({
  page,
}) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  try {
    await join(page, server.hostUrl, 'Оля');
    const settings = await openLobbyDialog(page, 'Настройки партии');
    const map = settings.getByTestId('map-select');
    const region = settings.getByTestId('region-select');
    await expect(map.locator('option:disabled')).toHaveCount(0);

    await region.selectOption({ label: 'Европа' });
    const highlands = map.locator('option[value="highlands"]');
    await expect(highlands).toBeDisabled();
    await expect(highlands).toHaveText('Высокогорье (нет в выбранном регионе)');
    await expect(map.locator('option[value="capitals"]')).toBeEnabled();

    await map.selectOption({ label: 'Север' });
    await expect(settings.getByTestId('map-description')).toContainText('60°');
    await expect(region.locator('option[value="africa"]')).toBeDisabled();
    await expect(region.locator('option[value="africa"]')).toHaveText(
      'Африка (нет на выбранной карте)',
    );
    await expect(region.locator('option[value="country:BRA"]')).toBeDisabled();
    await expect(region.locator('option[value="country:FIN"]')).toBeEnabled();
    await expect(region.locator('option[value="europe"]')).toBeEnabled();
    // The countries the map reaches come first; the rest sit in a group that says why.
    const open = region.locator('optgroup[label="Страны"] option');
    const closed = region.locator('optgroup[label="Нет на выбранной карте"] option');
    await expect(open).toHaveCount(8);
    await expect(open.first()).toBeEnabled();
    await expect(closed.filter({ hasText: 'Бразилия' })).toHaveCount(1);
    await expect(
      region.locator('optgroup[label="Нет на выбранной карте"] option:enabled'),
    ).toHaveCount(0);
    await expect(settings.getByRole('list', { name: 'Почему нельзя начать' })).toHaveCount(0);

    // The chosen country stays chosen when another map moves the other countries between groups.
    await region.selectOption({ label: 'Финляндия' });
    await map.selectOption({ label: 'Стандартная' });
    await expect(region).toHaveValue('country:FIN');
    await expect(region.locator('optgroup[label="Нет на выбранной карте"]')).toHaveCount(0);
    await expect(region.locator('option:disabled')).toHaveCount(0);
  } finally {
    await server.stop();
  }
});
