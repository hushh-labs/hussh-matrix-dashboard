import { useState } from 'react';
import Sidebar from './Sidebar';
import Dashboard from '../Dashboard';
import type { ProjectKey, ViewKey } from '../lib/navigation';

export default function DashboardLayout() {
  const [selectedProject, setSelectedProject] = useState<ProjectKey>('all');
  const [activeView, setActiveView] = useState<ViewKey>('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="flex h-screen bg-[#f8f9fa] text-[#202124]">
      <Sidebar
        selectedProject={selectedProject}
        onSelectProject={setSelectedProject}
        activeView={activeView}
        onChangeView={setActiveView}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto">
          <Dashboard
            selectedProject={selectedProject}
            activeView={activeView}
          />
        </main>
      </div>
    </div>
  );
}
