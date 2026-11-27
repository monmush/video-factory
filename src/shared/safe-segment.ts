export const isSafeSegment = (segment: unknown): segment is string =>
  typeof segment === "string" &&
  segment.length > 0 &&
  segment !== "." &&
  segment !== ".." &&
  !/[/\\\0]/.test(segment);
