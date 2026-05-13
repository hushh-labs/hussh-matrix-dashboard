import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '../lib/utils';
import {
  PROJECTS,
  NAV_ITEMS,
  NAV_SECTIONS,
  getProjectLabel,
  getProjectMeta,
  type ProjectKey,
  type ViewKey,
  type NavSection,
} from '../lib/navigation';

interface SidebarProps {
  selectedProject: ProjectKey;
  onSelectProject: (project: ProjectKey) => void;
  activeView: ViewKey;
  onChangeView: (view: ViewKey) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

function ProjectDropdown({
  selectedProject,
  onSelectProject,
  collapsed,
}: {
  selectedProject: ProjectKey;
  onSelectProject: (project: ProjectKey) => void;
  collapsed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const meta = getProjectMeta(selectedProject);

  return (
    <div className="relative px-3 py-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition hover:bg-[#f5f5f7]',
          collapsed && 'justify-center px-0',
        )}
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-lg"
          style={{ backgroundColor: meta?.color ?? '#6e6e73', color: '#fff' }}
        >
          {getProjectLabel(selectedProject).charAt(0)}
        </span>
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[#1d1d1f]">
                {getProjectLabel(selectedProject)}
              </p>
              {meta && (
                <p className="truncate text-xs font-medium text-[#86868b]">{meta.domain}</p>
              )}
            </div>
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-[#86868b] transition', open && 'rotate-180')} />
          </>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className={cn(
                'absolute left-3 right-3 z-50 mt-1 rounded-lg border border-black/[0.08] bg-white py-1 shadow-lg',
                collapsed && 'left-[52px] right-auto w-56',
              )}
            >
              <div className="px-3 py-2 text-xs font-bold uppercase text-[#86868b]">
                Your projects
              </div>
              <button
                type="button"
                onClick={() => { onSelectProject('all'); setOpen(false); }}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-[#f5f5f7]',
                  selectedProject === 'all' && 'bg-[#f0f0f2] font-semibold',
                )}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#6e6e73] text-xs font-bold text-white">
                  A
                </span>
                <span className="text-[#1d1d1f]">All Projects</span>
              </button>
              {PROJECTS.map((project) => (
                <button
                  key={project.key}
                  type="button"
                  onClick={() => { onSelectProject(project.key); setOpen(false); }}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-[#f5f5f7]',
                    selectedProject === project.key && 'bg-[#f0f0f2] font-semibold',
                  )}
                >
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold text-white"
                    style={{ backgroundColor: project.color }}
                  >
                    {project.name.charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="text-[#1d1d1f]">{project.name}</span>
                    <p className="truncate text-xs text-[#86868b]">{project.domain}</p>
                  </div>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

interface SidebarNavSectionProps {
  section: NavSection;
  activeView: ViewKey;
  onChangeView: (view: ViewKey) => void;
  collapsed: boolean;
}

function SidebarNavSection({
  section,
  activeView,
  onChangeView,
  collapsed,
}: SidebarNavSectionProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mt-1">
      {!collapsed && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between px-6 py-2 text-xs font-bold uppercase text-[#86868b] transition hover:text-[#1d1d1f]"
        >
          {section.label}
          <ChevronDown className={cn('h-3 w-3 transition', !expanded && '-rotate-90')} />
        </button>
      )}
      {(collapsed || expanded) && (
        <div className="space-y-0.5">
          {section.items.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.viewKey;
            return (
              <button
                key={item.viewKey}
                type="button"
                onClick={() => onChangeView(item.viewKey)}
                title={collapsed ? item.label : undefined}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                  collapsed ? 'mx-auto w-10 justify-center px-0' : 'mx-3',
                  isActive
                    ? 'bg-[#f0f0f2] font-semibold text-[#1d1d1f]'
                    : 'text-[#6e6e73] hover:bg-[#f5f5f7] hover:text-[#1d1d1f]',
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={isActive ? 2.2 : 1.8} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({
  selectedProject,
  onSelectProject,
  activeView,
  onChangeView,
  collapsed,
  onToggleCollapse,
}: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleNavClick = (view: ViewKey) => {
    onChangeView(view);
    setMobileOpen(false);
  };

  const handleProjectSelect = (project: ProjectKey) => {
    onSelectProject(project);
    setMobileOpen(false);
  };

  const desktopContent = (
    <div className="flex h-full flex-col">
      <ProjectDropdown
        selectedProject={selectedProject}
        onSelectProject={onSelectProject}
        collapsed={collapsed}
      />

      <div className="border-b border-black/[0.06]" />

      <nav className="flex-1 overflow-y-auto py-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.viewKey;
          return (
            <button
              key={item.viewKey}
              type="button"
              onClick={() => onChangeView(item.viewKey)}
              title={collapsed ? item.label : undefined}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
                collapsed ? 'mx-auto w-10 justify-center px-0' : 'mx-3',
                isActive
                  ? 'bg-[#f0f0f2] font-semibold text-[#1d1d1f]'
                  : 'text-[#6e6e73] hover:bg-[#f5f5f7] hover:text-[#1d1d1f]',
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={isActive ? 2.2 : 1.8} />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}

        {NAV_SECTIONS.map((section) => {
          const sectionKey = section.label;
          return (
            <div key={sectionKey}>
              <SidebarNavSection
                section={section}
                activeView={activeView}
                onChangeView={onChangeView}
                collapsed={collapsed}
              />
            </div>
          );
        })}
      </nav>

      <div className="border-t border-black/[0.06] p-3">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-[#86868b] transition hover:bg-[#f5f5f7] hover:text-[#1d1d1f]"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronLeft className="h-4 w-4" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </div>
  );

  const mobileContent = (
    <div className="flex h-full flex-col">
      <ProjectDropdown
        selectedProject={selectedProject}
        onSelectProject={handleProjectSelect}
        collapsed={false}
      />

      <div className="border-b border-black/[0.06]" />

      <nav className="flex-1 overflow-y-auto py-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.viewKey;
          return (
            <button
              key={item.viewKey}
              type="button"
              onClick={() => handleNavClick(item.viewKey)}
              className={cn(
                'mx-3 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
                isActive
                  ? 'bg-[#f0f0f2] font-semibold text-[#1d1d1f]'
                  : 'text-[#6e6e73] hover:bg-[#f5f5f7] hover:text-[#1d1d1f]',
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}

        {NAV_SECTIONS.map((section) => {
          const sectionKey = section.label;
          return (
            <div key={sectionKey}>
              <SidebarNavSection
                section={section}
                activeView={activeView}
                onChangeView={handleNavClick}
                collapsed={false}
              />
            </div>
          );
        })}
      </nav>
    </div>
  );

  return (
    <>
      <aside
        className={cn(
          'hidden h-screen flex-shrink-0 border-r border-black/[0.08] bg-white transition-[width] duration-200 lg:block',
          collapsed ? 'w-[56px]' : 'w-[260px]',
        )}
      >
        {desktopContent}
      </aside>

      {!mobileOpen && (
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="fixed left-3 top-3 z-40 flex h-10 w-10 items-center justify-center rounded-lg border border-black/[0.08] bg-white shadow-sm lg:hidden"
          aria-label="Open sidebar"
        >
          <Menu className="h-5 w-5 text-[#1d1d1f]" />
        </button>
      )}

      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/30 lg:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed inset-y-0 left-0 z-50 w-[280px] border-r border-black/[0.08] bg-white shadow-xl lg:hidden"
            >
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="absolute right-3 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-[#86868b] transition hover:bg-[#f5f5f7] hover:text-[#1d1d1f]"
                aria-label="Close sidebar"
              >
                <X className="h-5 w-5" />
              </button>
              {mobileContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
