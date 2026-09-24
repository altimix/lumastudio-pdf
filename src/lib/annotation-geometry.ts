import type { Annotation, PageInfo } from "./types";

export type ResizeCorner = "nw" | "ne" | "sw" | "se";
export type ResizeHandle = ResizeCorner | "n" | "e" | "s" | "w";
export type Point = { x: number; y: number };

export function isAspectLocked(annotation: Pick<Annotation, 'type' | 'aspectLocked'>): boolean {
  return annotation.aspectLocked ?? annotation.type !== 'shape';
}

/** Convert the rotated page's bounding box back into original PDF points. */
export function pointOnPage(
  client: Point,
  rect: { left: number; top: number },
  scale: number,
  page: Pick<PageInfo, "width" | "height" | "rotation">,
): Point {
  const x = (client.x - rect.left) / scale;
  const y = (client.y - rect.top) / scale;
  const rotation = ((page.rotation % 360) + 360) % 360;
  if (rotation === 90) return { x: y, y: page.height - x };
  if (rotation === 180) return { x: page.width - x, y: page.height - y };
  if (rotation === 270) return { x: page.width - y, y: x };
  return { x, y };
}

/** Keep the opposite corner or edge fixed while resizing the annotation. */
export function resizeAnnotation(
  annotation: Annotation,
  corner: ResizeHandle,
  delta: Point,
  page: Pick<PageInfo, "width" | "height">,
): Partial<Annotation> {
  const west = corner.includes("w");
  const north = corner.includes("n");
  const anchorX = west ? annotation.x + annotation.width : annotation.x;
  const anchorY = north ? annotation.y + annotation.height : annotation.y;
  if (!isAspectLocked(annotation)) {
    // Unlocked materials stretch independently. Edge handles leave the other
    // axis untouched, and none of the handles may flip or leave the page.
    const horizontal = west || corner.includes("e");
    const vertical = north || corner.includes("s");
    const roomX = west ? anchorX : page.width - anchorX;
    const roomY = north ? anchorY : page.height - anchorY;
    const width = horizontal
      ? Math.min(
          roomX,
          Math.max(
            Math.min(8, roomX),
            annotation.width + (west ? -delta.x : delta.x),
          ),
        )
      : annotation.width;
    const height = vertical
      ? Math.min(
          roomY,
          Math.max(
            Math.min(8, roomY),
            annotation.height + (north ? -delta.y : delta.y),
          ),
        )
      : annotation.height;
    return {
      x: west ? anchorX - width : annotation.x,
      y: north ? anchorY - height : annotation.y,
      width,
      height,
    };
  }
  // Text rendering keeps 2pt at each side and 6pt of total vertical padding.
  // Scale its content area with the font, otherwise shrinking adds wrapped
  // lines while making the box too short to show those lines.
  // Older work files can contain boxes smaller than their padding. Retain a
  // positive diagonal for those boxes so enlarging them cannot produce NaN.
  const paddingWidth =
    annotation.type === "text" && annotation.width > 4 ? 4 : 0;
  const paddingHeight =
    annotation.type === "text" && annotation.height > 6 ? 6 : 0;
  const contentWidth = annotation.width - paddingWidth;
  const contentHeight = annotation.height - paddingHeight;
  const requestedWidth = contentWidth + (west ? -delta.x : delta.x);
  const requestedHeight = contentHeight + (north ? -delta.y : delta.y);
  // Project onto the content diagonal so either axis can control a corner.
  const requestedFactor =
    (requestedWidth * contentWidth + requestedHeight * contentHeight) /
    (contentWidth ** 2 + contentHeight ** 2);
  const roomX = west ? anchorX : page.width - anchorX;
  const roomY = north ? anchorY : page.height - anchorY;
  const fontSize = annotation.fontSize || 16;
  const minimum = Math.max(
    (8 - paddingWidth) / contentWidth,
    (8 - paddingHeight) / contentHeight,
    annotation.type === "text" ? 6 / fontSize : 0,
  );
  const maximum = Math.min(
    (roomX - paddingWidth) / contentWidth,
    (roomY - paddingHeight) / contentHeight,
    annotation.type === "text" ? 96 / fontSize : Infinity,
  );
  const factor = Math.min(
    maximum,
    Math.max(Math.min(minimum, maximum), requestedFactor),
  );
  const width = paddingWidth + contentWidth * factor;
  const height = paddingHeight + contentHeight * factor;
  return {
    x: west ? anchorX - width : anchorX,
    y: north ? anchorY - height : anchorY,
    width,
    height,
    ...(annotation.type === "text" ? { fontSize: fontSize * factor } : {}),
  };
}
