import { ChevronRight, Menu, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import type { ViewId } from './Sidebar';

interface TopbarProps {
  view: ViewId;
  search: string;
  loading: boolean;
  connected: boolean;
  lastUpdated?: string;
  onSearch: (value: string) => void;
  onRefresh: () => void;
  onOpenMenu: () => void;
}

const pageMeta: Record<ViewId, { title: string; subtitle: string }> = {
  overview: { title: '概览', subtitle: 'Overview' },
  services: { title: '服务导航', subtitle: '家庭服务与管理入口' },
  monitor: { title: '系统监控', subtitle: '硬件、网络与容器状态' },
  topology: { title: '网络拓扑', subtitle: '设备关系与链路状态' },
  settings: { title: '设置', subtitle: '工作区与数据管理' },
};

export function Topbar({ view, search, loading, connected, lastUpdated, onSearch, onRefresh, onOpenMenu }: TopbarProps) {
  const meta = pageMeta[view];
  return (
    <header className="topbar">
      <div className="topbar-title">
        <button className="icon-button mobile-menu" onClick={onOpenMenu} aria-label="打开菜单">
          <Menu size={20} />
        </button>
        <div>
          <p>控制中心 <ChevronRight size={12} /> <span>{meta.subtitle}</span></p>
          <h1>{meta.title}</h1>
        </div>
      </div>
      <div className="topbar-actions">
        {view === 'services' && (
          <label className="search-box">
            <Search size={16} />
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="搜索服务"
              aria-label="搜索服务"
            />
          </label>
        )}
        <span className={`live-source ${connected ? '' : 'is-stale'}`}><i className="live-pulse" /> {connected ? 'LIVE DATA' : 'DATA STALE'}</span>
        <span className="readonly-badge"><ShieldCheck size={13} /> HOME SERVER</span>
        <div className="refresh-meta">
          <span>{lastUpdated ? `更新于 ${lastUpdated}` : '等待数据'}</span>
          <button className="icon-button" onClick={onRefresh} disabled={loading} aria-label="刷新数据" title="刷新数据">
            <RefreshCw size={17} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>
    </header>
  );
}
