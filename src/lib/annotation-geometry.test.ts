import { describe, expect, it } from "vitest";
import {
  pointOnPage,
  resizeAnnotation,
  type ResizeCorner,
} from "./annotation-geometry";
import type { Annotation } from "./types";

const page = { width: 600, height: 800 };
const annotation: Annotation = {
  id: "a",
  pageId: "p",
  type: "image",
  x: 100,
  y: 200,
  width: 120,
  height: 60,
};

describe("annotation coordinates", () => {
  it.each([
    [0, 100, 200],
    [90, 600, 100],
    [180, 500, 600],
    [270, 200, 500],
  ])(
    "recovers original PDF points after %i degree rotation and zoom",
    (rotation, x, y) => {
      expect(
        pointOnPage(
          { x: 31 + x * 1.7, y: 47 + y * 1.7 },
          { left: 31, top: 47 },
          1.7,
          { ...page, rotation },
        ),
      ).toEqual({ x: 100, y: 200 });
    },
  );
});

describe("corner resize", () => {
  it.each<ResizeCorner>(["nw", "ne", "sw", "se"])(
    "preserves aspect and the opposite %s corner",
    (corner) => {
      const delta = {
        x: corner.includes("w") ? -60 : 60,
        y: corner.includes("n") ? -30 : 30,
      };
      const result = {
        ...annotation,
        ...resizeAnnotation(annotation, corner, delta, page),
      };
      expect(result.width).toBe(180);
      expect(result.height).toBe(90);
      expect(corner.includes("w") ? result.x + result.width : result.x).toBe(
        corner.includes("w") ? annotation.x + annotation.width : annotation.x,
      );
      expect(corner.includes("n") ? result.y + result.height : result.y).toBe(
        corner.includes("n") ? annotation.y + annotation.height : annotation.y,
      );
    },
  );

  it("constrains growth to the page without stretching images", () => {
    const result = {
      ...annotation,
      ...resizeAnnotation(annotation, "se", { x: 10000, y: 10000 }, page),
    };
    expect(result.x + result.width).toBeLessThanOrEqual(page.width);
    expect(result.y + result.height).toBeLessThanOrEqual(page.height);
    expect(result.width / result.height).toBe(2);
  });

  it("does not flip across the opposite corner", () => {
    const result = {
      ...annotation,
      ...resizeAnnotation(annotation, "nw", { x: 10000, y: 10000 }, page),
    };
    expect(result.width).toBe(16);
    expect(result.height).toBe(8);
    expect(result.x + result.width).toBe(220);
    expect(result.y + result.height).toBe(260);
  });

  it("scales text glyphs and box together and enforces the font limits", () => {
    const text = { ...annotation, type: "text" as const, fontSize: 12 };
    expect(resizeAnnotation(text, "se", { x: 120, y: 60 }, page)).toMatchObject(
      { width: 240, height: 120, fontSize: 24 },
    );
    expect(
      resizeAnnotation(text, "se", { x: -10000, y: -10000 }, page),
    ).toMatchObject({ width: 60, height: 30, fontSize: 6 });
    const smallText = { ...text, x: 0, y: 0, width: 12, height: 12 };
    expect(
      resizeAnnotation(smallText, "se", { x: 10000, y: 10000 }, page).fontSize,
    ).toBe(96);
  });
});
