import type { PoiGroup } from "./poi.ts";

/**
 * Small monoline glyph per POI group, rendered to a canvas so MapLibre can
 * use it as a symbol icon — a colored dot doesn't tell you if you're
 * looking at a coffee shop or a restroom; a recognizable glyph does.
 */
function drawGlyph(ctx: CanvasRenderingContext2D, group: PoiGroup, cx: number, cy: number, r: number) {
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = r * 0.16;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  switch (group) {
    case "coffee": {
      // Coffee cup: body + handle.
      const w = r * 0.75;
      const h = r * 0.85;
      ctx.beginPath();
      ctx.roundRect(cx - w / 2, cy - h / 2, w, h * 0.8, [2, 2, r * 0.3, r * 0.3]);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + w / 2 + w * 0.22, cy - h * 0.05, h * 0.22, -Math.PI * 0.5, Math.PI * 0.5);
      ctx.stroke();
      break;
    }
    case "food": {
      // Fork + knife: the universal "restaurant" pictogram.
      const h = r * 0.85;
      const top = cy - h / 2;
      const bottom = cy + h / 2;
      const gap = r * 0.22;
      // Fork: three short tines feeding into a single shaft.
      const forkX = cx - gap;
      for (const dx of [-r * 0.12, 0, r * 0.12]) {
        ctx.beginPath();
        ctx.moveTo(forkX + dx, top);
        ctx.lineTo(forkX + dx, top + h * 0.28);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(forkX - r * 0.12, top + h * 0.28);
      ctx.quadraticCurveTo(forkX, top + h * 0.4, forkX, top + h * 0.4);
      ctx.quadraticCurveTo(forkX, top + h * 0.4, forkX + r * 0.12, top + h * 0.28);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(forkX, top + h * 0.4);
      ctx.lineTo(forkX, bottom);
      ctx.stroke();
      // Knife: a slim blade tapering into the handle.
      const knifeX = cx + gap;
      ctx.beginPath();
      ctx.moveTo(knifeX - r * 0.1, top);
      ctx.quadraticCurveTo(knifeX + r * 0.14, top + h * 0.32, knifeX, top + h * 0.42);
      ctx.lineTo(knifeX, bottom);
      ctx.stroke();
      break;
    }
    case "shop": {
      // Shopping bag: trapezoid body + handle arc.
      const w = r * 0.8;
      const h = r * 0.75;
      ctx.beginPath();
      ctx.moveTo(cx - w / 2, cy - h / 2 + h * 0.15);
      ctx.lineTo(cx + w / 2, cy - h / 2 + h * 0.15);
      ctx.lineTo(cx + w / 2 - w * 0.08, cy + h / 2);
      ctx.lineTo(cx - w / 2 + w * 0.08, cy + h / 2);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy - h / 2 + h * 0.15, w * 0.24, Math.PI, 0);
      ctx.stroke();
      break;
    }
    case "restroom": {
      // Person: filled head + filled body silhouette — a thin-stroked
      // rounded rect for the body read as a blob/ring at small icon
      // sizes since there wasn't enough contrast between the outline
      // and the fill behind it. Solid shapes hold up much better small.
      const headR = r * 0.22;
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.4, headR, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.15, cy - r * 0.08);
      ctx.quadraticCurveTo(cx - r * 0.4, cy - r * 0.05, cx - r * 0.32, cy + r * 0.55);
      ctx.lineTo(cx + r * 0.32, cy + r * 0.55);
      ctx.quadraticCurveTo(cx + r * 0.4, cy - r * 0.05, cx + r * 0.15, cy - r * 0.08);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "elevator": {
      // Up/down chevrons in a frame.
      ctx.beginPath();
      ctx.roundRect(cx - r * 0.42, cy - r * 0.5, r * 0.84, r, r * 0.14);
      ctx.stroke();
      const chev = (dir: 1 | -1, oy: number) => {
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.18, cy + oy + dir * r * 0.14);
        ctx.lineTo(cx, cy + oy - dir * r * 0.1);
        ctx.lineTo(cx + r * 0.18, cy + oy + dir * r * 0.14);
        ctx.stroke();
      };
      chev(1, -r * 0.2);
      chev(-1, r * 0.2);
      break;
    }
    case "landmark": {
      // Five-point star.
      const spikes = 5;
      const outerR = r * 0.5;
      const innerR = r * 0.22;
      ctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const rad = i % 2 === 0 ? outerR : innerR;
        const angle = (Math.PI / spikes) * i - Math.PI / 2;
        const x = cx + Math.cos(angle) * rad;
        const y = cy + Math.sin(angle) * rad;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "transit": {
      // Bus: body + two wheels.
      const w = r * 0.9;
      const h = r * 0.55;
      ctx.beginPath();
      ctx.roundRect(cx - w / 2, cy - h / 2, w, h, r * 0.16);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx - w * 0.28, cy + h / 2, r * 0.1, 0, Math.PI * 2);
      ctx.arc(cx + w * 0.28, cy + h / 2, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: {
      // service (and any future group): a small circled dot.
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.28, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawPoiIcon(group: PoiGroup, color: string, size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.stroke();

  drawGlyph(ctx, group, cx, cy, r);
  return canvas;
}

/** Renders a colored circle + white glyph for `group`, ready for map.addImage(). */
export function renderPoiIcon(group: PoiGroup, color: string, size = 48): ImageData {
  const canvas = drawPoiIcon(group, color, size);
  return canvas.getContext("2d")!.getImageData(0, 0, size, size);
}

/** Same glyph as renderPoiIcon, as a data URL for a plain <img> — the
 * search result list isn't a MapLibre sprite, it's regular DOM. */
export function renderPoiIconDataUrl(group: PoiGroup, color: string, size = 32): string {
  return drawPoiIcon(group, color, size).toDataURL();
}
