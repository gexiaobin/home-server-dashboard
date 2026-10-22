import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  CheckCircle2,
  Cpu,
  Globe2,
  HardDrive,
  Network,
  Server,
} from 'lucide-react';
import datacenterImage from '../assets/datacenter.jpg';
import { ServiceAppIcon } from '../components/ServiceAppIcon';
import { formatRate, formatUptime, statusLabel } from '../lib/format';
import { getServiceHost, getServiceUrl } from '../lib/service-url';
import type { AppConfig, NetworkMode, Overview, ServiceHealth } from '../types';
import type { ViewId } from '../components/Sidebar';

interface OverviewViewProps {
  config: AppConfig;
  overview: Overview | null;
  connected?: boolean;
  networkMode: NetworkMode;
  onNavigate: (view: ViewId) => void;
}

function healthByService(health: ServiceHealth[]) {
  return new Map(health.map((item) => [item.id, item]));
}

export function OverviewView({ config, overview, connected, networkMode, onNavigate }: OverviewViewProps) {
  const isConnected = connected ?? Boolean(overview);
  const internalServices = config.services.filter((service) => service.scope === 'internal');
  const externalBookmarks = config.services
    .filter((service) => service.scope === 'external')
    .sort((left, right) => Number(right.favorite) - Number(left.favorite));
  const serviceIds = new Set(internalServices.map((service) => service.id));
  const currentHealth = overview?.services.filter((item) => serviceIds.has(item.id)) ?? [];
  const statusById = healthByService(currentHealth);
  const launchServices = (internalServices.some((service) => service.favorite)
    ? internalServices.filter((service) => service.favorite)
    : internalServices).slice(0, 6);
  const upCount = currentHealth.filter((item) => item.status === 'up').length;
  const downServices = internalServices.filter((service) => statusById.get(service.id)?.status === 'down');
  const uncheckedCount = internalServices.filter((service) => service.check.type === 'none').length;
  const pendingCount = internalServices.filter((service) => !statusById.has(service.id)).length;
  const topologyNodeCount = 4 + internalServices.filter((service) => service.runtime !== 'infrastructure').length;
  const storage = overview?.disks.reduce(
    (total, disk) => ({ used: total.used + disk.used, total: total.total + disk.total }),
    { used: 0, total: 0 },
  );
  const storagePercent = storage && storage.total > 0
    ? Math.round((storage.used / storage.total) * 100)
    : null;
  const cpuUsage = overview ? Math.max(0, Math.min(100, Math.round(overview.cpu.usage))) : null;
  const loadAverage = overview?.system.loadAverage.slice(0, 3) ?? [];
  const loadAverageLabel = loadAverage.length
    ? loadAverage.map((value) => overview && overview.cpu.cores > 0
      ? `${Math.round((value / overview.cpu.cores) * 100)}%`
      : '--').join(' · ')
    : '--';
  const runningContainerCount = overview?.containers.filter((item) => item.state.toLowerCase() === 'running').length ?? 0;
  const date = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).format(new Date());

  return (
    <div className="overview-view">
      <header className="overview-heading">
        <div>
          <div className="eyebrow">PERSONAL INFRASTRUCTURE / HOME — 01</div>
          <h2>{config.settings.title}<span className="heading-dot">.</span></h2>
          <p>{config.settings.location || '家庭数据中心'} <span>/</span> 服务、主机与网络运行态势</p>
        </div>
        <div className="overview-date">
          <strong>{date}</strong>
          <span className={isConnected ? '' : 'is-stale'}><i className="live-pulse" /> {isConnected ? 'LIVE SYSTEM' : 'SYSTEM OFFLINE'}</span>
        </div>
      </header>

      <section className={`system-ribbon ${downServices.length > 0 || !isConnected ? 'has-alert' : ''}`} aria-label="系统状态摘要">
        <div className="system-ribbon-primary">
          {downServices.length > 0 || !isConnected ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          <strong>{!overview ? '正在等待系统遥测' : !isConnected ? '系统连接已中断' : downServices.length > 0 ? `${downServices.length} 项服务需要关注` : '核心系统运行正常'}</strong>
          <span>{isConnected ? 'REALTIME TELEMETRY' : overview ? 'STALE TELEMETRY' : 'TELEMETRY UNAVAILABLE'}</span>
        </div>
        <div><b>{topologyNodeCount}</b><span>拓扑节点</span></div>
        <div><b>{upCount}</b><span>服务在线</span></div>
        <div><b>{uncheckedCount}</b><span>未配置探测</span></div>
      </section>

      <section className="launch-surface">
        <div className="launch-heading">
          <div>
            <div className="eyebrow">SERVICE LAUNCH SURFACE</div>
            <h2>常用服务<span>快速进入家庭服务</span></h2>
          </div>
          <div className="launch-signal">
            <i className="live-pulse" />
            <strong>{upCount}</strong>
            <span>ONLINE<br /><small>{internalServices.length} REGISTERED</small></span>
          </div>
        </div>

        <div className="launch-grid">
          {launchServices.map((service) => {
            const status = statusById.get(service.id);
            const state = status?.status ?? 'unknown';
            const activeUrl = getServiceUrl(service, networkMode);
            const activeHost = getServiceHost(service, networkMode) || '未配置互联网地址';
            return (
              <article className={`launch-card is-${state}`} key={service.id}>
                <div className="launch-card-top">
                  <ServiceAppIcon service={service} />
                  <span className={`health-chip is-${state}`}><i />{statusLabel(state)}</span>
                </div>
                <div className="launch-card-copy">
                  <h3>{service.name}</h3>
                  <p>{service.description || service.category}</p>
                </div>
                <div className="launch-card-meta">
                  <span>{service.category}</span>
                  <code title={activeHost}>{activeHost}</code>
                </div>
                {activeUrl ? (
                  <a className="launch-open" href={activeUrl} target="_blank" rel="noreferrer" aria-label={`打开 ${service.name}`}>
                    打开服务 <ArrowUpRight size={15} />
                  </a>
                ) : (
                  <button className="launch-open is-disabled" type="button" disabled title="未配置互联网地址">
                    未配置互联网地址 <ArrowUpRight size={15} />
                  </button>
                )}
              </article>
            );
          })}
          {launchServices.length === 0 && (
            <div className="launch-empty">
              <Server size={24} />
              <strong>尚未登记服务</strong>
              <button className="button button-secondary" onClick={() => onNavigate('services')}>前往服务中心</button>
            </div>
          )}
        </div>

        <div className="launch-footer">
          <span><i className="live-pulse" /> {overview ? '实时状态来自服务端健康检查' : '正在等待服务端健康检查'}</span>
          <button className="text-action" onClick={() => onNavigate('services')}>全部服务 <ArrowRight size={14} /></button>
        </div>
      </section>

      {externalBookmarks.length > 0 && (
        <section className="launch-surface bookmark-surface" aria-labelledby="bookmark-surface-title">
          <div className="launch-heading">
            <div>
              <div className="eyebrow">EXTERNAL BOOKMARK DIRECTORY</div>
              <h2 id="bookmark-surface-title">外网书签<span>云服务与互联网入口</span></h2>
            </div>
            <div className="launch-signal bookmark-signal">
              <Bookmark size={17} />
              <strong>{externalBookmarks.length}</strong>
              <span>LINKS<br /><small>PUBLIC DIRECTORY</small></span>
            </div>
          </div>

          <div className="launch-grid bookmark-grid">
            {externalBookmarks.map((service) => {
              const url = getServiceUrl(service, networkMode);
              const host = getServiceHost(service, networkMode) || '地址不可用';
              return (
                <article className="launch-card is-bookmark" key={service.id}>
                  <div className="launch-card-top">
                    <ServiceAppIcon service={service} />
                    <span className="bookmark-chip"><Globe2 size={12} /> 外网书签</span>
                  </div>
                  <div className="launch-card-copy">
                    <h3>{service.name}</h3>
                    <p>{service.description || service.category}</p>
                  </div>
                  <div className="launch-card-meta">
                    <span>{service.category}</span>
                    <code title={host}>{host}</code>
                  </div>
                  <a className="launch-open" href={url || '#'} target="_blank" rel="noreferrer" aria-label={`打开 ${service.name}`}>
                    打开链接 <ArrowUpRight size={15} />
                  </a>
                </article>
              );
            })}
          </div>

          <div className="launch-footer">
            <span><Bookmark size={12} /> 已收录 {externalBookmarks.length} 个外网书签</span>
            <button className="text-action" onClick={() => onNavigate('services')}>管理书签 <ArrowRight size={14} /></button>
          </div>
        </section>
      )}

      <div className="overview-situation">
        <section className="environment-panel">
          <img src={datacenterImage} alt="数据中心机柜示意图" />
          <div className="environment-content">
            <div className={`environment-status ${isConnected ? '' : 'is-stale'}`}><i className="live-pulse" /> {isConnected ? 'HOST CONNECTED' : overview ? 'HOST DATA STALE' : 'HOST DATA UNAVAILABLE'}</div>
            <h2>家庭数据中心</h2>
            <p>{overview?.system.hostname || '正在读取主机信息'} · {overview ? formatUptime(overview.system.uptime) : '等待数据'}</p>
            <div className="environment-metrics">
              <div><b>{overview ? `${Math.round(overview.cpu.usage)}%` : '--'}</b><span>CPU</span></div>
              <div><b>{overview ? `${Math.round(overview.memory.percent)}%` : '--'}</b><span>内存</span></div>
              <div><b>{storagePercent === null ? '--' : `${storagePercent}%`}</b><span>存储</span></div>
            </div>
            <button className="button button-primary" onClick={() => onNavigate('monitor')}><Activity size={15} /> 查看系统监控</button>
          </div>
        </section>

        <section className="attention-panel">
          <div className="attention-heading">
            <div><AlertTriangle size={16} /><h2>运行关注</h2></div>
            <span>{String(downServices.length).padStart(2, '0')}</span>
          </div>
          {!isConnected ? (
            <div className="attention-clear is-unavailable">
              <AlertTriangle size={28} />
              <strong>{overview ? '系统连接已中断' : '系统状态暂不可用'}</strong>
              <span>{overview ? '正在显示最近一次采样，请检查连接提示' : '请检查页面顶部的连接提示'}</span>
            </div>
          ) : downServices.length > 0 ? (
            <div className="attention-list">
              {downServices.slice(0, 4).map((service) => {
                const status = statusById.get(service.id);
                return (
                  <div key={service.id}>
                    <span className="status-dot is-down" />
                    <div><strong>{service.name}</strong><small>{status?.message || '服务不可达'}</small></div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="attention-clear">
              <CheckCircle2 size={28} />
              <strong>未发现服务故障</strong>
              <span>{uncheckedCount > 0
                ? `${uncheckedCount} 项服务尚未配置主动探测`
                : pendingCount > 0
                  ? `${pendingCount} 项服务正在等待最新状态`
                  : '全部服务检查通过'}</span>
            </div>
          )}
          <button className="text-action" onClick={() => onNavigate('services')}>查看服务状态 <ArrowRight size={14} /></button>
        </section>
      </div>

      <section className="overview-telemetry" aria-label="实时遥测">
        <div className="overview-telemetry-cpu">
          <span><Cpu size={16} /> CPU 使用率</span>
          <strong>{cpuUsage === null ? '--' : `${cpuUsage}%`}</strong>
          <span
            className="cpu-usage-track"
            role="progressbar"
            aria-label="当前 CPU 使用率"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={cpuUsage ?? undefined}
            aria-valuetext={cpuUsage === null ? '暂无数据' : `${cpuUsage}%`}
          >
            <i style={{ width: `${cpuUsage ?? 0}%` }} />
          </span>
          <small className="cpu-load-detail">
            <span>1 / 5 / 15 分钟核心负载率</span>
            <b>{loadAverageLabel}</b>
          </small>
        </div>
        <div>
          <span><HardDrive size={16} /> 可见容器</span>
          <strong>{!overview ? '--' : overview.containersAvailable ? `${runningContainerCount} / ${overview.containers.length}` : '未连接'}</strong>
        </div>
        <div><span><Network size={16} /> 下载</span><strong>{overview ? formatRate(overview.network.rxBytesPerSecond) : '--'}</strong></div>
        <div><span><Network size={16} /> 上传</span><strong>{overview ? formatRate(overview.network.txBytesPerSecond) : '--'}</strong></div>
      </section>
    </div>
  );
}
