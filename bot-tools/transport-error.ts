/** Stable code at the end of the text a bot gets when the bridge cannot reach the game server. */
export const BRIDGE_UNREACHABLE_CODE = 'GEO_BOT_BRIDGE_UNREACHABLE';

/**
 * The tool result for a transport failure (server down, connection reset, a body that is not
 * JSON). The model gets a recovery line and a code, not the raw exception text, which could
 * carry the local URL.
 */
export function transportErrorResult(): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  return {
    content: [
      {
        type: 'text',
        text: `Нет связи с сервером игры. Повторите вызов один раз; если ошибка повторится — вызовите final_guess. [${BRIDGE_UNREACHABLE_CODE}]`,
      },
    ],
    isError: true,
  };
}
