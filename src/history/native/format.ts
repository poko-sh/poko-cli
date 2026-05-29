export const formatNativeDetails = (
  details: Record<string, number | string | boolean> | undefined,
): string =>
  Object.entries(details ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
