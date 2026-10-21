import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import { api } from './api';
import { ServiceDialog } from './components/ServiceDialog';
import { Sidebar, type ViewId } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import type { AppConfig, MetricPoint, NetworkMode, Overview, Service } from './types';
import { OverviewView } from './views/OverviewView';
import { ServicesView } from './views/ServicesView';

const MonitorView = lazy(() => import('./views/MonitorView').then((module) => ({ default: module.MonitorView })));
const SettingsView = lazy(() => import('./views/SettingsView').then((module) => ({ default: module.SettingsView })));
const TopologyView = lazy(() => import('./views/TopologyView').then((module) => ({ default: module.TopologyView })));

const validViews: ViewId[] = ['overview', 'services', 'monitor', 'topology', 'settings'];
const NETWORK_MODE_STORAGE_KEY = 'service-network-mode';

function storedNetworkMode(): NetworkMode {
  try {
    return window.localStorage.getItem(NETWORK_MODE_STORAGE_KEY) === 'external' ? 'external' : 'internal';
  } catch {
    return 'internal';
  }
}

function viewFromHash(): ViewId {
  const value = window.location.hash.replace(/^#\/?/, '') as ViewId;
  return validViews.includes(value) ? value : 'overview';
}

export function App() {
  const [view, setView] = useState<ViewId>(viewFromHash);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [history, setHistory] = useState<MetricPoint[]>([]);
  const [search, setSearch] = useState('');
  const [networkMode, setNetworkMode] = useState<NetworkMode>(storedNetworkMode);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const overviewRequestInFlight = useRef(false);
  const searchRef = useRef(search);
  searchRef.current = search;

  const refreshOverview = useCallback(async (silent = false) => {
    if (overviewRequestInFlight.current) return;
    overviewRequestInFlight.current = true;
    if (!silent) setRefreshing(true);
    try {
      const next = await api.getOverview();
      setOverview(next);
      setError('');
      const at = new Date(next.timestamp);
      if (!Number.isNaN(at.getTime())) {
        setHistory((items) => [...items, {
          time: at.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          cpu: next.cpu.usage,
          memory: next.memory.percent,
          rx: next.network.rxBytesPerSecond / 1024 / 1024,
          tx: next.network.txBytesPerSecond / 1024 / 1024,
        }].slice(-36));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法连接服务端');
    } finally {
      overviewRequestInFlight.current = false;
      if (!silent) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      try {
        const nextConfig = await api.getConfig();
        if (!active) return;
        setConfig(nextConfig);
        await refreshOverview(true);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : '无法加载配置');
      } finally {
        if (active) setInitialLoading(false);
      }
    }
    void bootstrap();
    return () => { active = false; };
  }, [refreshOverview]);

  useEffect(() => {
    if (!config) return;
    const timer = window.setInterval(() => void refreshOverview(true), Math.max(3000, config.settings.refreshInterval));
    return () => window.clearInterval(timer);
  }, [config?.settings.refreshInterval, config, refreshOverview]);

  useEffect(() => {
    function syncHash() { setView(viewFromHash()); setSidebarOpen(false); }
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  useEffect(() => {
    function syncNetworkMode(event: StorageEvent) {
      if (event.key !== NETWORK_MODE_STORAGE_KEY) return;
      setNetworkMode(event.newValue === 'external' ? 'external' : 'internal');
    }
    window.addEventListener('storage', syncNetworkMode);
    return () => window.removeEventListener('storage', syncNetworkMode);
  }, []);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (event.key === '/' && view === 'services' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        (document.querySelector('.search-box input') as HTMLInputElement | null)?.focus();
      }
      if (event.key === 'Escape') {
        if (dialogOpen) setDialogOpen(false);
        if (sidebarOpen) setSidebarOpen(false);
      }
    }
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [view, dialogOpen, sidebarOpen]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function navigate(next: ViewId) {
    window.location.hash = `/${next}`;
    setView(next);
    setSidebarOpen(false);
  }

  function changeNetworkMode(next: NetworkMode) {
    setNetworkMode(next);
    try {
      window.localStorage.setItem(NETWORK_MODE_STORAGE_KEY, next);
    } catch {
      // The active mode still works for this tab when browser storage is unavailable.
    }
  }

  async function saveConfig(next: AppConfig, message = '设置已保存') {
    setSaving(true);
    try {
      const saved = await api.saveConfig(next);
      setConfig(saved);
      setToast(message);
      setDialogOpen(false);
      setEditingService(null);
      void refreshOverview(true);
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : '保存失败');
      throw cause;
    } finally {
      setSaving(false);
    }
  }

  async function saveService(service: Service) {
    if (!config) return;
    const exists = config.services.some((item) => item.id === service.id);
    const services = exists
      ? config.services.map((item) => item.id === service.id ? service : item)
      : [...config.services, service];
    await saveConfig({ ...config, services }, exists ? '服务已更新' : '服务已添加');
  }

  async function deleteService(id: string) {
    if (!config) return;
    await saveConfig({ ...config, services: config.services.filter((item) => item.id !== id) }, '服务已删除');
  }

  async function toggleFavorite(service: Service) {
    if (!config) return;
    const services = config.services.map((item) => item.id === service.id ? { ...item, favorite: !item.favorite } : item);
    await saveConfig({ ...config, services }, service.favorite ? '已取消常用' : '已设为常用');
  }

  const categories = useMemo(() => config ? [...new Set(config.services.map((item) => item.category))] : [], [config]);
  const overviewTimestamp = overview ? new Date(overview.timestamp) : null;
  const lastUpdated = overviewTimestamp && !Number.isNaN(overviewTimestamp.getTime())
    ? overviewTimestamp.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    : undefined;

  if (initialLoading) {
    return (
      <div className="boot-screen">
        <div className="boot-mark"><LoaderCircle size={24} className="spin" /></div>
        <strong>HomeLab Console</strong>
        <span>正在连接家庭服务器</span>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="fatal-screen">
        <div className="fatal-icon"><AlertTriangle size={25} /></div>
        <h1>无法加载工作区</h1>
        <p>{error || '服务端暂时不可用。'}</p>
        <button className="button button-primary" onClick={() => window.location.reload()}>重新连接</button>
      </div>
    );
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar
        title={config.settings.title}
        view={view}
        open={sidebarOpen}
        collapsed={sidebarCollapsed}
        online={Boolean(overview) && !error}
        onNavigate={navigate}
        onClose={() => setSidebarOpen(false)}
        onToggleCollapse={() => {
          setSidebarCollapsed((value) => {
            localStorage.setItem('sidebar-collapsed', String(!value));
            return !value;
          });
        }}
      />
      <div className="app-main">
        <Topbar
          view={view}
          search={search}
          loading={refreshing}
          connected={Boolean(overview) && !error}
          lastUpdated={lastUpdated}
          networkMode={networkMode}
          onSearch={setSearch}
          onRefresh={() => void refreshOverview()}
          onOpenMenu={() => setSidebarOpen(true)}
          onNetworkModeChange={changeNetworkMode}
        />
        {error && (
          <div className="connection-banner" role="alert">
            <AlertTriangle size={15} />
            <span>{error}{overview ? '，正在显示最近一次数据。' : '。'}</span>
          </div>
        )}
        <main className={`page-content page-${view}`}>
          {view === 'overview' && (
            <OverviewView
              config={config}
              overview={overview}
              connected={Boolean(overview) && !error}
              networkMode={networkMode}
              onNavigate={navigate}
            />
          )}
          {view === 'services' && (
            <ServicesView
              services={config.services}
              health={overview?.services || []}
              search={search}
              networkMode={networkMode}
              onAdd={() => { setEditingService(null); setDialogOpen(true); }}
              onEdit={(service) => { setEditingService(service); setDialogOpen(true); }}
              onToggleFavorite={(service) => void toggleFavorite(service)}
            />
          )}
          <Suspense fallback={<div className="view-loading"><LoaderCircle size={21} className="spin" /><span>加载工作区</span></div>}>
            {view === 'monitor' && <MonitorView overview={overview} history={history} connected={Boolean(overview) && !error} />}
            {view === 'topology' && <TopologyView topology={config.topology} services={config.services} health={overview?.services || []} networkMode={networkMode} />}
            {view === 'settings' && (
              <SettingsView
                config={config}
                detectedHostname={overview?.system.detectedHostname}
                saving={saving}
                onSave={saveConfig}
              />
            )}
          </Suspense>
        </main>
      </div>
      <ServiceDialog
        service={editingService}
        categories={categories}
        open={dialogOpen}
        saving={saving}
        onClose={() => { if (!saving) { setDialogOpen(false); setEditingService(null); } }}
        onSave={saveService}
        onDelete={editingService ? deleteService : undefined}
      />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
