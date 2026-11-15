import { expect, test, mock, spyOn } from 'bun:test';
import { Loader } from '@googlemaps/js-api-loader';
import { buildPinElement, buildStreetViewUrl, loadGoogleMapsLibraries } from './maps-loader';

// Value: protects=exact pano URL and coordinates; fails_when=query keys or values change;
// why_new=no existing URL contract test; seam=none; no_claim=external coverage or page availability.
test('builds a Street View URL', () => {
  expect(buildStreetViewUrl(-12.5, 45.125)).toBe(
    'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=-12.5,45.125',
  );
});

// Value: protects=pin resets, circular shape, target click and English Loader; fails_when=styles, click or language regress;
// why_new=no existing pin or language unit contract; seam=buildPinElement (non-test caller: createPinOverlay in maps-loader.ts);
// no_claim=inline CSS does not prove browser cascade.
test('configures compact pins and English maps', async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  let callback: ((event: { stopPropagation: () => void }) => void) | undefined;
  const createButton = () => ({
    style: {},
    addEventListener: (_type: string, cb: typeof callback) => {
      callback = cb;
    },
  });
  Object.assign(globalThis, { document: { createElement: createButton }, window: {} });
  const loader = spyOn(Loader.prototype, 'importLibrary').mockImplementation(function (
    this: Loader,
  ) {
    expect(this.options.language).toBe('en');
    return Promise.resolve({}) as never;
  });
  try {
    const click = mock(() => {});
    const pin = buildPinElement({
      id: 'target',
      lat: 0,
      lng: 0,
      fillHex: '',
      inkHex: '',
      label: 'Цель',
      isTarget: true,
      onClick: click,
    });
    expect(pin.type).toBe('button');
    expect(pin.title).toBe('Цель');
    expect(pin.ariaLabel).toBe('Цель');
    expect(pin.style.width).toBe(pin.style.height);
    expect(pin.style.minHeight).toBe('0');
    expect(pin.style.minWidth).toBe('0');
    expect(pin.style.lineHeight).toBe('1');
    expect(pin.style.boxSizing).toBe('border-box');
    expect(pin.style.cursor).toBe('pointer');
    callback?.({ stopPropagation: () => {} });
    expect(click).toHaveBeenCalledTimes(1);
    const ai = buildPinElement({
      id: 'ai',
      lat: 0,
      lng: 0,
      fillHex: '',
      inkHex: '',
      label: 'AI',
      isAi: true,
    });
    expect(ai.style.borderRadius).not.toBe('5px');
    expect(ai.style.width).toBe(ai.style.height);
    await loadGoogleMapsLibraries('test-key');
    expect(loader).toHaveBeenCalledTimes(3);
  } finally {
    loader.mockRestore();
    Object.assign(globalThis, { document: originalDocument, window: originalWindow });
  }
});
