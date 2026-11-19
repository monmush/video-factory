export function withOccurrenceKeys<T>(
  items: readonly T[],
  identity: (item: T) => string,
): { item: T; key: string }[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const id = identity(item);
    const occurrence = seen.get(id) ?? 0;
    seen.set(id, occurrence + 1);
    return { item, key: `${id}#${occurrence}` };
  });
}
