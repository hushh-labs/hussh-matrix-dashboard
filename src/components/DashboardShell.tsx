import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, LogOut, Menu, Moon, RefreshCw, Search, Sun, X } from 'lucide-react';
import type { AuthUser } from '../lib/auth-service';
import { dashboardNavigation, dashboardTabLabels, locationNavigation, type DashboardTab } from '../lib/dashboard-navigation';
import { cn } from '../lib/utils';
import { MatrixBrand } from './MatrixBrand';

/** The same focus/scroll contract for the mobile navigation and page search. */
function useModalFocus(open: boolean, root: { current: HTMLElement | null }, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusables = () => Array.from(root.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, [tabindex="0"]') ?? [])
      .filter(element => element.getClientRects().length > 0);
    focusables()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const items = focusables();
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', handleKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [open, root]);
}

export function DashboardShell({ activeTab, locationActive, onNavigate, onLocation, user, onSignOut, onRefresh, refreshing, status, children }: {
  activeTab: DashboardTab; locationActive: boolean;
  onNavigate: (tab: DashboardTab) => void; onLocation: () => void;
  user: AuthUser | null; onSignOut: () => void; onRefresh: () => void;
  refreshing: boolean; status: string; children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 1280px)').matches);
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('matrix-theme') === 'dark'; } catch { return false; }
  });
  const sidebarRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  useModalFocus(mobileOpen, sidebarRef, () => setMobileOpen(false));
  useModalFocus(searchOpen, searchRef, () => setSearchOpen(false));

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try { localStorage.setItem('matrix-theme', dark ? 'dark' : 'light'); } catch { /* Storage can be unavailable in private contexts. */ }
  }, [dark]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setMobileOpen(false); setSearchOpen(value => !value);
      }
    };
    const media = window.matchMedia('(min-width: 1280px)');
    const resize = () => { setDesktop(media.matches); if (media.matches) setMobileOpen(false); };
    window.addEventListener('keydown', handler);
    media.addEventListener('change', resize);
    return () => { window.removeEventListener('keydown', handler); media.removeEventListener('change', resize); };
  }, []);

  useEffect(() => {
    if (!accountOpen) return;
    const outside = (event: PointerEvent) => { if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setAccountOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [accountOpen]);

  const navigate = (key: DashboardTab) => { onNavigate(key); setMobileOpen(false); setSearchOpen(false); setQuery(''); window.scrollTo({ top: 0 }); };
  const openLocation = () => { onLocation(); setMobileOpen(false); setSearchOpen(false); setQuery(''); };
  const matches = dashboardNavigation.filter(item => `${item.label} ${item.description}`.toLowerCase().includes(query.toLowerCase()));
  const locationMatch = `${locationNavigation.label} ${locationNavigation.description}`.toLowerCase().includes(query.toLowerCase());
  const pageTitle = locationActive ? 'One Location' : dashboardTabLabels[activeTab];
  const pageDescription = locationActive ? locationNavigation.description : dashboardNavigation.find(item => item.key === activeTab)?.description;

  return <div className={cn('dashboard-shell', collapsed && 'is-collapsed')}>
    <a href="#dashboard-content" className="skip-link">Skip to metrics</a>
    {mobileOpen && <button className="sidebar-backdrop" tabIndex={-1} aria-label="Close navigation backdrop" onClick={() => setMobileOpen(false)} />}
    <aside id="dashboard-navigation" ref={sidebarRef} className={cn('dashboard-sidebar', mobileOpen && 'is-open')}
      inert={!desktop && !mobileOpen ? true : undefined} aria-hidden={!desktop && !mobileOpen ? true : undefined}
      role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen || undefined} aria-label="Dashboard navigation">
      <div className="sidebar-brand-row">
        <button className="brand-home" aria-label="hussh Matrix home" onClick={() => navigate('briefing')}><MatrixBrand compact={collapsed && !mobileOpen} /></button>
        <button className="icon-button sidebar-mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={20} /></button>
      </div>
      <nav className="sidebar-scroll" aria-label="Dashboard sections">
        {['Dashboard', 'Analytics', 'Products', 'Workspace'].map(group => <div className="sidebar-group" key={group}>
          <p className="sidebar-group-label">{collapsed && !mobileOpen ? <span aria-hidden="true">•••</span> : group}</p>
          {dashboardNavigation.filter(item => item.group === group).map(item => <div key={item.key}>
            <button type="button" className={cn('sidebar-link', activeTab === item.key && !locationActive && 'is-active')}
              aria-current={activeTab === item.key && !locationActive ? 'page' : undefined} title={item.label} onClick={() => navigate(item.key)}>
              <item.icon size={21} strokeWidth={1.7} aria-hidden="true" /><span className="sidebar-link-label">{item.label}</span>
              {item.key === 'one' && <ChevronDown className="sidebar-link-arrow" size={16} />}
            </button>
            {item.key === 'one' && <button type="button" className={cn('sidebar-link sidebar-sub-link', locationActive && 'is-active')}
              title="One Location" onClick={openLocation} aria-current={locationActive ? 'page' : undefined}>
              <locationNavigation.icon size={18} aria-hidden="true" /><span className="sidebar-link-label">One Location</span>
            </button>}
          </div>)}
        </div>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-help"><span className="sidebar-help-dot" /><span>Business metrics, made clear.</span><p>Choose a page to explore your data.</p></div>
        <button type="button" className="sidebar-collapse" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(value => !value)}>
          {collapsed ? <ChevronsRight size={18} /> : <><ChevronsLeft size={18} /><span>Collapse sidebar</span></>}
        </button>
      </div>
    </aside>

    <div className="dashboard-workspace">
      <header className="dashboard-topbar">
        <button type="button" className="icon-button mobile-menu-button" aria-label="Open navigation" aria-expanded={mobileOpen} aria-controls="dashboard-navigation" onClick={() => setMobileOpen(true)}><Menu size={22} /></button>
        <span className="mobile-brand"><MatrixBrand /></span>
        <button type="button" className="dashboard-search-trigger" onClick={() => setSearchOpen(true)} aria-label="Search pages">
          <Search size={20} strokeWidth={1.7} /><span>Search pages...</span><kbd>{/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'}</kbd>
        </button>
        <div className="topbar-actions">
          <button type="button" className="icon-button mobile-search-button" aria-label="Search pages" onClick={() => setSearchOpen(true)}><Search size={20} /></button>
          <button type="button" className="icon-button" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setDark(value => !value)}>{dark ? <Sun size={20} /> : <Moon size={20} />}</button>
          <button type="button" className="icon-button" aria-label="Refresh metrics" disabled={refreshing} onClick={onRefresh}><RefreshCw size={19} className={cn(refreshing && 'animate-spin')} /></button>
          {user && <div className="account-control" ref={accountRef}>
            <button className="account-trigger" type="button" aria-label="Account options" aria-expanded={accountOpen} onClick={() => setAccountOpen(value => !value)}>
              {user.picture ? <img className="account-avatar" src={user.picture} alt="" referrerPolicy="no-referrer" /> : <span className="account-avatar">{(user.name || user.email).slice(0, 1).toUpperCase()}</span>}
              <span className="account-name">{user.name || user.email.split('@')[0]}</span><ChevronDown size={16} />
            </button>
            {accountOpen && <div className="account-popover"><strong>{user.name || 'Your account'}</strong><p>{user.email}</p><button type="button" onClick={onSignOut}><LogOut size={18} />Sign out</button></div>}
          </div>}
        </div>
      </header>

      <div id="dashboard-content" className="metrics-content" tabIndex={-1}>
        <div className="dashboard-page-heading">
          <div><h1>{pageTitle}</h1><p>{pageDescription}</p></div>
          <div className="dashboard-breadcrumb" aria-label="Breadcrumb"><button type="button" onClick={() => navigate('briefing')}>Home</button><ChevronRight size={16} /><span>{pageTitle}</span></div>
        </div>
        <div className="dashboard-status" role="status"><span className={cn('status-dot', refreshing && 'is-updating')} /><span>{status}</span></div>
        <details className="mb-5 rounded-lg border border-stroke bg-surface px-4 py-3 text-xs leading-5 text-muted">
          <summary className="cursor-pointer font-semibold text-ink">Quick guide to the numbers</summary>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div><dt className="font-semibold text-ink">Accounts</dt><dd>Different signed-in accounts. One account may use several devices; an account is not a verified unique person.</dd></div>
            <div><dt className="font-semibold text-ink">Devices and browsers</dt><dd>Different app or browser IDs. One person may have more than one.</dd></div>
            <div><dt className="font-semibold text-ink">Visits, actions and requests</dt><dd>Recorded activity. Repeats count again; website requests may include automatic traffic.</dd></div>
            <div><dt className="font-semibold text-ink">Live and test data</dt><dd>Production is the live product reporting source. UAT is the test source. Mobile builds can use a different service, as labeled in each report.</dd></div>
            <div><dt className="font-semibold text-ink">Missing or recent data</dt><dd>0 means no matching activity was recorded. — means unavailable or untracked. Recent data can arrive late.</dd></div>
            <div><dt className="font-semibold text-ink">Daily, weekly and monthly</dt><dd>1, 7 and 30 days ending on the date shown. Counts across days or agents can overlap.</dd></div>
          </dl>
        </details>
        {children}
        <footer className="dashboard-footer"><span>hussh Matrix</span><span>Aggregate metrics · source timestamps shown on each report</span></footer>
      </div>
    </div>

    {searchOpen && <div className="search-backdrop" onClick={() => setSearchOpen(false)}>
      <div ref={searchRef} role="dialog" aria-modal="true" aria-label="Find a dashboard page" className="page-search-dialog" onClick={event => event.stopPropagation()}>
        <div className="page-search-input"><Search size={21} /><input type="search" aria-label="Search dashboard pages" placeholder="Which page are you looking for?" value={query} onChange={event => setQuery(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') { if (matches[0]) navigate(matches[0].key); else if (locationMatch) openLocation(); } }} />
          <button type="button" className="icon-button" aria-label="Close search" onClick={() => setSearchOpen(false)}><X size={19} /></button></div>
        <div className="page-search-results">{matches.map(item => <button type="button" key={item.key} onClick={() => navigate(item.key)}><item.icon size={21} /><span><strong>{item.label}</strong><small>{item.description}</small></span><ArrowRight size={18} /></button>)}
          {locationMatch && <button type="button" onClick={openLocation}><locationNavigation.icon size={21} /><span><strong>One Location</strong><small>{locationNavigation.description}</small></span><ArrowRight size={18} /></button>}
          {!matches.length && !locationMatch && <p className="search-empty">No matching pages. Try “growth”, “users” or “location”.</p>}
        </div>
      </div>
    </div>}
  </div>;
}
