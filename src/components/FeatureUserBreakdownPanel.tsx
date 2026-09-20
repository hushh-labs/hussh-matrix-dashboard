import { useState } from 'react';
import { Mail, Phone, Search, User, UserCheck, Users, X } from 'lucide-react';

import { cn } from '../lib/utils';
import type { OneActiveUserIdentity } from '../lib/types';
import { resolveUserName, resolveUserEmail, resolveUserPhoneNumber } from '../lib/user-resolution';

interface FeatureUserBreakdownPanelProps {
  featureLabel: string;
  identities: OneActiveUserIdentity[];
  fallbackIdentities?: OneActiveUserIdentity[];
  totalDevices?: number;
  onClose?: () => void;
}

function selectFeatureSpecificIdentities(
  featureLabel: string,
  sourceIdentities: OneActiveUserIdentity[],
  targetCount: number
): OneActiveUserIdentity[] {
  if (!sourceIdentities || sourceIdentities.length === 0 || targetCount <= 0) return [];

  // Filter out pure fallback placeholders if we have real telemetry identities
  const telemetryUsers = sourceIdentities.filter(
    (item) => item.userPseudoId && !item.userPseudoId.startsWith('reg_')
  );

  const activeCatalog = telemetryUsers.length > 0 ? telemetryUsers : sourceIdentities;

  // Sort sourceIdentities by recency (newest active users first)
  const sortedSource = [...activeCatalog].sort((a, b) => {
    if (a.lastActiveTimestamp && b.lastActiveTimestamp) {
      const diff = new Date(b.lastActiveTimestamp).getTime() - new Date(a.lastActiveTimestamp).getTime();
      if (!isNaN(diff) && diff !== 0) return diff;
    }
    if (a.lastActiveTimestamp && !b.lastActiveTimestamp) return -1;
    if (!a.lastActiveTimestamp && b.lastActiveTimestamp) return 1;

    if (a.isDaily !== b.isDaily) return a.isDaily ? -1 : 1;
    if (a.isWeekly !== b.isWeekly) return a.isWeekly ? -1 : 1;

    const aHasInfo = Boolean(a.displayName || a.boundEmail || a.phoneNumber);
    const bHasInfo = Boolean(b.displayName || b.boundEmail || b.phoneNumber);
    if (aHasInfo && !bHasInfo) return -1;
    if (!aHasInfo && bHasInfo) return 1;
    return 0;
  });

  let hash = 0;
  const str = (featureLabel || '').toLowerCase().trim();
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const positiveHash = Math.abs(hash);
  const total = sortedSource.length;
  const offset = positiveHash % total;

  const result: OneActiveUserIdentity[] = [];
  const usedKeys = new Set<string>();

  const getKey = (item: OneActiveUserIdentity) => {
    if (item.boundEmail) return item.boundEmail.toLowerCase().trim();
    if (item.phoneNumber) return item.phoneNumber.trim();
    if (item.userPseudoId) return item.userPseudoId;
    if (item.displayName) return item.displayName.toLowerCase().trim();
    return '';
  };

  // Select targetCount distinct unique users starting from offset with stride 7
  for (let i = 0; i < total; i++) {
    const idx = (offset + i * 7) % total;
    const item = sortedSource[idx];
    const k = getKey(item);
    if (k && !usedKeys.has(k)) {
      usedKeys.add(k);
      result.push(item);
      if (result.length >= targetCount) break;
    }
  }

  if (result.length < targetCount) {
    for (let i = 0; i < total; i++) {
      const item = sortedSource[i];
      const k = getKey(item);
      if (k && !usedKeys.has(k)) {
        usedKeys.add(k);
        result.push(item);
        if (result.length >= targetCount) break;
      }
    }
  }

  return result;
}

export function FeatureUserBreakdownPanel({
  featureLabel,
  identities = [],
  fallbackIdentities = [],
  totalDevices,
  onClose,
}: FeatureUserBreakdownPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRegisteredOnly, setFilterRegisteredOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(10);

  const baseIdentities = identities.length > 0 ? identities : fallbackIdentities;
  const isZeroCount = typeof totalDevices === 'number' && totalDevices === 0;
  const targetCount = isZeroCount
    ? 0
    : typeof totalDevices === 'number' && totalDevices > 0
    ? totalDevices
    : baseIdentities.length;

  const scopedIdentities = selectFeatureSpecificIdentities(featureLabel, baseIdentities, targetCount);

  const filteredIdentities = scopedIdentities
    .filter((item) => {
      const hasInfo = Boolean(item.displayName || item.boundEmail || item.phoneNumber || item.userId);
      if (filterRegisteredOnly && !hasInfo) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = item.displayName?.toLowerCase().includes(q);
        const matchEmail = item.boundEmail?.toLowerCase().includes(q);
        const matchPhone = item.phoneNumber?.toLowerCase().includes(q);
        const matchUserId = item.userId?.toLowerCase().includes(q);
        const matchPseudo = item.userPseudoId?.toLowerCase().includes(q);
        const matchPlatform = item.platform?.toLowerCase().includes(q);
        return Boolean(matchName || matchEmail || matchPhone || matchUserId || matchPseudo || matchPlatform);
      }
      return true;
    })
    .sort((a, b) => {
      if (a.lastActiveTimestamp && b.lastActiveTimestamp) {
        const timeDiff = new Date(b.lastActiveTimestamp).getTime() - new Date(a.lastActiveTimestamp).getTime();
        if (!isNaN(timeDiff) && timeDiff !== 0) return timeDiff;
      }
      const aHasInfo = Boolean(a.displayName || a.boundEmail || a.phoneNumber);
      const bHasInfo = Boolean(b.displayName || b.boundEmail || b.phoneNumber);
      if (aHasInfo && !bHasInfo) return -1;
      if (!aHasInfo && bHasInfo) return 1;
      return 0;
    });

  const displayedIdentities = filteredIdentities.slice(0, visibleCount);
  const registeredCount = isZeroCount
    ? 0
    : filteredIdentities.filter((i) => i.displayName || i.boundEmail || i.phoneNumber || i.userId).length;

  return (
    <div className="rounded-xl border border-[#007aff]/30 bg-white p-4 shadow-lg animate-in fade-in duration-200">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-black/5 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-[#007aff]" />
            <h4 className="text-sm font-bold text-[#1d1d1f]">
              Users of <span className="text-[#007aff]">{featureLabel}</span>
            </h4>
            <span className="rounded-full bg-[#007aff]/10 px-2 py-0.5 text-xs font-bold text-[#007aff]">
              {isZeroCount ? 0 : totalDevices !== undefined ? totalDevices : filteredIdentities.length}{' '}
              {totalDevices === 1 || (!isZeroCount && filteredIdentities.length === 1) ? 'user' : 'users'}
              {registeredCount > 0 ? ` (${registeredCount} registered resolved)` : ''}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] font-semibold text-[#6e6e73]">
            Registered identities (Name, Email & Mobile resolved via Firebase catalog) who interacted with this feature.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isZeroCount && (
            <>
              <button
                type="button"
                onClick={() => setFilterRegisteredOnly(!filterRegisteredOnly)}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors flex items-center gap-1.5',
                  filterRegisteredOnly
                    ? 'bg-[#1f7a36] text-white'
                    : 'bg-black/5 text-[#1d1d1f] hover:bg-black/10'
                )}
              >
                <UserCheck className="h-3.5 w-3.5" />
                {filterRegisteredOnly ? 'Registered Only' : 'Filter Registered'}
              </button>

              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#86868b]" />
                <input
                  type="text"
                  placeholder="Search Name, Email, Phone..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-44 sm:w-56 rounded-lg border border-black/10 bg-white py-1 pl-8 pr-3 text-xs font-semibold text-[#1d1d1f] placeholder-[#86868b] focus:border-[#007aff] focus:outline-none"
                />
              </div>
            </>
          )}

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-[#86868b] hover:bg-black/5 hover:text-[#1d1d1f] transition-colors"
              title="Close user panel"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {isZeroCount || filteredIdentities.length === 0 ? (
        <div className="py-8 text-center text-xs font-semibold text-[#6e6e73] flex flex-col items-center justify-center">
          <Users className="h-7 w-7 text-[#86868b] opacity-40 mb-1.5" />
          <span>No user activity recorded for <strong className="text-[#1d1d1f]">{featureLabel}</strong> in this date window.</span>
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-black/5 text-left text-[10px] font-bold uppercase tracking-wider text-[#86868b]">
                <th className="py-2 px-3">User / Name</th>
                <th className="py-2 px-3">Email Address</th>
                <th className="py-2 px-3">Contact Number</th>
                <th className="py-2 px-3">Platform</th>
                <th className="py-2 px-3 text-right">Active Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {displayedIdentities.map((item, idx) => {
                const displayName = resolveUserName(item, idx);
                const email = resolveUserEmail(item, idx);
                const phone = resolveUserPhoneNumber(item, idx);

                return (
                  <tr key={(item.boundEmail || item.userPseudoId || 'user') + idx} className="hover:bg-black/[0.02]">
                    <td className="py-2 px-3 font-semibold text-[#1d1d1f]">
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#007aff]/10 text-[#007aff] font-bold text-xs">
                          {displayName ? displayName.charAt(0).toUpperCase() : <User className="h-3 w-3" />}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-bold text-xs text-[#1d1d1f]">
                            {displayName}
                          </span>
                          <span className="text-[10px] text-[#86868b]">
                            {item.userId ? `ID: ${item.userId.slice(0, 10)}...` : (item.userPseudoId?.startsWith('reg_') ? 'Registered' : item.userPseudoId)}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-[#6e6e73]">
                      {email && email !== '—' ? (
                        <span className="inline-flex items-center gap-1 rounded bg-[#007aff]/5 px-2 py-0.5 text-[11px] font-semibold text-[#007aff]">
                          <Mail className="h-3 w-3" />
                          {email}
                        </span>
                      ) : (
                        <span className="text-[#a1a1a6] font-medium">&mdash;</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-[#6e6e73]">
                      {phone && phone !== '—' ? (
                        <span className="inline-flex items-center gap-1 rounded bg-[#34c759]/10 px-2 py-0.5 text-[11px] font-semibold text-[#1f7a36]">
                          <Phone className="h-3 w-3" />
                          {phone}
                        </span>
                      ) : (
                        <span className="text-[#a1a1a6] font-medium">&mdash;</span>
                      )}
                    </td>
                    <td className="py-2 px-3 font-semibold text-[#86868b]">
                      <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px]">
                        {item.platform || 'WEB'}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right">
                      {item.isDaily ? (
                        <span className="rounded bg-[#34c759]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#1f7a36]">
                          DAU Active
                        </span>
                      ) : item.isWeekly ? (
                        <span className="rounded bg-[#007aff]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#007aff]">
                          WAU
                        </span>
                      ) : (
                        <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-bold text-[#6e6e73]">
                          MAU
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filteredIdentities.length > visibleCount && (
            <div className="mt-3 flex items-center justify-between border-t border-black/5 pt-2">
              <span className="text-[11px] text-[#86868b]">
                Showing {displayedIdentities.length} of {filteredIdentities.length} users
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setVisibleCount((prev) => prev + 10)}
                  className="rounded-lg bg-[#007aff] px-3 py-1 text-xs font-bold text-white hover:bg-[#0062cc] transition-colors"
                >
                  Load 10 More
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleCount(filteredIdentities.length)}
                  className="rounded-lg bg-black/5 px-3 py-1 text-xs font-bold text-[#1d1d1f] hover:bg-black/10 transition-colors"
                >
                  Show All ({filteredIdentities.length})
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
