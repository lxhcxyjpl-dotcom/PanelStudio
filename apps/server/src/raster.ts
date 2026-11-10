import { RESOURCE_LIMITS, type NormalizedAsset } from "@panelstudio/contracts";
import { Resvg } from "@resvg/resvg-js";
import sharp, { type Metadata } from "sharp";
import { resvgFontOptions } from "./fonts.js";
import { ApiException } from "./http.js";

const THUMBNAIL_EDGE = 256;

export type RasterMediaType = "image/png" | "image/jpeg" | "image/webp";

export function sniffMediaType(
  bytes: Buffer,
): RasterMediaType | "image/svg+xml" | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  const head = bytes.subarray(0, Math.min(bytes.length, 800)).toString("utf8").replace(/^\uFEFF/u, "").trimStart();
  if (
    head.startsWith("<svg") ||
    head.startsWith("<!DOCTYPE svg") ||
    (head.startsWith("<?xml") && bytes.subarray(0, Math.min(bytes.length, 8000)).toString("utf8").includes("<svg"))
  ) {
    return "image/svg+xml";
  }
  return null;
}

export async function normalizeRaster(
  bytes: Buffer,
  mediaType: RasterMediaType,
): Promise<{
  renderBytes: Buffer;
  thumbnail: Buffer;
  viewport: NormalizedAsset["viewport"];
  rasterPixelSize: { width: number; height: number };
  notes: string[];
}> {
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: RESOURCE_LIMITS.maxRasterDecodePixels,
      animated: false,
    }).metadata();
  } catch {
    throw new ApiException("UNSUPPORTED_MEDIA_TYPE", "The raster image could not be decoded.");
  }
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;
  if (sourceWidth < 1 || sourceHeight < 1) {
    throw new ApiException("UNSUPPORTED_MEDIA_TYPE", "The raster image could not be decoded.");
  }
  if ((metadata.pages ?? 1) > 1) {
    throw new ApiException("UNSUPPORTED_MEDIA_TYPE", "Animated images are not supported.");
  }
  if (sourceWidth * sourceHeight > RESOURCE_LIMITS.maxRasterDecodePixels) {
    throw new ApiException("FILE_TOO_LARGE", "The raster image exceeds the pixel limit.");
  }
  const orientation = metadata.orientation ?? 1;
  const notes = [
    `colorSpace:${metadata.space ?? "unknown"}`,
    `exifOrientation:${orientation}`,
    metadata.hasProfile ? "iccProfile:present" : "iccProfile:absent",
  ];
  const passThroughPng = mediaType === "image/png" && orientation === 1;
  if (passThroughPng) {
    const thumbnail = await sharp(bytes)
      .resize(THUMBNAIL_EDGE, THUMBNAIL_EDGE, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    return {
      renderBytes: bytes,
      thumbnail,
      viewport: { width: sourceWidth, height: sourceHeight },
      rasterPixelSize: { width: sourceWidth, height: sourceHeight },
      notes,
    };
  }
  const rendered = await sharp(bytes, {
    failOn: "error",
    limitInputPixels: RESOURCE_LIMITS.maxRasterDecodePixels,
    animated: false,
  })
    .rotate()
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });
  const thumbnail = await sharp(rendered.data)
    .resize(THUMBNAIL_EDGE, THUMBNAIL_EDGE, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  notes.push(mediaType === "image/png" ? "rendered oriented PNG" : "rendered PNG derivative");
  return {
    renderBytes: rendered.data,
    thumbnail,
    viewport: { width: rendered.info.width, height: rendered.info.height },
    rasterPixelSize: { width: rendered.info.width, height: rendered.info.height },
    notes,
  };
}

/** Raster preview only. Editable SVG is not produced here. */
export function rasterizeSvg(svg: string, pixelWidth: number): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: Math.max(1, Math.round(pixelWidth)) },
    font: resvgFontOptions(),
  });
  return Buffer.from(resvg.render().asPng());
}
