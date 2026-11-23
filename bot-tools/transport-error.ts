import type { DetectiveRole } from '../shared/detective-tools.ts';

/** Stable code at the end of the text a bot gets when the bridge cannot reach the game server. */
export const BRIDGE_UNREACHABLE_CODE = 'GEO_BOT_BRIDGE_UNREACHABLE';

/** Paid tools: the server may have charged the turn before the reply was lost. */
const PAID_TOOLS: ReadonlySet<string> = new Set(['look', 'move']);

function recoveryAdvice(toolName: string, role: DetectiveRole | undefined): string {
  const paid = PAID_TOOLS.has(toolName);
  // The eyes have no final_guess: they can only answer from what they already saw, or stop.
  if (role === 'eyes') {
    return paid
      ? 'Ход мог быть уже списан, не повторяйте его: отвечайте по кадрам, которые уже получены.'
      : 'Повторите вызов один раз; если ошибка повторится — завершите работу.';
  }
  return paid
    ? 'Ход мог быть уже списан, не повторяйте его: отправьте лучшую точку через final_guess.'
    : 'Повторите вызов один раз; если ошибка повторится — вызовите final_guess.';
}

/**
 * The tool result for a transport failure (server down, connection reset, a body that is not
 * JSON, a frame that could not be saved). The model gets a recovery line and a code, not the
 * raw exception text, which could carry the local URL. A paid call may already have been
 * charged, so its line does not ask for a repeat. The line names only tools the role has.
 */
export function transportErrorResult(
  toolName: string,
  role?: DetectiveRole,
): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  const advice = recoveryAdvice(toolName, role);
  return {
    content: [
      {
        type: 'text',
        text: `Нет связи с сервером игры. ${advice} [${BRIDGE_UNREACHABLE_CODE}]`,
      },
    ],
    isError: true,
  };
}
