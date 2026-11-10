import type { ReferenceSlot } from "@panelstudio/contracts";
import { gutterRegions } from "./reference-gutters";

export type Region = Omit<ReferenceSlot, "unitId">;
export type ReferenceImage = { name: string; preview: string; aspect: number; regions: Region[];
  alternative?: Region[]; method: "native" | "outlines" | "gutters" };
const valid = (r: Region) => Object.values(r).every(Number.isFinite) && r.x >= 0 && r.y >= 0 &&
  r.width > 0 && r.height > 0 && r.x + r.width <= 1.000001 && r.y + r.height <= 1.000001;

function readingOrder(regions: Region[]): Region[] {
  const result: Region[] = [], rest = [...regions].sort((a, b) => a.y - b.y);
  while (rest.length) {
    const y = rest[0]!.y;
    const next = rest.findIndex((r) => r.y > y + 0.025);
    result.push(...rest.splice(0, next < 0 ? rest.length : next).sort((a, b) => a.x - b.x));
  }
  return result;
}

function panelStudioRegions(xml: string): Region[] {
  const root = new DOMParser().parseFromString(xml, "image/svg+xml").documentElement;
  const view = root.getAttribute("viewBox")?.trim().split(/[ ,\s]+/).map(Number);
  if (root.localName !== "svg" || !view || view.length !== 4 || !(view[2]! > 0 && view[3]! > 0)) return [];
  const regions: Region[] = [];
  for (const clip of root.querySelectorAll("clipPath[id]")) {
    if (!/^panel-[\da-f-]{36}-crop$/i.test(clip.id)) continue;
    const rect = clip.firstElementChild;
    if (rect?.localName !== "rect") continue;
    const val = (key: string) => Number(rect.getAttribute(key));
    const r = { x: (val("x") - view[0]!) / view[2]!, y: (val("y") - view[1]!) / view[3]!,
      width: val("width") / view[2]!, height: val("height") / view[3]! };
    if (valid(r)) regions.push(r);
  }
  return readingOrder(regions);
}

/** Detect substantial enclosed panels or continuous image blocks. Small marks, text,
 * a figure-wide border and rectangles inside other panels are discarded. */
function inkMask(pixels: Uint8ClampedArray, w: number, h: number) {
  const n = w * h, mask = new Uint8Array(n);
  const bins = new Uint32Array(4096);
  const bin = (i: number) => (pixels[i]! >> 4) * 256 + (pixels[i + 1]! >> 4) * 16 + (pixels[i + 2]! >> 4);
  for (let p = 0; p < n; p += 7) bins[bin(p * 4)]!++;
  let mode = 0;
  for (let i = 1; i < bins.length; i++) if (bins[i]! > bins[mode]!) mode = i;
  const bg = [mode >> 8, (mode >> 4) & 15, mode & 15].map((v) => v * 16 + 8);
  for (let p = 0; p < n; p++) if (bg.some((v, c) => Math.abs(pixels[4 * p + c]! - v) > 36)) mask[p] = 1;
  return mask;
}
function outlines(mask: Uint8Array, w: number, h: number): Region[] {
  const n = w * h, queue = new Int32Array(n);
  const found: Region[] = [];
  for (let p = 0; p < n; p++) {
    if (mask[p] !== 1) continue;
    let size = 1, left = w, right = 0, top = h, bottom = 0;
    queue[0] = p; mask[p] = 2;
    for (let i = 0; i < size; i++) {
      const q = queue[i]!, x = q % w, y = Math.floor(q / w);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++)
        for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
          const neighbor = yy * w + xx;
          if (mask[neighbor] === 1) { mask[neighbor] = 2; queue[size++] = neighbor; }
        }
    }
    const width = right - left + 1, height = bottom - top + 1, area = width * height;
    if (width < w * 0.1 || height < h * 0.075 || area < n * 0.015 || area > n * 0.96) continue;
    const sides = [new Set<number>(), new Set<number>(), new Set<number>(), new Set<number>()];
    for (let i = 0; i < size; i++) {
      const x = queue[i]! % w, y = Math.floor(queue[i]! / w);
      if (y - top <= 2) sides[0]!.add(x);
      if (bottom - y <= 2) sides[1]!.add(x);
      if (x - left <= 2) sides[2]!.add(y);
      if (right - x <= 2) sides[3]!.add(y);
    }
    if (size / area > 0.58 || sides.every((side, i) => side.size >= 0.72 * (i < 2 ? width : height)))
      found.push({ x: left / w, y: top / h, width: width / w, height: height / h });
  }
  const outer = found.filter((r) => !found.some((b) => b !== r && b.x <= r.x && b.y <= r.y &&
    b.x + b.width >= r.x + r.width - 1e-7 && b.y + b.height >= r.y + r.height - 1e-7));
  return readingOrder(outer.sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 16));
}

export function detectReference(pixels: Uint8ClampedArray, w: number, h: number, target: number): Pick<ReferenceImage,"regions"|"alternative"|"method"> {
  const mask=inkMask(pixels,w,h);
  const borders=outlines(mask,w,h);
  const bands=readingOrder(gutterRegions(mask,w,h,target));
  const coverage=borders.reduce((sum,r)=>sum+r.width*r.height,0);
  const useBands=bands.length>=2 && ((bands.length===target && (borders.length!==target || coverage<.5)) || borders.length<2);
  const [regions,alternative]=useBands?[bands,borders]:[borders,bands];
  return {regions,method:useBands?"gutters":"outlines",...(alternative.length && JSON.stringify(regions)!==JSON.stringify(alternative)?{alternative}:{})};
}
export async function readReference(file: File, target: number): Promise<ReferenceImage> {
  if (!/\.(png|jpe?g|webp|svg)$/i.test(file.name) || file.size > 12 * 1024 * 1024) throw new Error("format");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h || w * h > 64000000 || Math.max(w / h, h / w) > 80) throw new Error("size");
    const scale = Math.min(1, 720 / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const native = /\.svg$/i.test(file.name) ? panelStudioRegions(await file.text()) : [];
    const analysis = native.length >= 2 ? {regions:native,method:"native" as const} :
      detectReference(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, target);
    return { name: file.name, preview: canvas.toDataURL("image/png"), aspect: w / h, ...analysis };
  } finally { URL.revokeObjectURL(url); }
}
