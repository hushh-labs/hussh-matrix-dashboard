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
          'flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition hover:bg-[#f1f3f4]',
          collapsed && 'justify-center px-0',
        )}
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium"
          style={{ backgroundColor: meta?.color ?? '#5f6368', color: '#fff' }}
        >
          {getProjectLabel(selectedProject).charAt(0)}
        </span>
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[#202124]">
                {getProjectLabel(selectedProject)}
              </p>
              {meta && (
                <p className="truncate text-xs text-[#5f6368]">{meta.domain}</p>
              )}
            </div>
            <ChevronDown className={cn('h-4 w-4 shrink-0 text-[#5f6368] transition', open && 'rotate-180')} />
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
                'absolute left-3 right-3 z-50 mt-1 rounded-lg border border-[#dadce0] bg-white py-1 shadow-lg',
                collapsed && 'left-[52px] right-auto w-56',
              )}
            >
              <div className="px-3 py-2 text-xs font-medium uppercase tracking-wide text-[#5f6368]">
                Your projects
              </div>
              <button
                type="button"
                onClick={() => { onSelectProject('all'); setOpen(false); }}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-[#f1f3f4]',
                  selectedProject === 'all' && 'bg-[#e8f0fe] font-medium',
                )}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#5f6368] text-xs font-medium text-white">
                  A
                </span>
                <span className="text-[#202124]">All Projects</span>
              </button>
              {PROJECTS.map((project) => (
                <button
                  key={project.key}
                  type="button"
                  onClick={() => { onSelectProject(project.key); setOpen(false); }}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-[#f1f3f4]',
                    selectedProject === project.key && 'bg-[#e8f0fe] font-medium',
                  )}
                >
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: project.color }}
                  >
                    {project.name.charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="text-[#202124]">{project.name}</span>
                    <p className="truncate text-xs text-[#5f6368]">{project.domain}</p>
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
          className="flex w-full items-center justify-between px-6 py-2 text-xs font-medium uppercase tracking-wide text-[#5f6368] transition hover:text-[#202124]"
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
                  'flex w-full items-center gap-3 rounded-full px-3 py-2 text-sm transition',
                  collapsed ? 'mx-auto w-10 justify-center rounded-lg px-0' : 'mx-3',
                  isActive
                    ? 'bg-[#e8f0fe] font-medium text-[#1a73e8]'
                    : 'font-normal text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#202124]',
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={isActive ? 2 : 1.5} />
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

      <div className="border-b border-[#dadce0]" />

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
                'flex w-full items-center gap-3 rounded-full px-3 py-2.5 text-sm transition',
                collapsed ? 'mx-auto w-10 justify-center rounded-lg px-0' : 'mx-3',
                isActive
                  ? 'bg-[#e8f0fe] font-medium text-[#1a73e8]'
                  : 'font-normal text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#202124]',
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={isActive ? 2 : 1.5} />
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

      <div className="border-t border-[#dadce0] p-3">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex w-full items-center justify-center gap-2 rounded-full px-3 py-2 text-sm text-[#5f6368] transition hover:bg-[#f1f3f4] hover:text-[#202124]"
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

      <div className="border-b border-[#dadce0]" />

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
                'mx-3 flex w-full items-center gap-3 rounded-full px-3 py-2.5 text-sm transition',
                isActive
                  ? 'bg-[#e8f0fe] font-medium text-[#1a73e8]'
                  : 'font-normal text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#202124]',
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={isActive ? 2 : 1.5} />
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
          'hidden h-screen flex-shrink-0 border-r border-[#dadce0] bg-white transition-[width] duration-200 lg:block',
          collapsed ? 'w-[56px]' : 'w-[260px]',
        )}
      >
        {desktopContent}
      </aside>

      {!mobileOpen && (
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="fixed left-3 top-3 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-[#dadce0] bg-white shadow-sm lg:hidden"
          aria-label="Open sidebar"
        >
          <Menu className="h-5 w-5 text-[#5f6368]" />
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
              className="fixed inset-y-0 left-0 z-50 w-[280px] border-r border-[#dadce0] bg-white shadow-xl lg:hidden"
            >
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="absolute right-3 top-4 flex h-8 w-8 items-center justify-center rounded-full text-[#5f6368] transition hover:bg-[#f1f3f4] hover:text-[#202124]"
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
