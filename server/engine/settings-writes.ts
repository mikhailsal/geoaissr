import type { SettingsFile } from '../../shared/storage-schemas.ts';
import type { EngineEvent, RoomState } from './types.ts';

export function createSettingsWrites(opts: {
  getState: () => RoomState;
  save: (settings: SettingsFile) => Promise<void>;
  saveReset: (settings: SettingsFile) => Promise<void>;
  dispatch: (event: EngineEvent) => unknown;
  onError?: (context: string, error: unknown) => void;
  isDisposed: () => boolean;
}) {
  let tail = Promise.resolve();
  function enqueue(task: () => Promise<void>): void {
    tail = tail.then(task).catch((error: unknown) => {
      opts.onError?.('save_settings', error);
    });
  }
  return {
    save(settings: SettingsFile): void {
      enqueue(async () => {
        const current = opts.getState().settings;
        const bots = settings.bots.map((bot) => {
          const live = current.bots.find((entry) => entry.id === bot.id);
          return live ? { ...bot, winResetAt: live.winResetAt } : bot;
        });
        await opts.save({ ...settings, bots });
      });
    },
    reset(botId: string, at: string): void {
      enqueue(async () => {
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
