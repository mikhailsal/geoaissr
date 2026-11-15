import type { MatchRecord } from '../../shared/storage-schemas.ts';
import type { ServerLogger } from '../log.ts';
import { readMatchRecords } from '../storage/matches.ts';

export function loadWinsHistory(
  file: string,
  logger: ServerLogger,
): { records: MatchRecord[]; warning?: string } {
  try {
    return { records: readMatchRecords(file).records };
  } catch (error) {
    logger.log('shell_async_error', {
      context: 'read_match_history',
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      records: [],
      warning: 'Не удалось загрузить историю побед. Статистика может быть неполной.',
    };
  }
}
