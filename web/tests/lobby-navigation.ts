import { expect, type Locator, type Page } from '@playwright/test';

export async function openLobbyDialog(
  page: Page,
  name: 'Участники' | 'Настройки партии',
): Promise<Locator> {
  await page.getByRole('button', { name, exact: true }).click();
  const dialog = page.getByRole('dialog', { name, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function closeLobbyDialog(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(dialog).toBeHidden();
}

export async function expectLobbyPlayers(page: Page, count: number): Promise<void> {
  const dialog = await openLobbyDialog(page, 'Участники');
  await expect(
    dialog.getByRole('heading', { name: `ИГРОКИ ${count} из 8`, exact: true }),
  ).toBeVisible();
  await closeLobbyDialog(dialog);
}
