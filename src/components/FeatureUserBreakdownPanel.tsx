import { useState, useMemo } from 'react';
import { Mail, Phone, Search, User, Users, X, Zap, LogIn } from 'lucide-react';

import { cn } from '../lib/utils';
import type { OneActiveUserIdentity } from '../lib/types';
import { resolveUserName, resolveUserEmail, resolveUserPhoneNumber } from '../lib/user-resolution';

interface FeatureUserBreakdownPanelProps {
  featureLabel: string;
  featureKey?: string;
  featureIdentities?: OneActiveUserIdentity[];
  identities?: OneActiveUserIdentity[];
  fallbackIdentities?: OneActiveUserIdentity[];
  totalDevices?: number;
  onClose?: () => void;
}

export function FeatureUserBreakdownPanel({
  featureLabel,
  featureKey,
  featureIdentities,
  identities = [],
  fallbackIdentities = [],
  totalDevices,
  onClose,
}: FeatureUserBreakdownPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(10);

  const isSignInFeature =
    featureKey === 'auth_started' ||
    featureKey === 'daily_signin' ||
    featureLabel.toLowerCase().includes('sign-in') ||
    featureLabel.toLowerCase().includes('login');

  // If featureIdentities has specific user items, use it to show feature-specific usage.
  const hasSpecificIdentities = Array.isArray(featureIdentities) && featureIdentities.length > 0;
  const rawIdentities = hasSpecificIdentities
    ? featureIdentities
    : identities.length > 0
    ? identities
    : fallbackIdentities;

  // Deduplicate by resolved identity (UID, email, phone, or device ID)
  const baseIdentities = useMemo(() => {
    const map = new Map<string, OneActiveUserIdentity>();
    for (const item of rawIdentities) {
      const email = resolveUserEmail(item);
      const phone = resolveUserPhoneNumber(item);
      const name = resolveUserName(item);
      const key =
        (item.userId ? `uid:${item.userId.toLowerCase()}` : null) ||
        (email !== 'Not available' ? `email:${email.toLowerCase().trim()}` : null) ||
        (phone !== 'Not available' ? `phone:${phone.replace(/\D/g, '')}` : null) ||
        `device:${item.userPseudoId || name}`;

      if (map.has(key)) {
        const existing = map.get(key)!;
        existing.usageCount = (existing.usageCount ?? 1) + (item.usageCount ?? 1);
        const timeExisting = existing.lastActiveTimestamp ? new Date(existing.lastActiveTimestamp).getTime() : 0;
        const timeItem = item.lastActiveTimestamp ? new Date(item.lastActiveTimestamp).getTime() : 0;
        if (timeItem > timeExisting) {
          existing.lastActiveTimestamp = item.lastActiveTimestamp;
        }
      } else {
        map.set(key, { ...item });
      }
    }
    return Array.from(map.values());
  }, [rawIdentities]);

  const isZeroCount =
    (typeof totalDevices === 'number' && totalDevices === 0) ||
    baseIdentities.length === 0;

  const scopedIdentities = isZeroCount ? [] : baseIdentities;

  const filteredIdentities = scopedIdentities
    .filter((item) => {
      const email = resolveUserEmail(item);
      const phone = resolveUserPhoneNumber(item);
      const name = resolveUserName(item);
      const hasRegisteredInfo = Boolean(
        item.displayName ||
        item.boundEmail ||
        item.phoneNumber ||
        item.userId ||
        email !== 'Not available' ||
        phone !== 'Not available' ||
        (name && !name.startsWith('Guest Session') && name !== 'Not available')
      );
      if (!hasRegisteredInfo) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = name.toLowerCase().includes(q);
        const matchEmail = email.toLowerCase().includes(q);
        const matchPhone = phone.toLowerCase().includes(q);
        const matchUserId = item.userId?.toLowerCase().includes(q);
        const matchPseudo = item.userPseudoId?.toLowerCase().includes(q);
        const matchPlatform = item.platform?.toLowerCase().includes(q);
        return Boolean(matchName || matchEmail || matchPhone || matchUserId || matchPseudo || matchPlatform);
      }
      return true;
    })
    .sort((a, b) => {
      // Rule 1: Sort strictly descending by Last Active timestamp (most recent first)
      const timeA = a.lastActiveTimestamp ? new Date(a.lastActiveTimestamp).getTime() : 0;
      const timeB = b.lastActiveTimestamp ? new Date(b.lastActiveTimestamp).getTime() : 0;
      if (!isNaN(timeA) && !isNaN(timeB) && timeA !== timeB) {
        return timeB - timeA;
      }
      return (b.usageCount ?? 1) - (a.usageCount ?? 1);
    });

  const displayedIdentities = filteredIdentities.slice(0, visibleCount);

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
              {filteredIdentities.length} {filteredIdentities.length === 1 ? 'registered user' : 'registered users'}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] font-semibold text-[#6e6e73]">
            {isSignInFeature
              ? 'Distinct registered users who completed sign-in or authentication events in this window.'
              : `Distinct registered users who explicitly triggered event logs for ${featureLabel}.`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isZeroCount && filteredIdentities.length > 0 && (
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
                <th className="py-2 px-3">User / Identity</th>
                <th className="py-2 px-3">Email Address</th>
                <th className="py-2 px-3">Contact Number</th>
                <th className="py-2 px-3 text-center">{isSignInFeature ? 'Sign-ins' : 'Times Used'}</th>
                <th className="py-2 px-3">Platform</th>
                <th className="py-2 px-3">Session Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {displayedIdentities.map((item, idx) => {
                const displayName = resolveUserName(item, idx);
                const email = resolveUserEmail(item, idx);
                const phone = resolveUserPhoneNumber(item, idx);
                const timesUsed = item.usageCount ?? 1;
                const isRegistered = Boolean(item.displayName || item.boundEmail || item.phoneNumber || item.userId);

                return (
                  <tr key={(item.boundEmail || item.userPseudoId || 'user') + idx} className="hover:bg-black/[0.02]">
                    <td className="py-2 px-3 font-semibold text-[#1d1d1f]">
                      <div className="flex items-center gap-2">
                        <div
                          className={cn(
                            'flex h-6 w-6 items-center justify-center rounded-full font-bold text-xs',
                            isRegistered ? 'bg-[#007aff]/10 text-[#007aff]' : 'bg-black/5 text-[#86868b]'
                          )}
                        >
                          {isRegistered ? displayName.charAt(0).toUpperCase() : <User className="h-3 w-3" />}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-bold text-xs text-[#1d1d1f]">
                            {displayName}
                          </span>
                          <span className="text-[10px] text-[#86868b]">
                            {item.userId
                              ? `UID: ${item.userId.slice(0, 10)}...`
                              : item.userPseudoId?.startsWith('reg_')
                              ? 'Registered Catalog'
                              : `Device: ${item.userPseudoId}`}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-[#6e6e73]">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold',
                          email !== 'Not available'
                            ? 'bg-[#007aff]/5 text-[#007aff]'
                            : 'bg-black/5 text-[#86868b]'
                        )}
                      >
                        <Mail className="h-3 w-3" />
                        {email}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-[#6e6e73]">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold',
                          phone !== 'Not available'
                            ? 'bg-[#34c759]/10 text-[#1f7a36]'
                            : 'bg-black/5 text-[#86868b]'
                        )}
                      >
                        <Phone className="h-3 w-3" />
                        {phone}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-center font-semibold text-[#1d1d1f]">
                      <span className="inline-flex items-center gap-1 rounded bg-[#007aff]/10 px-2 py-0.5 text-[11px] font-bold text-[#007aff]">
                        {isSignInFeature ? <LogIn className="h-3 w-3" /> : <Zap className="h-3 w-3" />}
                        {timesUsed} {isSignInFeature ? (timesUsed === 1 ? 'sign-in' : 'sign-ins') : (timesUsed === 1 ? 'time' : 'times')}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-semibold text-[#86868b]">
                      <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px]">
                        {item.platform || 'WEB'}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      {isRegistered ? (
                        <span className="rounded bg-[#34c759]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#1f7a36]">
                          Registered User
                        </span>
                      ) : (
                        <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-bold text-[#6e6e73]">
                          Guest Session
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
