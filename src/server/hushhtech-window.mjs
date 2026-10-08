/** A rolling provider response cannot be presented as a different historical range. */
export function hushhTechWindowMatches(summary, range) {
  return summary?.window?.startDate === range.startDate
    && summary?.window?.endDate === range.endDate;
}
