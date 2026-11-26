export function isLow(balanceBase, reorderLevelBase) {
  return Number.isInteger(balanceBase)
    && Number.isInteger(reorderLevelBase)
    && balanceBase <= reorderLevelBase;
}

function optionalCount(value, label) {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

export function summarizeAlerts({ flaggedRuns, lowItems, shortPackets }) {
  const flagged = optionalCount(flaggedRuns, 'flaggedRuns');
  const low = optionalCount(lowItems, 'lowItems');
  const short = optionalCount(shortPackets, 'shortPackets');
  return {
    total: (flagged ?? 0) + (low ?? 0) + (short > 0 ? 1 : 0),
    flaggedRuns: flagged,
    lowItems: low,
    shortPackets: short
  };
}
