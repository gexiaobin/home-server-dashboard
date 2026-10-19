import {
  Activity,
  Boxes,
  LayoutGrid,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  X,
} from 'lucide-react';

export type ViewId = 'services' | 'monitor' | 'topology' | 'settings';

interface SidebarProps {
  title: string;
  view: ViewId;
  open: boolean;
  collapsed: boolean;
  online: boolean;
  onNavigate: (view: ViewId) => void;
  onClose: () => void;
  onToggleCollapse: () => void;
}

const items = [
  { id: 'services' as const, label: '服务导航', icon: LayoutGrid },
  { id: 'monitor' as const, label: '系统监控', icon: Activity },
  { id: 'topology' as const, label: '网络拓扑', icon: Network },
  { id: 'settings' as const, label: '设置', icon: Settings },
];

export function Sidebar({
  title,
  view,
  open,
  collapsed,
  online,
  onNavigate,
  onClose,
  onToggleCollapse,
}: SidebarProps) {
  return (
    <>
      {open && <button className="sidebar-backdrop" aria-label="关闭菜单" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'is-open' : ''} ${collapsed ? 'is-collapsed' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><Boxes size={20} strokeWidth={1.8} /></div>
          <div className="brand-copy">
            <strong>{title}</strong>
            <span>HOME OPERATIONS</span>
          </div>
          <button className="icon-button sidebar-mobile-close" onClick={onClose} aria-label="关闭菜单">
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="主导航">
          <div className="nav-section-label">工作区</div>
          {items.slice(0, 3).map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-item ${view === item.id ? 'is-active' : ''}`}
                onClick={() => onNavigate(item.id)}
                title={collapsed ? item.label : undefined}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{item.label}</span>
              </button>
            );
          })}
          <div className="nav-section-label nav-section-spacer">系统</div>
          {items.slice(3).map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-item ${view === item.id ? 'is-active' : ''}`}
                onClick={() => onNavigate(item.id)}
                title={collapsed ? item.label : undefined}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="connection-state" title={online ? '后端连接正常' : '后端连接中断'}>
            <span className={`status-dot ${online ? 'is-up' : 'is-down'}`} />
            <div>
              <strong>{online ? '系统已连接' : '连接已中断'}</strong>
              <span>{online ? '实时数据同步中' : '请检查服务端'}</span>
            </div>
          </div>
          <button className="collapse-button" onClick={onToggleCollapse} aria-label={collapsed ? '展开侧栏' : '收起侧栏'}>
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            <span>收起侧栏</span>
          </button>
        </div>
      </aside>
    </>
  );
}
