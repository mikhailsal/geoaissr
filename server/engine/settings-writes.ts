import type { SettingsFile } from '../../shared/storage-schemas.ts';
import type { EngineEvent, RoomState } from './types.ts';

export function createSettingsWrites(opts: {
  getState: () => RoomState;
  save: (settings: SettingsFile) => void;
  saveReset: (settings: SettingsFile) => void | Promise<void>;
  dispatch: (event: EngineEvent) => unknown;
  onError?: (context: string, error: unknown) => void;
  isDisposed: () => boolean;
}) {
  let tail = Promise.resolve();
  function enqueue<T>(task: () => T | Promise<T>): Promise<T> {
    const pending = tail.then(task);
    tail = pending.then(
      () => {},
      (error: unknown) => opts.onError?.('save_settings', error),
    );
    return pending;
  }
  return {
    enqueue,
    save(): void {
      // A queued normal write must retain earlier durable edits and reset timestamps.
      void enqueue(() => {
        opts.save(opts.getState().settings);
      });
    },
    reset(botId: string, at: string): void {
      void enqueue(async () => {
        const settings = opts.getState().settings;
        if (!settings.bots.some((bot) => bot.id === botId)) return;
        const bots = settings.bots.map((bot) =>
          bot.id === botId ? { ...bot, winResetAt: at } : bot,
        );
        try {
          await opts.saveReset({ ...settings, bots });
          if (!opts.isDisposed())
            opts.dispatch({ type: 'bot_wins_reset_result', botId, at, ok: true });
        } catch (error) {
          opts.onError?.('reset_bot_wins', error);
          if (!opts.isDisposed())
            opts.dispatch({ type: 'bot_wins_reset_result', botId, at, ok: false });
        }
      });
    },
  };
}
