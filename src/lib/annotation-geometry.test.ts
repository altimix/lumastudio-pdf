import { describe, expect, it } from "vitest";
import {
  isAspectLocked,
  pointOnPage,
  resizeAnnotation,
  type ResizeCorner,
  type ResizeHandle,
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

describe("shape resize", () => {
  const shape: Annotation = {
    ...annotation,
    type: "shape",
    shapeKind: "ellipse",
  };

  it('keeps legacy shape resizing free and locks a shape when requested', () => {
    expect(isAspectLocked(shape)).toBe(false);
    const locked = { ...shape, aspectLocked: true };
    const result = { ...locked, ...resizeAnnotation(locked, 'se', { x: 60, y: 0 }, page) };
    expect(isAspectLocked(locked)).toBe(true);
    expect(result.width / result.height).toBeCloseTo(shape.width / shape.height, 8);
  });

  it.each<ResizeCorner>(["nw", "ne", "sw", "se"])(
    "stretches axes independently and anchors the opposite %s corner",
    (corner) => {
      const result = {
        ...shape,
        ...resizeAnnotation(
          shape,
          corner,
          {
            x: corner.includes("w") ? -50 : 50,
            y: corner.includes("n") ? -10 : 10,
          },
          page,
        ),
      };
      expect(result.width).toBe(170);
      expect(result.height).toBe(70);
      expect(corner.includes("w") ? result.x + result.width : result.x).toBe(
        corner.includes("w") ? shape.x + shape.width : shape.x,
      );
      expect(corner.includes("n") ? result.y + result.height : result.y).toBe(
        corner.includes("n") ? shape.y + shape.height : shape.y,
      );
    },
  );

  it.each<ResizeHandle>(["n", "e", "s", "w"])(
    "changes only one axis for the %s edge",
    (handle) => {
      const delta = {
        x: handle === "w" ? -40 : 40,
        y: handle === "n" ? -10 : 10,
      };
      const result = {
        ...shape,
        ...resizeAnnotation(shape, handle, delta, page),
      };
      if (handle === "n" || handle === "s") {
        expect(result.x).toBe(shape.x);
        expect(result.width).toBe(shape.width);
        expect(result.height).toBe(70);
        expect(handle === "n" ? result.y + result.height : result.y).toBe(
          handle === "n" ? shape.y + shape.height : shape.y,
        );
      } else {
        expect(result.y).toBe(shape.y);
        expect(result.height).toBe(shape.height);
        expect(result.width).toBe(160);
        expect(handle === "w" ? result.x + result.width : result.x).toBe(
          handle === "w" ? shape.x + shape.width : shape.x,
        );
      }
    },
  );

  it.each<ResizeHandle>(["nw", "ne", "sw", "se", "n", "e", "s", "w"])(
    "constrains %s to the page and does not flip past the opposite edge",
    (handle) => {
      const grow = {
        x: handle.includes("w") ? -10000 : 10000,
        y: handle.includes("n") ? -10000 : 10000,
      };
      for (const delta of [grow, { x: -grow.x, y: -grow.y }]) {
        const result = {
          ...shape,
          ...resizeAnnotation(shape, handle, delta, page),
        };
        expect(result.x).toBeGreaterThanOrEqual(0);
        expect(result.y).toBeGreaterThanOrEqual(0);
        expect(result.width).toBeGreaterThanOrEqual(8);
        expect(result.height).toBeGreaterThanOrEqual(8);
        expect(result.x + result.width).toBeLessThanOrEqual(page.width);
        expect(result.y + result.height).toBeLessThanOrEqual(page.height);
      }
    },
  );
});

describe("corner resize", () => {
  it('lets an unlocked image and text change one axis without changing their font size', () => {
    const image = { ...annotation, aspectLocked: false };
    expect(isAspectLocked(annotation)).toBe(true);
    expect(resizeAnnotation(image, 'se', { x: 50, y: 10 }, page)).toMatchObject({ width: 170, height: 70 });
    const text = { ...annotation, type: 'text' as const, fontSize: 11, aspectLocked: false };
    expect(resizeAnnotation(text, 'e', { x: 40, y: 0 }, page)).toMatchObject({ width: 160, height: 60 });
    expect(resizeAnnotation(text, 'e', { x: 40, y: 0 }, page)).not.toHaveProperty('fontSize');
  });
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

  it("scales text content and font while preserving fixed padding and font limits", () => {
    const text = { ...annotation, type: "text" as const, fontSize: 12 };
    expect(resizeAnnotation(text, "se", { x: 116, y: 54 }, page)).toMatchObject(
      { width: 236, height: 114, fontSize: 24 },
    );
    expect(
      resizeAnnotation(text, "se", { x: -10000, y: -10000 }, page),
    ).toMatchObject({ width: 62, height: 33, fontSize: 6 });
    const smallText = { ...text, x: 0, y: 0, width: 12, height: 12 };
    expect(
      resizeAnnotation(smallText, "se", { x: 10000, y: 10000 }, page).fontSize,
    ).toBe(96);
  });

  it("keeps eighteen Japanese glyphs on one line when a 240pt text box shrinks", () => {
    const text = {
      ...annotation,
      type: "text" as const,
      width: 240,
      height: 24.2,
      fontSize: 13,
      text: "あ".repeat(18),
    };
    const result = {
      ...text,
      ...resizeAnnotation(text, "se", { x: -120, y: -12.1 }, page),
    };
    // Full-width glyphs need one em each. Previously a 120pt box had only
    // 116pt for 117pt of text, moving the final glyph to a clipped second line.
    expect(result.width - 4).toBeGreaterThanOrEqual(18 * result.fontSize);
    expect(result.height - 6).toBeCloseTo(result.fontSize * 1.4, 10);
    expect(result.fontSize).toBeGreaterThanOrEqual(6);
    expect((result.width - 4) / (text.width - 4)).toBeCloseTo(
      result.fontSize / text.fontSize,
      10,
    );
  });

  it.each<ResizeCorner>(["nw", "ne", "sw", "se"])(
    "anchors text's opposite %s corner and does not jump at zero delta",
    (corner) => {
      const text = {
        ...annotation,
        type: "text" as const,
        fontSize: 13,
        width: 240,
        height: 24.2,
      };
      const zero = {
        ...text,
        ...resizeAnnotation(text, corner, { x: 0, y: 0 }, page),
      };
      expect(zero).toEqual(text);
      const delta = {
        x: corner.includes("w") ? 118 : -118,
        y: corner.includes("n") ? 9.1 : -9.1,
      };
      const result = {
        ...text,
        ...resizeAnnotation(text, corner, delta, page),
      };
      expect(result.width).toBe(122);
      expect(result.height).toBe(15.1);
      expect(result.fontSize).toBe(6.5);
      expect(corner.includes("w") ? result.x + result.width : result.x).toBe(
        corner.includes("w") ? text.x + text.width : text.x,
      );
      expect(corner.includes("n") ? result.y + result.height : result.y).toBe(
        corner.includes("n") ? text.y + text.height : text.y,
      );
    },
  );

  it.each<ResizeCorner>(["nw", "ne", "sw", "se"])(
    "constrains text growth at the page edge from %s",
    (corner) => {
      const text = {
        ...annotation,
        type: "text" as const,
        fontSize: 13,
        x: 15,
        y: 20,
        width: 240,
        height: 42.4,
      };
      const delta = {
        x: corner.includes("w") ? -10000 : 10000,
        y: corner.includes("n") ? -10000 : 10000,
      };
      const result = {
        ...text,
        ...resizeAnnotation(text, corner, delta, page),
      };
      expect(result.x).toBeGreaterThanOrEqual(0);
      expect(result.y).toBeGreaterThanOrEqual(0);
      expect(result.x + result.width).toBeLessThanOrEqual(page.width);
      expect(result.y + result.height).toBeLessThanOrEqual(page.height);
      expect((result.width - 4) / (text.width - 4)).toBeCloseTo(
        result.fontSize / text.fontSize,
        10,
      );
      expect((result.height - 6) / (text.height - 6)).toBeCloseTo(
        result.fontSize / text.fontSize,
        10,
      );
      expect(result.fontSize).toBeLessThanOrEqual(96);
    },
  );

  it("can enlarge older text boxes whose size is no bigger than their padding", () => {
    const text = {
      ...annotation,
      type: "text" as const,
      width: 4,
      height: 6,
      fontSize: 6,
    };
    const result = {
      ...text,
      ...resizeAnnotation(text, "se", { x: 5, y: 5 }, page),
    };
    expect(result.width).toBe(8);
    expect(result.height).toBe(12);
    expect(result.fontSize).toBe(12);
  });
});
