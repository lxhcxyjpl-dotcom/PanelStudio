import { expect, it } from "vitest";
import { allImagesClause } from "./wish";
it("keeps a specific two-image choice distinct from taking a larger library", () => {
  expect(allImagesClause("两张图都用", 2)).toBe(true);
  expect(allImagesClause("两张图都用", 3)).toBe(false);
  expect(allImagesClause("use both images", 3)).toBe(false);
  expect(allImagesClause("请把这些图全部保留", 4)).toBe(true);
  expect(allImagesClause("不要全部用", 2)).toBe(false);
});
