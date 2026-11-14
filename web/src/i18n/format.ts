const pluralRules = new Intl.PluralRules('ru');
const intFmt = new Intl.NumberFormat('ru-RU');

export function pluralizeRu(count: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(count));
  const form = pluralRules.select(abs);
  if (form === 'one') return `${intFmt.format(count)} ${one}`;
  if (form === 'few') return `${intFmt.format(count)} ${few}`;
  return `${intFmt.format(count)} ${many}`;
}

export function formatRoundsRu(count: number): string {
  return pluralizeRu(count, 'раунд', 'раунда', 'раундов');
}

export function formatPointsRu(score: number): string {
  return pluralizeRu(Math.round(score), 'очко', 'очка', 'очков');
}

export function formatTurnsRu(turns: number): string {
  return pluralizeRu(turns, 'ход', 'хода', 'ходов');
}

export function formatNumberRu(n: number): string {
  return intFmt.format(Math.round(n));
}

export function formatDistanceRu(distanceKm: number): string {
  if (distanceKm < 1) {
    return `${intFmt.format(Math.round(distanceKm * 1000))} м`;
  }
  return `${intFmt.format(Math.round(distanceKm))} км`;
}

export function formatTimerClock(msRemaining: number): string {
  const totalSec = Math.max(0, Math.ceil(msRemaining / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

export function formatSecondsOnly(sec: number): string {
  return `${Math.max(0, Math.round(sec))} с`;
}

export function participantDisplayAria(name: string, isAi: boolean): string {
  return isAi ? `${name}, ИИ` : name;
}
