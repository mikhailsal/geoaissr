/** Accept pasted display codes, but bound the original input before normalization. */
export function normalizeProfileToken(raw: string): string | null {
  if (raw.length > 64) return null;
  const token = raw.replace(/[\s-]/g, '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(token) ? token : null;
}
export function formatProfileToken(token: string): string {
  return token.match(/.{1,4}/g)?.join('-') ?? token;
}
