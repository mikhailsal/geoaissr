import { expect, test, type Locator, type Page } from '@playwright/test';
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

/** Opens the region list, types the name and takes the first match. */
async function pickRegion(settings: Locator, name: string): Promise<void> {
  await settings.getByTestId('region-select').click();
  await settings.getByTestId('region-search').fill(name);
  await expect(settings.getByTestId('region-options').getByRole('option').first()).toHaveText(name);
  await settings.getByTestId('region-search').press('Enter');
  await expect(settings.getByTestId('region-options')).toHaveCount(0);
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
    await map.selectOption('capitals');
    await expect(settings.getByTestId('map-description')).toHaveText('Только столицы стран');
    await pickRegion(settings, 'Япония');

    await expect(guestSettings.getByTestId('map-select')).toHaveValue('capitals');
    await expect(guestSettings.getByTestId('map-select')).toBeDisabled();
    const guestRegion = guestSettings.getByTestId('region-select');
    await expect(guestRegion).toHaveAttribute('data-value', 'country:JPN');
    await expect(guestRegion).toHaveText('Япония');
    await expect(guestRegion).toBeDisabled();
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

// Value: protects=a map with no places in the chosen region cannot be picked; a region the chosen map does not reach is greyed out (an area) or not listed at all (a country); fails_when=an empty combination is offered and the match fails to find a round, or two hundred dead rows come back;
// why_new=every region had places before; seam=none; no_claim=the server-side start check (engine test)
test('a map without places in the region is greyed out, and the region list keeps to the map', async ({
  page,
}) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  try {
    await join(page, server.hostUrl, 'Оля');
    const settings = await openLobbyDialog(page, 'Настройки партии');
    const map = settings.getByTestId('map-select');
    const region = settings.getByTestId('region-select');
    const options = settings.getByTestId('region-options');
    await expect(map.locator('option:disabled')).toHaveCount(0);
    // Every map says in its row what it is.
    await expect(map.locator('option[value="wild"]')).toHaveText(
      'Глушь: случайные точки, чаще вдали от городов',
    );
    await expect(map.locator('option[value="north"]')).toHaveText('Север: севернее 60° с. ш.');

    await pickRegion(settings, 'Европа');
    const highlands = map.locator('option[value="highlands"]');
    await expect(highlands).toBeDisabled();
    await expect(highlands).toHaveText('Высокогорье: нет в выбранном регионе');
    await expect(map.locator('option[value="capitals"]')).toBeEnabled();

    await map.selectOption('north');
    await expect(settings.getByTestId('map-description')).toContainText('60°');
    await region.click();
    const africa = options.locator('[data-value="africa"]');
    await expect(africa).toHaveAttribute('aria-disabled', 'true');
    await expect(africa).toHaveText('Африка (нет на выбранной карте)');
    await expect(options.locator('[data-value="europe"]')).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    // Only the countries the map reaches are listed, under their own heading.
    await expect(options.getByText('Страны', { exact: true })).toBeVisible();
    await expect(options.locator('[data-value^="country:"]')).toHaveCount(8);
    await expect(options.locator('[data-value="country:FIN"]')).toHaveCount(1);
    await expect(options.locator('[data-value="country:BRA"]')).toHaveCount(0);
    // A greyed-out area does not take a click.
    await africa.click({ force: true });
    await expect(region).toHaveAttribute('data-value', 'europe');
    await settings.getByTestId('region-search').press('Escape');
    await expect(settings.getByRole('list', { name: 'Почему нельзя начать' })).toHaveCount(0);

    // The chosen country stays chosen when another map changes the list around it.
    await pickRegion(settings, 'Финляндия');
    await map.selectOption('standard');
    await expect(region).toHaveAttribute('data-value', 'country:FIN');
    await region.click();
    await expect(options.locator('[aria-disabled="true"]')).toHaveCount(0);
    // A country without Street View coverage is not offered at all.
    await expect(options.locator('[data-value="country:FRA"]')).toHaveCount(1);
    await expect(options.locator('[data-value="country:CHN"]')).toHaveCount(0);
    await expect(options.locator('[data-value="country:PRK"]')).toHaveCount(0);
  } finally {
    await server.stop();
  }
});

// Value: protects=the host narrows two hundred countries by typing, from the closed button too, picks with the keyboard, and Escape closes the list without closing the settings; fails_when=typing does not filter, the keys do not reach the list, or Escape shuts the whole dialog;
// why_new=the region was a native select with no text filter; seam=none; no_claim=screen reader output
test('the region list is filtered by typing and works from the keyboard', async ({ page }) => {
  const server = await startIsolatedFakeServer({ rounds: 1 });
  try {
    await join(page, server.hostUrl, 'Оля');
    const settings = await openLobbyDialog(page, 'Настройки партии');
    const region = settings.getByTestId('region-select');
    const search = settings.getByTestId('region-search');
    const options = settings.getByTestId('region-options').getByRole('option');

    // A letter typed on the closed button opens the list with that letter.
    await region.focus();
    await region.dispatchEvent('keydown', { key: 'ф', bubbles: true, cancelable: true });
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('ф');
    await page.keyboard.type('ран');
    await expect(options.first()).toHaveText('Франция');
    await search.fill('ФИН');
    await expect(options).toHaveText(['Финляндия']);
    await search.fill('нетакойстраны');
    await expect(options).toHaveCount(0);
    await expect(settings.getByText('Ничего не найдено')).toBeVisible();

    // Escape closes the list only; the settings stay open and the button has the focus again.
    await search.press('Escape');
    await expect(search).toHaveCount(0);
    await expect(settings.getByTestId('map-select')).toBeVisible();
    await expect(region).toBeFocused();
    await expect(region).toHaveAttribute('data-value', 'world');

    // Arrow keys walk the list from the chosen region; Enter takes the row.
    await region.press('ArrowDown');
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    await search.press('ArrowDown');
    await search.press('ArrowDown');
    await search.press('ArrowUp');
    await search.press('Enter');
    await expect(region).toHaveAttribute('data-value', 'europe');
    await expect(region).toHaveText('Европа');
  } finally {
    await server.stop();
  }
});
