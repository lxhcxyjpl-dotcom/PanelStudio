import {
  RESOURCE_LIMITS,
  SCHEMA_VERSION,
  isFigureDocument,
  isProjectManifest,
  type Diagnostic,
  type FigureDocumentV1,
  type NormalizedAsset,
  type ProjectManifest,
} from "@panelstudio/contracts";
import { sha256 } from "@panelstudio/core";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { ApiException } from "./http.js";

export type PackagedAsset = {
  id: string;
  originalFilename: string;
  originalMediaType: string;
  diagnostics: Diagnostic[];
  normalized: NormalizedAsset;
  original: Buffer;
  render: Buffer;
  thumbnail: Buffer;
};

export type ReadPackage = {
  manifest: ProjectManifest;
  document: FigureDocumentV1;
  assets: PackagedAsset[];
  fontDependencies: unknown;
};

const LIMIT = RESOURCE_LIMITS.maxProjectPackageUncompressedBytes;

export function buildProjectPackage(input: {
  title: string;
  appVersion: string;
  document: FigureDocumentV1;
  assets: PackagedAsset[];
  preview: Buffer | null;
  fontDependencies: unknown;
  bundledFonts?: Array<{ path: string; bytes: Buffer; mediaType: string }>;
}): Buffer {
  const files = new Map<string, { bytes: Buffer; mediaType: string }>();
  files.set("document.json", {
    bytes: Buffer.from(`${JSON.stringify(input.document, null, 2)}\n`),
    mediaType: "application/json",
  });
  files.set("fonts/dependencies.json", {
    bytes: Buffer.from(`${JSON.stringify(input.fontDependencies, null, 2)}\n`),
    mediaType: "application/json",
  });
  if (input.preview) {
    files.set("preview.png", { bytes: input.preview, mediaType: "image/png" });
  }
  for (const font of input.bundledFonts ?? []) {
    files.set(font.path, { bytes: font.bytes, mediaType: font.mediaType });
  }
  for (const asset of input.assets) {
    const base = `assets/${asset.id}`;
    const originalExt = extensionFor(asset.originalMediaType);
    const renderExt = asset.normalized.renderMediaType === "image/svg+xml" ? ".svg" : ".png";
    files.set(`${base}/original${originalExt}`, {
      bytes: asset.original,
      mediaType: asset.originalMediaType,
    });
    files.set(`${base}/render${renderExt}`, {
      bytes: asset.render,
      mediaType: asset.normalized.renderMediaType,
    });
    files.set(`${base}/thumbnail.png`, { bytes: asset.thumbnail, mediaType: "image/png" });
    files.set(`${base}/asset.json`, {
      bytes: Buffer.from(
        `${JSON.stringify(
          {
            originalFilename: asset.originalFilename,
            originalMediaType: asset.originalMediaType,
            diagnostics: asset.diagnostics,
            normalized: asset.normalized,
          },
          null,
          2,
        )}\n`,
      ),
      mediaType: "application/json",
    });
  }
  const manifest: ProjectManifest = {
    format: "panelstudio-project",
    schemaVersion: SCHEMA_VERSION,
    appVersion: input.appVersion,
    title: input.title,
    files: [...files.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([filePath, file]) => ({
        path: filePath,
        byteLength: file.bytes.byteLength,
        sha256: sha256(file.bytes),
        mediaType: file.mediaType,
      })),
  };
  const zipped: Record<string, Uint8Array> = {
    "manifest.json": strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
  };
  for (const [filePath, file] of files) zipped[filePath] = file.bytes;
  return Buffer.from(zipSync(zipped, { level: 6 }));
}

export function readProjectPackage(bytes: Buffer): ReadPackage {
  assertZipLimits(bytes);
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(bytes));
  } catch {
    throw new ApiException("REQUEST_INVALID", "The project package is not a zip archive.");
  }
  let actual = 0;
  for (const value of Object.values(entries)) {
    actual += value.byteLength;
    if (actual > LIMIT) throw new ApiException("FILE_TOO_LARGE", "The project package exceeds the size limit.");
  }
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) throw new ApiException("DOCUMENT_INVALID", "The project package has no manifest.");
  const manifest = parseJson(strFromU8(manifestBytes), "manifest");
  if (!isProjectManifest(manifest)) {
    throw new ApiException("DOCUMENT_INVALID", "The project manifest is invalid.");
  }
  const listed = new Set(manifest.files.map((file) => file.path));
  for (const name of Object.keys(entries)) {
    if (name === "manifest.json") continue;
    if (name.endsWith("/") && (entries[name]?.byteLength ?? 0) === 0) continue;
    assertSafeZipPath(name);
    if (!listed.has(name)) throw new ApiException("DOCUMENT_INVALID", "The project package contains an unexpected file.");
  }
  const files = new Map<string, Buffer>();
  for (const file of manifest.files) {
    assertSafeZipPath(file.path);
    const data = entries[file.path];
    if (!data) throw new ApiException("DOCUMENT_INVALID", "A manifest file is missing from the package.");
    const buffer = Buffer.from(data);
    if (buffer.byteLength !== file.byteLength || sha256(buffer) !== file.sha256) {
      throw new ApiException("DOCUMENT_INVALID", "A packaged file does not match its manifest hash.");
    }
    files.set(file.path, buffer);
  }
  const documentBytes = files.get("document.json");
  if (!documentBytes) throw new ApiException("DOCUMENT_INVALID", "The project package has no document.");
  const document = parseJson(documentBytes.toString("utf8"), "document");
  if (!isFigureDocument(document)) {
    throw new ApiException("DOCUMENT_INVALID", "The packaged document is invalid.");
  }
  const dependencies = files.get("fonts/dependencies.json");
  if (!dependencies) throw new ApiException("DOCUMENT_INVALID", "The project package has no font list.");
  const assets = readAssets(files);
  return {
    manifest,
    document,
    assets,
    fontDependencies: parseJson(dependencies.toString("utf8"), "font list"),
  };
}

export function extensionFor(mediaType: string): string {
  switch (mediaType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/svg+xml":
      return ".svg";
    default:
      return ".bin";
  }
}

function readAssets(files: Map<string, Buffer>): PackagedAsset[] {
  const ids = new Set<string>();
  for (const filePath of files.keys()) {
    const match = /^assets\/([^/]+)\/asset\.json$/u.exec(filePath);
    if (match?.[1]) ids.add(match[1]);
  }
  const assets: PackagedAsset[] = [];
  for (const id of [...ids].sort()) {
    const metaBytes = files.get(`assets/${id}/asset.json`);
    if (!metaBytes) continue;
    const meta = parseJson(metaBytes.toString("utf8"), "asset") as {
      originalFilename?: string;
      originalMediaType?: string;
      diagnostics?: Diagnostic[];
      normalized?: NormalizedAsset;
    };
    if (
      typeof meta.originalFilename !== "string" ||
      typeof meta.originalMediaType !== "string" ||
      !meta.normalized ||
      !Array.isArray(meta.diagnostics)
    ) {
      throw new ApiException("DOCUMENT_INVALID", "An asset record in the package is invalid.");
    }
    const originalExt = extensionFor(meta.originalMediaType);
    const renderExt = meta.normalized.renderMediaType === "image/svg+xml" ? ".svg" : ".png";
    const original = files.get(`assets/${id}/original${originalExt}`);
    const render = files.get(`assets/${id}/render${renderExt}`);
    const thumbnail = files.get(`assets/${id}/thumbnail.png`);
    if (!original || !render || !thumbnail) {
      throw new ApiException("DOCUMENT_INVALID", "An asset in the package is missing a file.");
    }
    if (sha256(render) !== meta.normalized.renderSha256) {
      throw new ApiException("DOCUMENT_INVALID", "A normalized asset does not match its hash.");
    }
    assets.push({
      id,
      originalFilename: meta.originalFilename,
      originalMediaType: meta.originalMediaType,
      diagnostics: meta.diagnostics,
      normalized: meta.normalized,
      original,
      render,
      thumbnail,
    });
  }
  return assets;
}

function assertSafeZipPath(filePath: string): void {
  if (
    filePath.length === 0 ||
    filePath.length > 240 ||
    filePath.startsWith("/") ||
    filePath.includes("\\") ||
    filePath.includes("\0")
  ) {
    throw new ApiException("DOCUMENT_INVALID", "The project package contains an unsafe path.");
  }
  const parts = filePath.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new ApiException("DOCUMENT_INVALID", "The project package contains an unsafe path.");
  }
}

function assertZipLimits(bytes: Buffer): void {
  if (bytes.byteLength > LIMIT) {
    throw new ApiException("FILE_TOO_LARGE", "The project package exceeds the size limit.");
  }
  const eocd = findEocd(bytes);
  if (eocd < 0) throw new ApiException("REQUEST_INVALID", "The project package is not a zip archive.");
  const count = bytes.readUInt16LE(eocd + 10);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (count === 0xffff || centralOffset === 0xffffffff) {
    throw new ApiException("FILE_TOO_LARGE", "Zip64 project packages are not supported.");
  }
  let cursor = centralOffset;
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) {
      throw new ApiException("REQUEST_INVALID", "The project package is not a zip archive.");
    }
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const uncompressed = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const external = bytes.readUInt32LE(cursor + 38);
    const versionMadeBy = bytes.readUInt16LE(cursor + 4);
    if ((flags & 0x1) !== 0) throw new ApiException("REQUEST_INVALID", "Encrypted project packages are rejected.");
    if (uncompressed === 0xffffffff || compressed === 0xffffffff) {
      throw new ApiException("FILE_TOO_LARGE", "Zip64 project packages are not supported.");
    }
    if ((versionMadeBy >> 8) === 3 && ((external >>> 16) & 0o170000) === 0o120000) {
      throw new ApiException("DOCUMENT_INVALID", "The project package contains a symlink.");
    }
    if (method !== 0 && method !== 8) {
      throw new ApiException("REQUEST_INVALID", "The project package uses an unsupported compression method.");
    }
    total += uncompressed;
    if (total > LIMIT) throw new ApiException("FILE_TOO_LARGE", "The project package exceeds the size limit.");
    const nameStart = cursor + 46;
    const name = bytes.toString("utf8", nameStart, nameStart + nameLength);
    if (!name.endsWith("/")) assertSafeZipPath(name);
    cursor = nameStart + nameLength + extraLength + commentLength;
  }
}

function findEocd(bytes: Buffer): number {
  const start = Math.max(0, bytes.length - 22 - 0xffff);
  for (let index = bytes.length - 22; index >= start; index -= 1) {
    if (bytes.readUInt32LE(index) === 0x06054b50) return index;
  }
  return -1;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiException("DOCUMENT_INVALID", `The packaged ${label} is not JSON.`);
  }
}
