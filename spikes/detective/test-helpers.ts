import type { RoundTarget } from '../../server/engine/types.ts';
import type { BotImageService, RenderedBotImage } from '../../server/images/bot-image-service.ts';
import type { EvalSampleItem } from '../../scripts/eval-bots/manifest.ts';
import { loadCatalog } from './catalog.ts';
import { createDetectiveSession, type DetectiveSession } from './session.ts';
import type { SessionOptions } from './state.ts';

/** Fixtures shared by the spike tests: a labelled spot and an image service with tiny frames. */

export const SAMPLE: EvalSampleItem = {
  id: 'spot-a',
  countryNameRu: 'Япония',
  lat: 35,
  lng: 139,
  headingDeg: 10,
  labels: { driving_side: 'left', script: 'japanese', roof_type: null },
  signText: [{ frame: 1, text: 'ローソン LAWSON' }],
};

const TARGET: RoundTarget = {
  panoId: 'm1',
  lat: SAMPLE.lat,
  lng: SAMPLE.lng,
  countryId: 'EVAL',
  countryNameRu: SAMPLE.countryNameRu,
  region: 'world',
  fakeSceneIndex: 0,
};

function frame(label: string): RenderedBotImage {
  return { jpeg: Buffer.from('jpeg'), label } as RenderedBotImage;
}

export function stubImageService(): BotImageService {
  const service: Partial<BotImageService> = {
    prepareStartViews: () => Promise.resolve(),
    getObserveViews: () => Promise.resolve([0, 1, 2, 3].map((i) => frame(`вид ${i}`))),
    getLookView: (o) => Promise.resolve(frame(`курс ${o.heading}°`)),
    clearRound: () => undefined,
  };
  return service as BotImageService;
}

export function makeSession(overrides: Partial<SessionOptions> = {}): DetectiveSession {
  const session = createDetectiveSession({
    sample: SAMPLE,
    catalog: loadCatalog(),
    imageService: stubImageService(),
    target: TARGET,
    imageSize: 640,
    moveLimit: 2,
    budgetSec: 90,
    answerSource: 'eyes',
    askTimeoutMs: 2000,
    nextRequestWaitMs: 50,
    ...overrides,
  });
  session.start();
  return session;
}

export const FIRST_ASK = {
  hypothesis: 'Сторона движения разделит версии.',
  questions: [
    { kind: 'feature', feature: 'driving_side' },
    { kind: 'text', target: 'самая крупная вывеска' },
  ],
};

export const SECOND_ASK = {
  hypothesis: 'Крыши сузят регион.',
  questions: [{ kind: 'feature', feature: 'roof_type' }],
  finding: 'Левостороннее движение: версии с правым движением отпали.',
  current_guess: { lat: 35.5, lng: 139.5 },
};
