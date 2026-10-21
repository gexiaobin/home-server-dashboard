import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Box,
  Boxes,
  Clock3,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  Server,
  Thermometer,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ComponentType, ReactNode } from 'react';
import type { LucideProps } from 'lucide-react';
import type { ContainerInfo, MetricPoint, Overview } from '../types';
import { clampPercent, formatBytes, formatRate, formatUptime } from '../lib/format';

interface MonitorViewProps {
  overview: Overview | null;
  history: MetricPoint[];
  connected?: boolean;
}

type Tone = 'accent' | 'cyan' | 'amber' | 'red';

interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  percent: number;
  icon: ComponentType<LucideProps>;
  tone: Tone;
  status: string;
  secondaryLabel: string;
  secondaryValue: string;
  available?: boolean;
  meterValueText?: string;
  showMeter?: boolean;
}

const LOAD_LABELS = ['最近 1 分钟', '最近 5 分钟', '最近 15 分钟'];

function Meter({
  value,
  tone,
  label,
  valueText = `${Math.round(value)}%`,
  available = true,
}: {
  value: number;
  tone: Tone;
  label: string;
  valueText?: string;
  available?: boolean;
}) {
  const percent = clampPercent(value);
  if (!available) {
    return (
      <div className="monitor-meter" aria-hidden="true">
        <span className={`monitor-meter-fill tone-${tone}`} style={{ width: '0%' }} />
      </div>
    );
  }
  return (
    <div
      className="monitor-meter"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      aria-valuetext={valueText}
    >
      <span className={`monitor-meter-fill tone-${tone}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

function metricStatus(value: number, warning: number, danger: number) {
  if (value >= danger) return '需要关注';
  if (value >= warning) return '负载偏高';
  return '运行稳定';
}

function loadStatus(value: number) {
  if (value >= 100) return { label: '超载', tone: 'danger' };
  if (value >= 75) return { label: '繁忙', tone: 'warning' };
  if (value >= 40) return { label: '正常', tone: 'normal' };
  return { label: '轻载', tone: 'quiet' };
}

function diskLabel(mount: string, index: number) {
  if (mount === '/') return '系统根目录';
  const segment = mount.split('/').filter(Boolean).at(-1);
  if (segment === 'storage') return `存储空间 ${index + 1}`;
  if (/^volume\d+$/i.test(segment || '')) return `存储空间 ${segment?.replace(/\D/g, '')}`;
  return segment || `存储空间 ${index + 1}`;
}

function MetricCard({
  label,
  value,
  detail,
  percent,
  icon: Icon,
  tone,
  status,
  secondaryLabel,
  secondaryValue,
  available = true,
  meterValueText,
  showMeter = true,
}: MetricCardProps) {
  return (
    <article className={`monitor-metric tone-${tone}${available ? '' : ' is-unavailable'}${showMeter ? '' : ' is-meterless'}`} aria-label={`${label} ${value}`}>
      <div className="monitor-metric-heading">
        <span className="monitor-metric-icon"><Icon size={17} /></span>
        <span>{label}</span>
        <i>{available ? status : '未采集'}</i>
      </div>
      <div className="monitor-metric-reading">
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
      {showMeter && (
        <Meter
          value={percent}
          tone={tone}
          label={label}
          valueText={meterValueText}
          available={available}
        />
      )}
      <div className="monitor-metric-foot">
        <span>{secondaryLabel}</span>
        <b>{secondaryValue}</b>
      </div>
    </article>
  );
}

function PanelHeading({
  kicker,
  title,
  icon: Icon,
  children,
}: {
  kicker: string;
  title: string;
  icon: ComponentType<LucideProps>;
  children?: ReactNode;
}) {
  return (
    <div className={`monitor-panel-heading${children ? ' has-tools' : ''}`}>
      <div>
        <span className="panel-kicker">{kicker}</span>
        <h2>{title}</h2>
      </div>
      <div className="monitor-panel-tools">
        {children}
        <Icon size={18} aria-hidden="true" />
      </div>
    </div>
  );
}

function containerState(container: ContainerInfo) {
  const state = container.state.toLowerCase();
  if (state === 'running') return { className: 'is-running', label: '运行中' };
  if (state === 'paused') return { className: 'is-paused', label: '已暂停' };
  if (state === 'restarting') return { className: 'is-restarting', label: '重启中' };
  return { className: 'is-stopped', label: '已停止' };
}

function EmptyMonitor() {
  return (
    <div className="empty-state page-empty-state">
      <div className="empty-icon"><Activity size={25} /></div>
      <h2>正在等待监控数据</h2>
      <p>服务端连接建立后，硬件、网络和容器指标会显示在这里。</p>
    </div>
  );
}

export function MonitorView({ overview, history, connected = true }: MonitorViewProps) {
  if (!overview) return <EmptyMonitor />;

  const storage = overview.disks.reduce(
    (total, disk) => ({ used: total.used + disk.used, total: total.total + disk.total }),
    { used: 0, total: 0 },
  );
  const storagePercent = storage.total > 0 ? (storage.used / storage.total) * 100 : 0;
  const temperature = overview.temperatures.reduce<(typeof overview.temperatures)[number] | undefined>(
    (hottest, candidate) => !hottest || candidate.value > hottest.value ? candidate : hottest,
    undefined,
  );
  const runningContainers = overview.containers.filter((container) => container.state.toLowerCase() === 'running').length;
  const loadAverage = LOAD_LABELS.map((label, index) => ({
    label,
    value: overview.system.loadAverage[index] ?? 0,
  }));
  const oneMinuteLoadPercent = overview.cpu.cores > 0
    ? (loadAverage[0].value / overview.cpu.cores) * 100
    : 0;
  const oneMinuteLoadStatus = loadStatus(oneMinuteLoadPercent);
  const latest = history.at(-1);

  return (
    <div className="monitor-view">
      <section className="monitor-masthead" aria-labelledby="monitor-title">
        <div className="monitor-masthead-copy">
          <span className="panel-kicker"><Activity size={13} /> REALTIME INFRASTRUCTURE</span>
          <h2 id="monitor-title">系统运行概况</h2>
          <p>{overview.system.hostname} · {overview.cpu.cores} 个逻辑核心 · 已运行 {formatUptime(overview.system.uptime)}</p>
        </div>
        <div className={`monitor-live-state${connected ? '' : ' is-stale'}`}>
          <span className="live-pulse" />
          <div>
            <span>{connected ? 'HOST TELEMETRY' : 'STALE TELEMETRY'}</span>
            <strong>{connected ? '实时数据已连接' : '连接中断，显示最近采样'}</strong>
          </div>
        </div>
      </section>

      <section className="monitor-summary" aria-label="核心资源状态">
        <MetricCard
          label="CPU 使用率"
          value={`${Math.round(overview.cpu.usage)}%`}
          detail={`${overview.cpu.cores} 个逻辑核心`}
          percent={overview.cpu.usage}
          icon={Cpu}
          tone="accent"
          status={metricStatus(overview.cpu.usage, 70, 90)}
          secondaryLabel="最近 1 分钟负载"
          secondaryValue={`${Math.round(oneMinuteLoadPercent)}% · ${oneMinuteLoadStatus.label}`}
        />
        <MetricCard
          label="内存占用"
          value={`${Math.round(overview.memory.percent)}%`}
          detail={`${formatBytes(overview.memory.used)} / ${formatBytes(overview.memory.total)}`}
          percent={overview.memory.percent}
          icon={MemoryStick}
          tone="cyan"
          status={metricStatus(overview.memory.percent, 75, 90)}
          secondaryLabel="剩余可用"
          secondaryValue={formatBytes(Math.max(0, overview.memory.total - overview.memory.used))}
        />
        <MetricCard
          label="存储总览"
          value={overview.disks.length ? `${Math.round(storagePercent)}%` : '--'}
          detail={overview.disks.length ? `${overview.disks.length} 个存储空间 · ${formatBytes(storage.used)} / ${formatBytes(storage.total)}` : '未挂载存储卷'}
          percent={storagePercent}
          icon={HardDrive}
          tone="amber"
          status={overview.disks.length ? metricStatus(storagePercent, 80, 92) : '未采集'}
          secondaryLabel="剩余可用"
          secondaryValue={overview.disks.length ? formatBytes(Math.max(0, storage.total - storage.used)) : '不可用'}
          available={overview.disks.length > 0}
        />
        {temperature ? (
          <MetricCard
            label="系统温度"
            value={`${Math.round(temperature.value)}°C`}
            detail={temperature.label}
            percent={temperature.value}
            icon={Thermometer}
            tone="red"
            status={metricStatus(temperature.value, 70, 85)}
            secondaryLabel="传感器"
            secondaryValue={`${overview.temperatures.length} 个可用`}
            meterValueText={`${Math.round(temperature.value)}°C`}
          />
        ) : (
          <MetricCard
            label="系统运行时间"
            value={formatUptime(overview.system.uptime)}
            detail={`${overview.system.platform.toUpperCase()} 主机持续在线`}
            percent={0}
            icon={Clock3}
            tone="cyan"
            status="在线"
            secondaryLabel="容器状态"
            secondaryValue={overview.containersAvailable ? `${runningContainers} / ${overview.containers.length} 运行中` : 'Docker 未连接'}
            showMeter={false}
          />
        )}
      </section>

      <div className="monitor-grid">
        <section className="monitor-panel performance-panel">
          <PanelHeading
            kicker={`PERFORMANCE / ${history.length} ${history.length === 1 ? 'SAMPLE' : 'SAMPLES'}`}
            title="CPU 与内存趋势"
            icon={Activity}
          >
            <div className="monitor-chart-legend" aria-label="图表图例">
              <span><i className="legend-cpu" /> CPU {Math.round(latest?.cpu ?? overview.cpu.usage)}%</span>
              <span><i className="legend-memory" /> 内存 {Math.round(latest?.memory ?? overview.memory.percent)}%</span>
            </div>
          </PanelHeading>
          <div className="monitor-chart-wrap" aria-label="CPU 与内存历史趋势图">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history} margin={{ top: 12, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="monitorCpuFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d7ff43" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#d7ff43" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="monitorMemoryFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#47d9e6" stopOpacity={0.16} />
                    <stop offset="100%" stopColor="#47d9e6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#252c32" strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="time" stroke="#737c7f" tickLine={false} axisLine={false} fontSize={10} minTickGap={36} />
                <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} stroke="#737c7f" tickLine={false} axisLine={false} fontSize={10} tickFormatter={(value) => `${value}%`} />
                <Tooltip
                  contentStyle={{ background: '#11151a', border: '1px solid #3b454e', borderRadius: 4, fontSize: 11 }}
                  labelStyle={{ color: '#b0b8b5' }}
                  formatter={(value: number, name: string) => [`${Math.round(value)}%`, name === 'cpu' ? 'CPU' : '内存']}
                />
                <Area type="monotone" dataKey="memory" stroke="#47d9e6" strokeWidth={2} fill="url(#monitorMemoryFill)" isAnimationActive={false} />
                <Area type="monotone" dataKey="cpu" stroke="#d7ff43" strokeWidth={2} fill="url(#monitorCpuFill)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
            {history.length < 2 && <span className="monitor-chart-waiting">正在积累趋势样本</span>}
          </div>
        </section>

        <section className="monitor-panel host-panel">
          <PanelHeading kicker="HOST / IDENTITY" title="主机与系统负载" icon={Server} />
          <div className="host-identity">
            <span><Server size={20} /></span>
            <div><strong>{overview.system.hostname}</strong><small>{overview.system.platform.toUpperCase()} HOST</small></div>
          </div>
          <div className="host-loads" aria-label="系统平均负载">
            {loadAverage.map((load) => {
              const loadPercent = overview.cpu.cores > 0 ? (load.value / overview.cpu.cores) * 100 : 0;
              const state = loadStatus(loadPercent);
              return (
                <div key={load.label}>
                  <span>{load.label}</span>
                  <strong>{Math.round(loadPercent)}%</strong>
                  <small>负载 {load.value.toFixed(2)} / {overview.cpu.cores} 核</small>
                  <i className={`load-state is-${state.tone}`}>{state.label}</i>
                </div>
              );
            })}
          </div>
          <dl className="monitor-facts">
            <div><dt>逻辑核心</dt><dd>{overview.cpu.cores}</dd></div>
            <div><dt>运行时间</dt><dd>{formatUptime(overview.system.uptime)}</dd></div>
            <div><dt>可见容器</dt><dd>{overview.containersAvailable ? `${overview.containers.length} 个` : '未连接'}</dd></div>
          </dl>
        </section>

        <section className="monitor-panel storage-panel">
          <PanelHeading kicker="STORAGE / FILESYSTEMS" title="存储空间" icon={HardDrive}>
            <span className="storage-total">{overview.disks.length} 个卷 · {formatBytes(storage.total)}</span>
          </PanelHeading>
          {overview.disks.length > 0 ? (
            <div className="storage-list" role="list" aria-label="存储空间">
              {overview.disks.map((disk, index) => (
                <article className="storage-row" role="listitem" key={disk.mount}>
                  <div className="storage-identity">
                    <span><HardDrive size={16} /></span>
                    <div><strong>{diskLabel(disk.mount, index)}</strong><small>{disk.mount}</small></div>
                  </div>
                  <div className="storage-usage">
                    <strong>{Math.round(disk.percent)}%</strong>
                    <span>{formatBytes(disk.used)} / {formatBytes(disk.total)}</span>
                  </div>
                  <Meter value={disk.percent} tone="amber" label={`${diskLabel(disk.mount, index)}使用率`} />
                  <span className="storage-free">可用 {formatBytes(Math.max(0, disk.total - disk.used))}</span>
                </article>
              ))}
            </div>
          ) : (
            <div className="panel-empty">
              <HardDrive size={22} />
              <div><strong>没有可见存储空间</strong><span>请检查容器的只读存储挂载配置。</span></div>
            </div>
          )}
        </section>

        <section className="monitor-panel network-panel">
          <PanelHeading kicker="NETWORK / THROUGHPUT" title="实时网络吞吐" icon={Gauge} />
          <div className="network-rates">
            <div>
              <span className="rate-icon download"><ArrowDownToLine size={17} /></span>
              <div><span>下载速率</span><strong>{formatRate(overview.network.rxBytesPerSecond)}</strong></div>
            </div>
            <div>
              <span className="rate-icon upload"><ArrowUpFromLine size={17} /></span>
              <div><span>上传速率</span><strong>{formatRate(overview.network.txBytesPerSecond)}</strong></div>
            </div>
          </div>
          <div className="network-chart-wrap" aria-label="网络吞吐历史趋势图">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history} margin={{ top: 8, right: 2, left: 2, bottom: 0 }}>
                <Tooltip
                  contentStyle={{ background: '#11151a', border: '1px solid #3b454e', borderRadius: 4, fontSize: 11 }}
                  formatter={(value: number, name: string) => [`${value.toFixed(2)} MiB/s`, name === 'rx' ? '下载' : '上传']}
                />
                <Area type="monotone" dataKey="rx" stroke="#47d9e6" fill="#47d9e619" strokeWidth={2} isAnimationActive={false} />
                <Area type="monotone" dataKey="tx" stroke="#ffba4a" fill="#ffba4a0d" strokeWidth={2} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="network-interfaces">
            <span>活动接口</span>
            <strong>{overview.network.interfaces.length ? overview.network.interfaces.map((item) => item.name).join(' · ') : '未识别'}</strong>
          </div>
        </section>

        <section className="monitor-panel container-panel">
          <PanelHeading kicker="CONTAINERS / DOCKER" title="可见容器" icon={Boxes}>
            {overview.containersAvailable
              ? <span className="container-count"><b>{runningContainers}</b> / {overview.containers.length} 运行中</span>
              : <span className="container-count">数据不可用</span>}
          </PanelHeading>
          {!overview.containersAvailable ? (
            <div className="panel-empty">
              <Boxes size={22} />
              <div><strong>Docker 数据不可用</strong><span>请检查 Docker API 代理或 Socket 配置。</span></div>
            </div>
          ) : overview.containers.length > 0 ? (
            <div className="container-list" role="list" aria-label="Docker 容器">
              {overview.containers.map((container) => {
                const state = containerState(container);
                return (
                  <article className="container-row" key={container.id} role="listitem">
                    <span className="container-icon"><Box size={16} /></span>
                    <div className="container-identity">
                      <strong>{container.name}</strong>
                      <span title={container.image}>{container.image}</span>
                    </div>
                    <span className={`state-badge ${state.className}`}><i />{state.label}</span>
                    <span className="container-status" title={container.status}>{container.status || container.state}</span>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="panel-empty">
              <Boxes size={22} />
              <div><strong>暂无可见容器</strong><span>Docker 数据源已连接，当前未发现容器。</span></div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
