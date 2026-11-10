import { create, type Font } from "fontkit";

export type FaceFile = { filename: string; sha256: string };

export function parseFace(bytes: Uint8Array): Font {
  // fontkit accepts Uint8Array in both builds. The Node type declaration uses Buffer.
  const font = create(bytes as Parameters<typeof create>[0]);
  if (!("layout" in font)) throw new Error("Expected a single bundled TrueType face.");
  return font;
}
