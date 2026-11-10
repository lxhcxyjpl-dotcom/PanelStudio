import { describe, expect, it } from "vitest";
import { BUNDLED_FONTS, LAYOUT_SCORE_WEIGHTS, RESOURCE_LIMITS, TOLERANCES } from "./constants.js";
import { DOCUMENT_INVARIANTS } from "./invariants.js";
import { ERROR_CODES } from "./errors.js";
import { formatLabel, labelCore, resolveLabelText } from "./labels.js";
import { LocalePackSchema, REPRESENTATIVE_MESSAGES } from "./locale.js";
import { SVG_SUPPORT } from "./svg-support.js";
import { fontSizePtToSvgUserUnits, pngPixelsFromMm, UNITS } from "./units.js";
import { expectValid } from "./test-utils.js";

describe("units and labels", () => {
  it("keeps document units distinct", () => {
    expect(UNITS).toEqual({
      documentGeometry: "mm",
      fontSize: "pt",
      crop: "normalized-0-1",
      ui: "css-px",
      svgUserUnit: "mm",
    });
    expect(TOLERANCES.geometryComparisonMm).toBe(0.0001);
    expect(TOLERANCES.uniformScaleRelative).toBe(0.000001);
    expect(TOLERANCES.svgCoordinateDecimalPlaces).toBe(6);
  });

  it("converts 9 pt to 3.175 user units and rounds PNG pixels", () => {
    expect(Number(fontSizePtToSvgUserUnits(9).toFixed(6))).toBe(3.175);
    expect(pngPixelsFromMm(180, 600)).toBe(4252);
  });

  it("numbers from 1 and does not reformat custom text", () => {
    expect(formatLabel("A", "plain")).toBe("A");
    expect(formatLabel("A", "parentheses")).toBe("(A)");
    expect(formatLabel("A", "dot")).toBe("A.");
    expect(labelCore(0, "upper-alpha")).toBe("A");
    expect(labelCore(0, "number")).toBe("1");
    expect(labelCore(2, "number")).toBe("3");
    expect(
      resolveLabelText({
        index: 0,
        textOverride: "(i)",
        sequence: "upper-alpha",
        format: "parentheses",
      }),
    ).toBe("(i)");
    expect(
      resolveLabelText({
        index: 1,
        textOverride: null,
        sequence: "lower-alpha",
        format: "parentheses",
      }),
    ).toBe("(b)");
  });
});

describe("catalogs", () => {
  it("lists every handbook error code and its HTTP status", () => {
    expect(ERROR_CODES.REQUEST_INVALID.httpStatus).toBe(400);
    expect(ERROR_CODES.NOT_FOUND.httpStatus).toBe(404);
    expect(ERROR_CODES.PROJECT_DELETED.httpStatus).toBe(409);
    expect(ERROR_CODES.REVISION_CONFLICT.httpStatus).toBe(409);
    expect(ERROR_CODES.CANDIDATE_STALE.httpStatus).toBe(409);
    expect(ERROR_CODES.IDEMPOTENCY_KEY_REUSED.httpStatus).toBe(409);
    expect(ERROR_CODES.ASSET_IN_USE.httpStatus).toBe(409);
    expect(ERROR_CODES.FILE_TOO_LARGE.httpStatus).toBe(413);
    expect(ERROR_CODES.UNSUPPORTED_MEDIA_TYPE.httpStatus).toBe(415);
    expect(ERROR_CODES.DOCUMENT_INVALID.httpStatus).toBe(422);
    expect(ERROR_CODES.LOCKED_ELEMENT.httpStatus).toBe(422);
    expect(ERROR_CODES.GROUP_PARTIAL_EDIT.httpStatus).toBe(422);
    expect(ERROR_CODES.OUTSIDE_CANVAS.httpStatus).toBe(422);
    expect(ERROR_CODES.LAYOUT_CONFLICT.httpStatus).toBe(422);
    expect(ERROR_CODES.EXPORT_TOO_LARGE.httpStatus).toBe(422);
    expect(ERROR_CODES.SVG_UNSUPPORTED_FEATURE.httpStatus).toBeNull();
    expect(ERROR_CODES.FONT_MISSING.httpStatus).toBeNull();
    expect(ERROR_CODES.PROVIDER_NOT_CONFIGURED.httpStatus).toBeNull();
    expect(ERROR_CODES.PROVIDER_CONFIG_CHANGED.httpStatus).toBeNull();
    expect(ERROR_CODES.MODEL_OUTPUT_INVALID.httpStatus).toBeNull();
    expect(ERROR_CODES.SERVER_RESTARTED.httpStatus).toBeNull();
    expect(Object.keys(ERROR_CODES)).toHaveLength(21);
  });

  it("records the SVG preserve and reject lists", () => {
    const shapes = SVG_SUPPORT.preserve.shapes.join(",");
    expect(SVG_SUPPORT.preserve.containers).toEqual(["svg", "g"]);
    expect(shapes).toContain("path");
    expect(shapes).toContain("polygon");
    expect(SVG_SUPPORT.preserve.text).toEqual(["text", "tspan"]);
    expect(SVG_SUPPORT.reject.join(" ")).toContain("foreignObject");
    expect(SVG_SUPPORT.reject.join(" ")).toContain("filter");
    expect(SVG_SUPPORT.normalizationSteps).toHaveLength(10);
    expect(SVG_SUPPORT.unsupportedFeaturePolicy).toContain("不能删除后继续");
  });

  it("uses the handbook score weights and resource limits", () => {
    expect(LAYOUT_SCORE_WEIGHTS).toEqual({
      readability: 0.25,
      whitespace: 0.2,
      emphasis: 0.2,
      consistency: 0.15,
      height: 0.1,
      movement: 0.1,
    });
    expect(RESOURCE_LIMITS.maxPanelsPerProject).toBe(8);
    expect(RESOURCE_LIMITS.maxUploadBytes).toBe(25 * 1024 * 1024);
    expect(RESOURCE_LIMITS.maxAiPromptCharacters).toBe(4000);
    expect(RESOURCE_LIMITS.aiModelCallBudget).toBe(3);
    expect(DOCUMENT_INVARIANTS).toHaveLength(14);
  });

  it("names the real bundled font families", () => {
    expect(BUNDLED_FONTS.map((font) => font.family)).toEqual(["Noto Sans", "Noto Sans SC"]);
    expect(BUNDLED_FONTS.map((font) => font.fontId)).toEqual(["noto-sans", "noto-sans-sc"]);
  });

  it("validates the representative locale strings", () => {
    expect(REPRESENTATIVE_MESSAGES["zh-CN"]["toolbar.import"]).toBe("导入图片");
    expect(REPRESENTATIVE_MESSAGES["en-US"]["save.failed"]).toBe(
      "Save failed. Your draft is retained.",
    );
    expectValid(LocalePackSchema, {
      schemaVersion: 1,
      locale: "en-US",
      displayName: "English",
      direction: "ltr",
      messages: REPRESENTATIVE_MESSAGES["en-US"],
    });
  });
});
