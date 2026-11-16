const TOKEN_PARAM_RE = /(?:^|&)t=([^&]+)/;
export interface SavedPlayerCreds {
  playerId: string;
  playerSecret: string;
}
function playerStorageKey(): string {
  return `geoaissr:player:${window.location.origin}`;
}

function tabTokenStorageKey(): string {
  return `geoaissr:tok:${window.location.origin}`;
}

export function loadSavedCreds(): SavedPlayerCreds | null {
  try {
    const raw = window.localStorage.getItem(playerStorageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedPlayerCreds>;
    if (typeof parsed.playerId === 'string' && typeof parsed.playerSecret === 'string') {
      return { playerId: parsed.playerId, playerSecret: parsed.playerSecret };
    }
  } catch {
    // Ignore invalid storage payload
  }
  return null;
}

export function saveCreds(creds: SavedPlayerCreds): void {
  try {
    window.localStorage.setItem(playerStorageKey(), JSON.stringify(creds));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearCreds(): void {
  try {
    window.localStorage.removeItem(playerStorageKey());
  } catch {
    // Ignore storage errors
  }
}

export function extractAndStripInviteToken(): string | null {
  const hash = window.location.hash;
  if (hash.length > 1) {
    const match = TOKEN_PARAM_RE.exec(hash.slice(1));
    let token: string | null = null;
    if (match?.[1]) {
      try {
        token = decodeURIComponent(match[1]);
      } catch {
        token = null;
      }
    }
    if (token) {
      try {
        window.sessionStorage.setItem(tabTokenStorageKey(), token);
      } catch {
        // Ignore sessionStorage unavailable
      }
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      return token;
    }
  }
  try {
    return window.sessionStorage.getItem(tabTokenStorageKey());
  } catch {
    return null;
  }
}

export function clearStoredSessionToken(): void {
  try {
    window.sessionStorage.removeItem(tabTokenStorageKey());
  } catch {
    // Ignore
  }
}

export function hasInviteFragment(): boolean {
  return TOKEN_PARAM_RE.test(window.location.hash.slice(1));
}
