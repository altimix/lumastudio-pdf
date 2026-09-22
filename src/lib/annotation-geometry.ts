import type { Annotation, PageInfo } from "./types";

export type ResizeCorner = "nw" | "ne" | "sw" | "se";
export type Point = { x: number; y: number };

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

/** Keep the opposite corner fixed while resizing the complete annotation. */
export function resizeAnnotation(
  annotation: Annotation,
  corner: ResizeCorner,
  delta: Point,
  page: Pick<PageInfo, "width" | "height">,
): Partial<Annotation> {
  const west = corner.includes("w");
  const north = corner.includes("n");
  const anchorX = west ? annotation.x + annotation.width : annotation.x;
  const anchorY = north ? annotation.y + annotation.height : annotation.y;
  const requestedWidth = annotation.width + (west ? -delta.x : delta.x);
  const requestedHeight = annotation.height + (north ? -delta.y : delta.y);
  // Project onto the original diagonal so either axis can control a corner.
  const requestedFactor =
    (requestedWidth * annotation.width + requestedHeight * annotation.height) /
    (annotation.width ** 2 + annotation.height ** 2);
  const roomX = west ? anchorX : page.width - anchorX;
  const roomY = north ? anchorY : page.height - anchorY;
  const fontSize = annotation.fontSize || 16;
  const minimum = Math.max(
    8 / annotation.width,
    8 / annotation.height,
    annotation.type === "text" ? 6 / fontSize : 0,
  );
  const maximum = Math.min(
    roomX / annotation.width,
    roomY / annotation.height,
    annotation.type === "text" ? 96 / fontSize : Infinity,
  );
  const factor = Math.min(
    maximum,
    Math.max(Math.min(minimum, maximum), requestedFactor),
  );
  const width = annotation.width * factor;
  const height = annotation.height * factor;
  return {
    x: west ? anchorX - width : anchorX,
    y: north ? anchorY - height : anchorY,
    width,
    height,
    ...(annotation.type === "text" ? { fontSize: fontSize * factor } : {}),
  };
}
