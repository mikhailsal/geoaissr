/** Legacy post-hoc reasoning. Old results carry it; new rounds use `BotJournal` instead. */
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
  /** Detective only: the usage of each process; `tokenUsage` is their sum. */
  roleUsage?: { brain?: BotTokenUsage; eyes?: BotTokenUsage };
  /** Detective only: the model each process ran on. */
  roleModels?: { brain: string; eyes: string };
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
  /** Detective: the number the eyes know this frame by («кадр 5»). */
  n?: number;
  /**
   * `distanceM` is set on a long move: the road distance it covered, in metres. `fromStartM` is
   * set on a frame taken away from the start: the straight-line distance to it, in metres.
   */
  params?: {
    heading: number;
    pitch?: number;
    fov?: number;
    step?: number;
    distanceM?: number;
    fromStartM?: number;
  };
  hypothesis?: string;
}
