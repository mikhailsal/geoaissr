import { expect, test, type Page } from '@playwright/test';
import { startIsolatedFakeServer } from './helpers';

async function enter(page: Page, invitation: string, name: string): Promise<void> {
  await page.goto(invitation);
  await page.getByLabel('Ваше имя').fill(name);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('button', { name: 'Понятно', exact: true }).click();
}

async function expectStageHits(page: Page): Promise<void> {
  for (const [width, height] of [
    [320, 568],
    [568, 320],
    [653, 280],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.getByText('Загружаем персонажей', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Показать на сцене:/u })).toBeInViewport({
      ratio: 1,
    });
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(height);
    const actors = page.getByRole('article').getByRole('button');
    await expect(actors).toHaveCount(12);
    const blocked = await actors.evaluateAll((buttons) =>
      buttons
        .filter((button) => {
          const rect = button.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          return !button.contains(hit);
        })
        .map((button) => button.getAttribute('aria-label')),
    );
    expect(blocked, `Covered actor controls at ${width}×${height}`).toEqual([]);
  }
}

test('an off-page actor leaves a gesture notice until the viewer chooses to see them', async ({
  browser,
}) => {
  const room = await startIsolatedFakeServer({ seedBot: true });
  const pages = await Promise.all(
    Array.from({ length: 4 }, () => browser.newPage({ reducedMotion: 'reduce' })),
  );
  const [host, guest, mars, venus] = pages as [Page, Page, Page, Page];
  try {
    await enter(host, room.hostUrl, 'Луна');
    await Promise.all([
      enter(guest, room.guestUrl, 'Земля'),
      enter(mars, room.guestUrl, 'Марс'),
      enter(venus, room.guestUrl, 'Венера'),
    ]);
    await host.getByRole('button', { name: 'Участники', exact: true }).click();
    const add = host.getByRole('button', { name: '+ Добавить ИИ' });
    await add.click();
    await add.click();
    await host.keyboard.press('Escape');
    const picker = host.getByLabel('Жесты персонажа');
    await expect(picker.getByRole('option')).toHaveCount(4);
    const name = await picker.getByRole('option').last().innerText();
    const card = guest.getByRole('article', { name, exact: true });
    const pager = guest.getByRole('navigation', { name: 'Страницы сцены' });
    await expect(pager).toContainText('1 / 2');
    await expect(card).toHaveCount(0);
    await picker.selectOption({ label: name });
    await host.getByRole('button', { name: 'Помахать', exact: true }).click();
    const cue = (gesture: string) =>
      guest.getByRole('button', {
        name: 'Показать на сцене: ' + name + ' — ' + gesture,
        exact: true,
      });
    await expect(cue('Помахать')).toBeVisible();
    await host.getByRole('button', { name: 'Смеяться', exact: true }).click();
    await expect(cue('Смеяться')).toBeVisible();
    await expectStageHits(guest);
    await expect(cue('Помахать')).toHaveCount(0);
    await expect(host.getByRole('article', { name, exact: true })).not.toHaveAttribute(
      'data-gesture',
      'laugh',
    );
    await expect(pager).toContainText('1 / 2');
    const reveal = cue('Смеяться');
    await reveal.focus();
    await guest.keyboard.press('Shift+Tab');
    await guest.keyboard.press('Tab');
    await expect(reveal).toBeFocused();
    const strip = guest.locator('[aria-live="polite"]').filter({ has: reveal });
    const focused = await strip.screenshot();
    const withoutRing = await strip.screenshot({
      style: ':focus-visible { outline-color: transparent !important; }',
    });
    expect(focused.equals(withoutRing), 'The gesture notice must show keyboard focus').toBe(false);
    await guest.keyboard.press('Enter');
    await expect(pager).toContainText('2 / 2');
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: 'Повернуть на 360°: ' + name })).toBeFocused();
    await expect(cue('Смеяться')).toHaveCount(0);
    await host.getByRole('button', { name: 'Предыдущие участники' }).click();
    await card.getByRole('button', { name: 'Повернуть на 360°: ' + name }).click();
    await expectStageHits(host);
    await pager.getByRole('button', { name: 'Предыдущие участники' }).click();
    await expect(cue('Смеяться')).toHaveCount(0);
  } finally {
    await Promise.all(pages.map((page) => page.close()));
    await room.stop();
  }
});
