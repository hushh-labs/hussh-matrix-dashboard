import type { OneCapabilityUsage } from './types';

/** Display-only comparisons of existing daily device aggregates. Never infer a missing day. */
export function shiftDay(day: string, offset: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

export function dailyAgentRow(capability: OneCapabilityUsage, day: string, available: boolean) {
  const read = (date: string) => {
    if (!available || !capability.instrumented) return null;
    const value = capability.daily?.find(point => point.eventDate === date)?.users;
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  };
  const current = read(day), previous = day ? read(shiftDay(day, -1)) : null;
  const difference = current !== null && previous !== null ? current - previous : null;
  const percent = difference !== null && previous !== null && previous > 0 ? difference / previous * 100 : null;
  return { key: capability.key, label: capability.label, current, previous, difference, percent };
}
