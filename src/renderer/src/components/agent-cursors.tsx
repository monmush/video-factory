import { type CrewMember, staffCrew } from "@shared/agent-crew";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { runningWork, useWowMode } from "@/lib/wow-mode";

const MOST_AGENTS = 10;
const RULES = { seats: MOST_AGENTS, dwellMs: 5000 };
const TICK_MS = 250;
const SHORTEST_PAUSE_MS = 1400;
const LONGEST_PAUSE_MS = 2800;
const DRIFT = 28;
const EDGE_MARGIN = 10;
const LABEL_ROOM = 150;

type Point = { x: number; y: number };
type Cursor = Point & { seat: number; target: string; doing: string };

const between = (low: number, high: number) => low + Math.random() * Math.max(0, high - low);
const within = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(low, high));
const holds = (rect: DOMRect, point: Point) =>
  point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;

function pointIn(rects: readonly DOMRect[], near: Point | undefined): Point {
  const home = near && rects.find((rect) => holds(rect, near));
  const rect = home ?? rects[Math.floor(Math.random() * rects.length)] ?? new DOMRect();
  const insetX = Math.min(EDGE_MARGIN, rect.width / 2);
  const insetY = Math.min(EDGE_MARGIN, rect.height / 2);
  const left = rect.left + insetX;
  const right = rect.right - insetX;
  const top = rect.top + insetY;
  const bottom = rect.bottom - insetY;
  const x =
    home && near ? within(near.x + between(-DRIFT, DRIFT), left, right) : between(left, right);
  const y =
    home && near ? within(near.y + between(-DRIFT, DRIFT), top, bottom) : between(top, bottom);
  return {
    x: within(x, EDGE_MARGIN, window.innerWidth - LABEL_ROOM),
    y: within(y, EDGE_MARGIN, window.innerHeight - EDGE_MARGIN * 3),
  };
}

function useCursors(): Cursor[] {
  const [cursors, setCursors] = useState<Cursor[]>([]);

  useEffect(() => {
    let crew: CrewMember[] = [];
    let shown: Cursor[] = [];
    const nextMoveAt = new Map<number, number>();

    const tick = () => {
      const now = performance.now();
      const work = runningWork();
      crew = staffCrew(crew, [...work.keys()], now, RULES);
      let moved = crew.length !== shown.length;
      const next = crew.map((member) => {
        const before = shown.find((c) => c.seat === member.seat);
        const settled = before?.target === member.target ? before : undefined;
        const running = work.get(member.target);
        const doing = running?.doing ?? "";
        const due = now >= (nextMoveAt.get(member.seat) ?? 0);
        if (settled && !due && settled.doing === doing) return settled;
        moved = true;
        if (settled && !due) return { ...settled, doing };
        nextMoveAt.set(member.seat, now + between(SHORTEST_PAUSE_MS, LONGEST_PAUSE_MS));
        return {
          seat: member.seat,
          target: member.target,
          doing,
          ...pointIn(running?.rects ?? [], settled),
        };
      });
      if (!moved) return;
      shown = next;
      setCursors(next);
    };

    tick();
    const timer = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  return cursors;
}

function Crew() {
  const cursors = useCursors();
  if (cursors.length === 0) return null;
  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[1000] overflow-hidden">
      {cursors.map((cursor) => {
        const color = `var(--agent-${(cursor.seat % MOST_AGENTS) + 1})`;
        const place = { transform: `translate3d(${cursor.x}px, ${cursor.y}px, 0)` };
        return (
          <div key={cursor.seat} style={{ color }}>
            <span className="agent-tail" style={place} />
            <span className="agent-cursor" style={place}>
              <span
                className="agent-cursor-body"
                style={{ animationDelay: `${cursor.seat * -230}ms` }}
              >
                <svg width="18" height="20" viewBox="0 0 18 20" role="presentation">
                  <path
                    d="M2 1.5 15.5 9.2 9.3 10.9 6.1 17.2Z"
                    fill="currentColor"
                    stroke="var(--agent-foreground)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="agent-name">
                  Agent {cursor.seat + 1}
                  {cursor.doing && <span className="agent-doing">{cursor.doing}</span>}
                </span>
              </span>
            </span>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

export function AgentCursors() {
  return useWowMode() ? <Crew /> : null;
}
