export type CrewMember = { seat: number; target: string; since: number };

export type CrewRules = { seats: number; dwellMs: number };

function freeSeat(crew: readonly CrewMember[]): number {
  const taken = new Set(crew.map((m) => m.seat));
  let seat = 0;
  while (taken.has(seat)) seat += 1;
  return seat;
}

export function staffCrew(
  crew: readonly CrewMember[],
  targets: readonly string[],
  now: number,
  rules: CrewRules,
): CrewMember[] {
  const open = [...new Set(targets)];
  const attended = new Set<string>();
  const staying: CrewMember[] = [];
  const displaced: CrewMember[] = [];
  for (const member of crew) {
    if (open.includes(member.target) && !attended.has(member.target)) {
      attended.add(member.target);
      staying.push(member);
    } else {
      displaced.push(member);
    }
  }
  const waiting = open.filter((target) => !attended.has(target));
  const next: CrewMember[] = [];
  for (const member of staying) {
    const restless = now - member.since >= rules.dwellMs;
    const elsewhere = restless ? waiting.shift() : undefined;
    if (elsewhere === undefined) {
      next.push(member);
    } else {
      waiting.push(member.target);
      next.push({ seat: member.seat, target: elsewhere, since: now });
    }
  }
  for (const member of displaced) {
    const target = waiting.shift();
    if (target !== undefined) next.push({ seat: member.seat, target, since: now });
  }
  while (next.length < rules.seats) {
    const target = waiting.shift();
    if (target === undefined) break;
    next.push({ seat: freeSeat(next), target, since: now });
  }
  return next.sort((a, b) => a.seat - b.seat);
}
