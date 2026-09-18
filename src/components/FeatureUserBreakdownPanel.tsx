import { useState } from 'react';
import { Mail, Phone, Search, User, UserCheck, Users, X } from 'lucide-react';

import { cn } from '../lib/utils';
import type { OneActiveUserIdentity } from '../lib/types';

interface FeatureUserBreakdownPanelProps {
  featureLabel: string;
  identities: OneActiveUserIdentity[];
  totalDevices?: number;
  onClose?: () => void;
}

export function FeatureUserBreakdownPanel({
  featureLabel,
  identities = [],
  totalDevices,
  onClose,
}: FeatureUserBreakdownPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRegisteredOnly, setFilterRegisteredOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(10);

  const filteredIdentities = identities.filter((item) => {
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
  }).sort((a, b) => {
    const aHasInfo = Boolean(a.displayName || a.boundEmail || a.phoneNumber);
    const bHasInfo = Boolean(b.displayName || b.boundEmail || b.phoneNumber);
    if (aHasInfo && !bHasInfo) return -1;
    if (!aHasInfo && bHasInfo) return 1;
    return 0;
  });

  const displayedIdentities = filteredIdentities.slice(0, visibleCount);
  const registeredCount = filteredIdentities.filter(
    (i) => i.displayName || i.boundEmail || i.phoneNumber || i.userId
  ).length;

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
              {totalDevices !== undefined ? totalDevices : filteredIdentities.length}{' '}
              {totalDevices === 1 || filteredIdentities.length === 1 ? 'user' : 'users'}
              {registeredCount > 0 ? ` (${registeredCount} registered resolved)` : ''}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] font-semibold text-[#6e6e73]">
            Registered identities (Name, Email & Mobile resolved via Firebase catalog) who interacted with this feature.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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

      {filteredIdentities.length === 0 ? (
        <div className="py-6 text-center text-xs font-semibold text-[#6e6e73]">
          No matching user identities found for this feature filter.
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
                const displayName = item.displayName || null;
                const email = item.boundEmail || null;
                const phone = item.phoneNumber || null;

                return (
                  <tr key={item.userPseudoId + idx} className="hover:bg-black/[0.02]">
                    <td className="py-2 px-3 font-semibold text-[#1d1d1f]">
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#007aff]/10 text-[#007aff] font-bold text-xs">
                          {displayName ? displayName.charAt(0).toUpperCase() : <User className="h-3 w-3" />}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-bold text-xs text-[#1d1d1f]">
                            {displayName || (email ? email.split('@')[0] : 'Anonymous Device')}
                          </span>
                          {!displayName && !email && (
                            <span className="font-mono text-[9px] text-[#86868b]">
                              {item.userPseudoId.slice(0, 14)}...
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      {email ? (
                        <a
                          href={`mailto:${email}`}
                          className="inline-flex items-center gap-1 rounded bg-[#007aff]/10 px-2 py-0.5 text-[11px] font-semibold text-[#007aff] hover:underline"
                        >
                          <Mail className="h-3 w-3" />
                          {email}
                        </a>
                      ) : (
                        <span className="text-[#86868b]">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      {phone ? (
                        <a
                          href={`tel:${phone}`}
                          className="inline-flex items-center gap-1 rounded bg-[#34c759]/10 px-2 py-0.5 text-[11px] font-bold text-[#1f7a36] hover:underline"
                        >
                          <Phone className="h-3 w-3" />
                          {phone}
                        </a>
                      ) : (
                        <span className="text-[#86868b]">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-bold text-[#6e6e73]">
                        {item.platform || 'WEB'}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <span className="text-[10px] font-bold text-[#1f7a36] bg-[#34c759]/10 px-2 py-0.5 rounded-full">
                        {item.isDaily ? 'DAU' : item.isWeekly ? 'WAU' : 'MAU'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filteredIdentities.length > visibleCount && (
            <div className="mt-3 flex items-center justify-between border-t border-black/5 pt-2">
              <span className="text-[11px] font-semibold text-[#86868b]">
                Showing {visibleCount} of {filteredIdentities.length} users
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setVisibleCount((prev) => prev + 10)}
                  className="rounded-md bg-[#007aff] px-2.5 py-1 text-xs font-bold text-white hover:bg-[#0066cc] transition-colors"
                >
                  Load 10 More
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleCount(filteredIdentities.length)}
                  className="rounded-md bg-[#34c759]/15 px-2.5 py-1 text-xs font-bold text-[#1f7a36] hover:bg-[#34c759]/25 transition-colors"
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
