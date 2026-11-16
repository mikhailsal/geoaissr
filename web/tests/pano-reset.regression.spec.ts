import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

const fixture = `<script>
  import { tick } from 'svelte';
  import PanoView from '${path.resolve('web/src/components/PanoView.svelte')}';
  let round = $state(1);
  let move = $state(true);
  window.nextRound = () => { round = 2; };
  window.updateRound = async () => { move = !move; await tick(); };
</script>
<PanoView fakeMode={false} browserMapsKey="test" panoId={round === 1 ? 'first' : 'second'} fakeSceneIndex={0} roundNumber={round} moveEnabled={move} onPanoLoaded={() => {}} onClientError={() => {}} />`;
const mapsMock = `
const camera = window.camera = { pano: '', heading: 0, pitch: 0, zoom: 0 };
const pano = {
 getStatus: () => 'OK', getPano: () => camera.pano,
 getPov: () => ({heading: camera.heading, pitch: camera.pitch}),
 addListener: () => ({remove() {}}), setOptions() {},
 setPano(id) { camera.pano = id; },
 setPov(pov) { camera.heading = pov.heading; camera.pitch = pov.pitch; },
 setZoom(zoom) { camera.zoom = zoom; }
};
export async function mountReusableStreetView() { return pano; }
`;

// QA attribution: /tmp/geoaissr-qa-20261116/qa-report-geoaissr-2026-11-16.md
// protects=round camera reset for a reused panorama; fails_when=zoom survives a new round or same-round updates reset movement; why_new=existing fake-mode tests do not exercise the Google panorama camera; seam=none; no_claim=Google service behavior.
test('resets the reused panorama camera once per round', async ({ page }) => {
  const temp = mkdtempSync(path.resolve('web/src/pano-fixture-'));
  const fixturePath = path.join(temp, 'Fixture.svelte');
  writeFileSync(fixturePath, fixture);
  writeFileSync(
    path.join(temp, 'entry.js'),
    "import { mount } from 'svelte'; import Component from './Fixture.svelte'; mount(Component, { target: document.body });",
  );
  writeFileSync(
    path.join(temp, 'index.html'),
    '<!doctype html><html><body><script type="module" src="./entry.js"></script></body></html>',
  );
  const server = await createServer({
    configFile: path.resolve('vite.config.ts'),
    server: { port: 0, proxy: {} },
    plugins: [
      {
        name: 'mock-pano-loader',
        enforce: 'pre',
        resolveId(source, importer) {
          if (source === '../lib/maps-loader' && importer?.endsWith('/PanoView.svelte'))
            return '\0mock-pano-loader';
        },
        load(id) {
          if (id === '\0mock-pano-loader') return mapsMock;
        },
      },
    ],
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Missing Vite address');
    await page.goto(`http://localhost:${address.port}/src/${path.basename(temp)}/index.html`);
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { camera?: { pano: string } }).camera?.pano),
      )
      .toBe('first');
    await page.evaluate(async () => {
      const state = window as unknown as {
        camera: { pano: string; heading: number; pitch: number; zoom: number };
        updateRound: () => Promise<void>;
      };
      Object.assign(state.camera, { pano: 'moved', heading: 80, pitch: 30, zoom: 3 });
      await state.updateRound();
    });
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { camera: object }).camera))
      .toEqual({ pano: 'moved', heading: 80, pitch: 30, zoom: 3 });
    await page.evaluate(() => {
      (window as unknown as { nextRound: () => void }).nextRound();
    });
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { camera: object }).camera))
      .toEqual({ pano: 'second', heading: 0, pitch: 0, zoom: 0 });
  } finally {
    await server.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
