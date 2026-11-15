import { ASPHALT_900_HEX, PAPER_HEX } from '$shared/colors';
import { REGION_COUNTRIES } from '$shared/regions';

export const MAP_COLORS = {
  ocean: '#DCE8EF',
  land: '#F4EFE4',
  border: '#C6BFA8',
  grid: 'rgba(20, 23, 27, 0.08)',
  ink: ASPHALT_900_HEX,
  paper: PAPER_HEX,
  targetFill: '#FFD23F',
} as const;

export interface FakeMapMarker {
  id: string;
  label: string;
  lat: number;
  lng: number;
  fillHex: string;
  inkHex: string;
  isTarget?: boolean;
  selected?: boolean;
}

export interface FakeMapArc {
  id: string;
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  colorHex: string;
  highlighted?: boolean;
}

export interface MapCamera {
  centerLat: number;
  centerLng: number;
  zoom: number;
}

export function clampLat(lat: number): number {
  return Math.max(-85, Math.min(85, lat));
}

export function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

export function pixelsPerDeg(width: number, zoom: number): number {
  return (width * Math.pow(2, zoom - 1)) / 360;
}

export function projectToScreen(
  lat: number,
  lng: number,
  camera: MapCamera,
  width: number,
  height: number,
): { x: number; y: number } {
  const scale = pixelsPerDeg(width, camera.zoom);
  let dLng = wrapLng(lng - camera.centerLng);
  if (dLng > 180) dLng -= 360;
  if (dLng < -180) dLng += 360;
  const x = width / 2 + dLng * scale;
  const y = height / 2 - (lat - camera.centerLat) * scale;
  return { x, y };
}

export function screenToLatLng(
  x: number,
  y: number,
  camera: MapCamera,
  width: number,
  height: number,
): { lat: number; lng: number } {
  const scale = pixelsPerDeg(width, camera.zoom);
  const lng = wrapLng(camera.centerLng + (x - width / 2) / scale);
  const lat = clampLat(camera.centerLat - (y - height / 2) / scale);
  return { lat, lng };
}

function drawCountryPolygons(
  ctx: CanvasRenderingContext2D,
  camera: MapCamera,
  width: number,
  height: number,
): void {
  const scale = pixelsPerDeg(width, camera.zoom);
  ctx.fillStyle = MAP_COLORS.land;
  ctx.strokeStyle = MAP_COLORS.border;
  ctx.lineWidth = 1;

  for (const offsetDeg of [-360, 0, 360]) {
    for (const country of REGION_COUNTRIES) {
      for (const poly of country.polygons) {
        if (poly.ring.length < 3) continue;
        ctx.beginPath();
        for (let i = 0; i < poly.ring.length; i += 1) {
          const pt = poly.ring[i];
          if (!pt) continue;
          const px = width / 2 + (pt[0] + offsetDeg - camera.centerLng) * scale;
          const py = height / 2 - (pt[1] - camera.centerLat) * scale;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
  }
}

function drawArc(
  ctx: CanvasRenderingContext2D,
  arc: FakeMapArc,
  camera: MapCamera,
  width: number,
  height: number,
): void {
  const to = projectToScreen(arc.toLat, arc.toLng, camera, width, height);
  const dLng = wrapLng(arc.fromLng - arc.toLng);
  const from = projectToScreen(arc.fromLat, arc.toLng + dLng, camera, width, height);
  const scale = pixelsPerDeg(width, camera.zoom);
  const rawFromX = to.x + dLng * scale;

  ctx.save();
  ctx.strokeStyle = arc.colorHex;
  ctx.lineWidth = arc.highlighted ? 3.5 : 2;
  ctx.setLineDash(arc.highlighted ? [] : [6, 5]);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(rawFromX, from.y);
  ctx.stroke();
  ctx.restore();
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  marker: FakeMapMarker,
  camera: MapCamera,
  width: number,
  height: number,
): void {
  const pos = projectToScreen(marker.lat, marker.lng, camera, width, height);
  if (pos.x < -30 || pos.x > width + 30 || pos.y < -30 || pos.y > height + 30) return;

  ctx.save();
  if (marker.isTarget) {
    ctx.fillStyle = MAP_COLORS.targetFill;
    ctx.strokeStyle = MAP_COLORS.ink;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const r = i % 2 === 0 ? 12 : 5.5;
      const angle = (Math.PI / 5) * i - Math.PI / 2;
      const sx = pos.x + Math.cos(angle) * r;
      const sy = pos.y + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    return;
  }

  const radius = marker.selected ? 13 : 10;
  ctx.fillStyle = marker.fillHex;
  ctx.strokeStyle = marker.selected ? MAP_COLORS.paper : MAP_COLORS.ink;
  ctx.lineWidth = marker.selected ? 3 : 2;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (marker.label) {
    ctx.font = '700 11px sans-serif';
    ctx.fillStyle = marker.inkHex;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(marker.label.slice(0, 1).toUpperCase(), pos.x, pos.y + 0.5);
  }
  ctx.restore();
}

export function renderFakeMapCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  camera: MapCamera,
  markers: readonly FakeMapMarker[],
  arcs: readonly FakeMapArc[],
): void {
  ctx.fillStyle = MAP_COLORS.ocean;
  ctx.fillRect(0, 0, width, height);

  drawCountryPolygons(ctx, camera, width, height);

  ctx.strokeStyle = MAP_COLORS.grid;
  ctx.lineWidth = 1;
  for (let lat = -60; lat <= 60; lat += 30) {
    const p = projectToScreen(lat, camera.centerLng, camera, width, height);
    ctx.beginPath();
    ctx.moveTo(0, p.y);
    ctx.lineTo(width, p.y);
    ctx.stroke();
  }
  for (let lng = -150; lng <= 150; lng += 30) {
    const p = projectToScreen(camera.centerLat, lng, camera, width, height);
    ctx.beginPath();
    ctx.moveTo(p.x, 0);
    ctx.lineTo(p.x, height);
    ctx.stroke();
  }

  for (const arc of arcs) {
    drawArc(ctx, arc, camera, width, height);
  }
  for (const marker of markers) {
    if (!marker.isTarget) drawMarker(ctx, marker, camera, width, height);
  }
  for (const marker of markers) {
    if (marker.isTarget) drawMarker(ctx, marker, camera, width, height);
  }
}

interface FakeSceneTheme {
  skyTop: string;
  skyHorizon: string;
  ground: string;
  road: string;
  stripe: string;
  accent: string;
  silhouette: string;
  signText: string;
}

const FAKE_SCENE_THEMES: readonly FakeSceneTheme[] = [
  {
    skyTop: '#314969',
    skyHorizon: '#94ACC2',
    ground: '#4C5447',
    road: '#34383F',
    stripe: '#F4F1EA',
    accent: '#A93A2B',
    silhouette: '#2B3038',
    signText: 'ПРОСПЕКТ · 55°N',
  },
  {
    skyTop: '#3E72A8',
    skyHorizon: '#C5DCF0',
    ground: '#596354',
    road: '#3B3F46',
    stripe: '#FFD23F',
    accent: '#D2C5AE',
    silhouette: '#353C45',
    signText: 'AVENUE · 48°N',
  },
  {
    skyTop: '#2B2B5C',
    skyHorizon: '#DE7F4C',
    ground: '#3E4240',
    road: '#26292E',
    stripe: '#FFD23F',
    accent: '#D94336',
    silhouette: '#191C21',
    signText: 'SHIBUYA · 35°N',
  },
  {
    skyTop: '#1F73B7',
    skyHorizon: '#A8E0F0',
    ground: '#336E52',
    road: '#383C42',
    stripe: '#F4F1EA',
    accent: '#E0B941',
    silhouette: '#295740',
    signText: 'COPACABANA · 22°S',
  },
  {
    skyTop: '#23689B',
    skyHorizon: '#BCE2EC',
    ground: '#4A6E5C',
    road: '#343A42',
    stripe: '#F4F1EA',
    accent: '#EAE5D9',
    silhouette: '#32485B',
    signText: 'HARBOUR · 33°S',
  },
  {
    skyTop: '#56789E',
    skyHorizon: '#E8C58E',
    ground: '#C29D63',
    road: '#695C49',
    stripe: '#F4E3BD',
    accent: '#B5894F',
    silhouette: '#8A673B',
    signText: 'GIZA · 30°N',
  },
  {
    skyTop: '#2A4F7A',
    skyHorizon: '#9CBAD9',
    ground: '#45484F',
    road: '#2B2E35',
    stripe: '#FFD23F',
    accent: '#57687D',
    silhouette: '#1F252E',
    signText: '5TH AVE · 40°N',
  },
];

function drawBuildingStrip(
  ctx: CanvasRenderingContext2D,
  width: number,
  horizonY: number,
  headingDeg: number,
  sceneIndex: number,
  stepOffset: number,
  theme: FakeSceneTheme,
): void {
  const fov = 90;
  for (let i = 0; i < 16; i += 1) {
    const az = i * 22.5;
    let rel = wrapLng(az - headingDeg);
    if (rel > 180) rel -= 360;
    if (rel < -180) rel += 360;
    if (Math.abs(rel) > fov * 0.8) continue;
    const cx = width / 2 + (rel / fov) * width;
    const h = 45 + ((i * 37 + sceneIndex * 19 + stepOffset * 13) % 7) * 18;
    const w = 44 + ((i + sceneIndex) % 3) * 16;
    ctx.fillStyle = i % 3 === 0 ? theme.accent : theme.silhouette;
    ctx.fillRect(cx - w / 2, horizonY - h, w, h);
  }
}

export function renderFakePanoCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  sceneIndex: number,
  headingDeg: number,
  stepOffset: number,
): void {
  const theme =
    FAKE_SCENE_THEMES[Math.abs(sceneIndex) % FAKE_SCENE_THEMES.length] ?? FAKE_SCENE_THEMES[0];
  if (!theme) return;
  const horizonY = Math.round(height * 0.54);

  const skyGrad = ctx.createLinearGradient(0, 0, 0, horizonY);
  skyGrad.addColorStop(0, theme.skyTop);
  skyGrad.addColorStop(1, theme.skyHorizon);
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, horizonY);

  drawBuildingStrip(ctx, width, horizonY, headingDeg, sceneIndex, stepOffset, theme);

  ctx.fillStyle = theme.ground;
  ctx.fillRect(0, horizonY, width, height - horizonY);

  ctx.fillStyle = theme.road;
  ctx.beginPath();
  ctx.moveTo(width * 0.44, horizonY);
  ctx.lineTo(width * 0.56, horizonY);
  ctx.lineTo(width * 0.85, height);
  ctx.lineTo(width * 0.15, height);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = theme.stripe;
  ctx.lineWidth = 4;
  ctx.setLineDash([22, 18]);
  ctx.beginPath();
  ctx.moveTo(width * 0.5, horizonY + 8);
  ctx.lineTo(width * 0.5, height);
  ctx.stroke();
  ctx.setLineDash([]);

  const cardinals: Array<{ deg: number; label: string }> = [
    { deg: 0, label: 'С' },
    { deg: 90, label: 'В' },
    { deg: 180, label: 'Ю' },
    { deg: 270, label: 'З' },
  ];
  let signRel = wrapLng(120 - headingDeg);
  if (signRel > 180) signRel -= 360;
  if (Math.abs(signRel) <= 55) {
    const sx = width / 2 + (signRel / 90) * width;
    const sy = horizonY + 12;
    ctx.fillStyle = ASPHALT_900_HEX;
    ctx.fillRect(sx - 68, sy - 22, 136, 26);
    ctx.fillStyle = PAPER_HEX;
    ctx.font = '600 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(theme.signText, sx, sy - 9);
  }

  for (const c of cardinals) {
    let d = wrapLng(c.deg - headingDeg);
    if (d > 180) d -= 360;
    if (Math.abs(d) > 60) continue;
    const x = width / 2 + (d / 90) * width;
    ctx.fillStyle = PAPER_HEX;
    ctx.font = '700 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(c.label, x, horizonY - 10);
  }
}
