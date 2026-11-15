interface Identity {
  provider: string;
  family: string;
  tier: string;
  version: number[];
  extra: string[];
}
function identity(id: string): Identity | undefined {
  let clean = id.toLowerCase().replace(/-(low|medium|high|xhigh|max)$/, '');
  if (!clean.includes('/')) {
    const prefix = clean.startsWith('claude-')
      ? 'anthropic'
      : clean.startsWith('gpt-')
        ? 'openai'
        : clean.startsWith('gemini-')
          ? 'google'
          : '';
    if (!prefix) return undefined;
    clean = `${prefix}/${clean}`;
  }
  const [provider, name] = clean.split('/');
  if (!provider || !name) return undefined;
  const parts = name.split(/[.\-_]+/).filter(Boolean);
  const family = parts.find((p) => ['claude', 'gpt', 'gemini'].includes(p)) ?? '';
  const tier =
    parts.find((p) =>
      ['haiku', 'sonnet', 'opus', 'flash', 'pro', 'luna', 'sol', 'terra'].includes(p),
    ) ?? '';
  const version = parts.filter((p) => /^\d+$/.test(p)).map(Number);
  const extra = parts.filter((p) => p !== family && p !== tier && !/^\d+$/.test(p)).sort();
  return family && version.length ? { provider, family, tier, version, extra } : undefined;
}
function versionDistance(a: number[], b: number[]): number {
  const major = Math.abs((a[0] ?? 0) - (b[0] ?? 0));
  return (
    major * 10 + Math.abs((a[1] ?? 0) - (b[1] ?? 0)) + Math.abs((a[2] ?? 0) - (b[2] ?? 0)) / 100
  );
}
export function matchModel(
  model: string,
  ids: string[],
): { id: string; approximate: boolean } | undefined {
  const stripped = model.toLowerCase().replace(/-(low|medium|high|xhigh|max)$/, '');
  const exact = ids.find((id) => id.toLowerCase() === stripped);
  if (exact) return { id: exact, approximate: false };
  const wanted = identity(stripped);
  if (!wanted) return undefined;
  const candidates = ids
    .flatMap((id) => {
      const item = identity(id);
      if (
        !item ||
        item.provider !== wanted.provider ||
        item.family !== wanted.family ||
        item.tier !== wanted.tier ||
        item.extra.join() !== wanted.extra.join()
      )
        return [];
      const distance = versionDistance(wanted.version, item.version);
      return distance <= 2 ? [{ id, distance }] : [];
    })
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
  const best = candidates[0];
  return best ? { id: best.id, approximate: best.distance !== 0 } : undefined;
}
