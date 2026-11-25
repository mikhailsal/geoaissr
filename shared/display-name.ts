/** Terminal and bidi formatting characters can alter host CLI output when interpolated into it. */
const unsafeDisplayCharacters = /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu;

/** Names may contain normal Unicode, but never terminal control characters. */
export function hasTerminalControlCharacters(value: string): boolean {
  return value.search(unsafeDisplayCharacters) !== -1;
}

/** Make legacy persisted names safe to interpolate into a terminal line. */
export function sanitizeTerminalName(value: string): string {
  return value.replaceAll(unsafeDisplayCharacters, '\uFFFD');
}
