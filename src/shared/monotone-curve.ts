export interface CurvePoint {
  x: number;
  y: number;
}

export interface CurveSegment {
  from: CurvePoint;
  to: CurvePoint;
  controls: [CurvePoint, CurvePoint] | null;
}

const MAX_TANGENT_RATIO = 3;

function slopes(points: readonly CurvePoint[]) {
  return points.slice(1).map((to, at) => {
    const from = points[at] as CurvePoint;
    const run = to.x - from.x;
    return run > 0 ? (to.y - from.y) / run : 0;
  });
}

function tangents(points: readonly CurvePoint[], secants: readonly number[]) {
  const last = points.length - 1;
  const m = points.map((_, at) => {
    if (at === 0) return secants[0] ?? 0;
    if (at === last) return secants[last - 1] ?? 0;
    const before = secants[at - 1] as number;
    const after = secants[at] as number;
    return before * after <= 0 ? 0 : (before + after) / 2;
  });
  secants.forEach((d, at) => {
    if (d === 0) {
      m[at] = 0;
      m[at + 1] = 0;
      return;
    }
    const a = (m[at] as number) / d;
    const b = (m[at + 1] as number) / d;
    const size = a * a + b * b;
    if (size > MAX_TANGENT_RATIO ** 2) {
      const t = MAX_TANGENT_RATIO / Math.sqrt(size);
      m[at] = t * a * d;
      m[at + 1] = t * b * d;
    }
  });
  return m;
}

export function monotoneSegments(points: readonly CurvePoint[]): CurveSegment[] {
  const secants = slopes(points);
  const m = tangents(points, secants);
  return points.slice(1).map((to, at) => {
    const from = points[at] as CurvePoint;
    const third = (to.x - from.x) / 3;
    if (third <= 0) return { from, to, controls: null };
    return {
      from,
      to,
      controls: [
        { x: from.x + third, y: from.y + (m[at] as number) * third },
        { x: to.x - third, y: to.y - (m[at + 1] as number) * third },
      ],
    };
  });
}

const pair = (p: CurvePoint) => `${p.x},${p.y}`;

export function monotonePath(points: readonly CurvePoint[]): string {
  const [first] = points;
  if (!first) return "";
  return [
    `M${pair(first)}`,
    ...monotoneSegments(points).map((s) =>
      s.controls
        ? `C${pair(s.controls[0])} ${pair(s.controls[1])} ${pair(s.to)}`
        : `L${pair(s.to)}`,
    ),
  ].join(" ");
}
