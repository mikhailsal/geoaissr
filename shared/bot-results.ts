export interface BotReasoning {
  facts?: string;
  rejectedGuesses?: Array<{ guess: string; reason: string }>;
  conclusion?: string;
}

/** Input includes cached reads; cachedInputTokens is a subset of inputTokens. */
export interface BotTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
}

export interface BotCostEstimate {
  costUsd: number | null;
  matchedModelId?: string;
  isApproximateMatch?: boolean;
}

/** Optional fields preserve older in-memory and saved round views. */
export interface BotAccounting {
  tokenUsage?: BotTokenUsage;
  costUsd?: number | null;
  matchedModelId?: string;
  isApproximateMatch?: boolean;
}

export interface BotTurnThumbView {
  turn: number;
  action: 'observe' | 'look' | 'move';
  label: string;
  thumbUrl: string;
  fullUrl?: string;
  params?: { heading: number; pitch?: number; fov?: number; step?: number };
  hypothesis?: string;
}
