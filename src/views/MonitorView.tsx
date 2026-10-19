import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Box,
  Cpu,
  Database,
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
import type { MetricPoint, Overview } from '../types';
import { clampPercent, formatBytes, formatRate, formatUptime } from '../lib/format';

interface MonitorViewProps {
  overview: Overview | null;
  history: MetricPoint[];
}

function Meter({ value, tone = 'green' }: { value: number; tone?: 'green' | 'amber' | 'blue' }) {
  const percent = clampPercent(value);
  return (
    <div className="meter" aria-label={`${Math.round(percent)}%`}>
      <span className={`meter-fill tone-${tone}`} style={{ width: `${percent}%` }} />
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  percent,
  icon: Icon,
  tone = 'green',
}: {
  label: string;
  value: string;
  detail: string;
  percent: number;
  icon: typeof Cpu;
  tone?: 'green' | 'amber' | 'blue';
}) {
  return (
    <article className="metric-card">
      <div className="metric-card-top">
        <span>{label}</span>
        <Icon size={17} />
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-detail">{detail}</div>
      <Meter value={percent} tone={tone} />
    </article>
  );
}

function EmptyMonitor() {
  return (
    <div className="empty-state page-empty-state">
      <div className="empty-icon"><Activity size={25} /></div>
      <h2>正在等待监控数据</h2>
      <p>服务端连接建立后，硬件和网络指标会显示在这里。</p>
    </div>
  );
}

export function MonitorView({ overview, history }: MonitorViewProps) {
  if (!overview) return <EmptyMonitor />;
  const disk = overview.disks[0];
  const temperature = overview.temperatures[0];
  const runningContainers = overview.containers.filter((container) => container.state === 'running').length;

  return (
    <div className="monitor-view">
      <section className="monitor-summary">
        <MetricCard
          label="CPU 使用率"
          value={`${Math.round(overview.cpu.usage)}%`}
          detail={`${overview.cpu.cores} 个逻辑核心`}
          percent={overview.cpu.usage}
          icon={Cpu}
        />
        <MetricCard
          label="内存"
          value={`${Math.round(overview.memory.percent)}%`}
          detail={`${formatBytes(overview.memory.used)} / ${formatBytes(overview.memory.total)}`}
          percent={overview.memory.percent}
          icon={MemoryStick}
          tone="blue"
        />
        <MetricCard
          label="存储"
          value={disk ? `${Math.round(disk.percent)}%` : '--'}
          detail={disk ? `${formatBytes(disk.used)} / ${formatBytes(disk.total)}` : '未挂载存储卷'}
          percent={disk?.percent || 0}
          icon={HardDrive}
          tone="amber"
        />
        <MetricCard
          label="系统温度"
          value={temperature ? `${Math.round(temperature.value)}°C` : '--'}
          detail={temperature?.label || '传感器不可用'}
          percent={temperature ? (temperature.value / 90) * 100 : 0}
          icon={Thermometer}
          tone="amber"
        />
      </section>

      <div className="monitor-grid">
        <section className="panel chart-panel chart-panel-wide">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">PERFORMANCE</span>
              <h2>资源趋势</h2>
            </div>
            <div className="chart-legend">
              <span><i className="legend-cpu" /> CPU</span>
              <span><i className="legend-memory" /> 内存</span>
            </div>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history} margin={{ top: 10, right: 8, left: -24, bottom: 0 }}>
                <defs>
                  <linearGradient id="cpuFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4fd1a5" stopOpacity={0.24} />
                    <stop offset="100%" stopColor="#4fd1a5" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="memoryFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#5b9cf5" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#5b9cf5" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#2b2e31" strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="time" stroke="#73787f" tickLine={false} axisLine={false} fontSize={11} minTickGap={32} />
                <YAxis domain={[0, 100]} stroke="#73787f" tickLine={false} axisLine={false} fontSize={11} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  contentStyle={{ background: '#171a1d', border: '1px solid #34383c', borderRadius: 5, fontSize: 12 }}
                  labelStyle={{ color: '#a8adb3' }}
                  formatter={(value: number, name: string) => [`${Math.round(value)}%`, name === 'cpu' ? 'CPU' : '内存']}
                />
                <Area type="monotone" dataKey="memory" stroke="#5b9cf5" strokeWidth={1.8} fill="url(#memoryFill)" isAnimationActive={false} />
                <Area type="monotone" dataKey="cpu" stroke="#4fd1a5" strokeWidth={1.8} fill="url(#cpuFill)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel host-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">HOST</span>
              <h2>主机信息</h2>
            </div>
            <Server size={18} />
          </div>
          <dl className="detail-list">
            <div><dt>主机名</dt><dd>{overview.system.hostname}</dd></div>
            <div><dt>平台</dt><dd>{overview.system.platform}</dd></div>
            <div><dt>运行时间</dt><dd>{formatUptime(overview.system.uptime)}</dd></div>
            <div><dt>系统负载</dt><dd>{overview.system.loadAverage.map((v) => v.toFixed(2)).join(' · ')}</dd></div>
          </dl>
        </section>

        <section className="panel network-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">NETWORK</span>
              <h2>网络吞吐</h2>
            </div>
            <Gauge size={18} />
          </div>
          <div className="network-rates">
            <div>
              <span className="rate-icon download"><ArrowDownToLine size={17} /></span>
              <div><span>下载</span><strong>{formatRate(overview.network.rxBytesPerSecond)}</strong></div>
            </div>
            <div>
              <span className="rate-icon upload"><ArrowUpFromLine size={17} /></span>
              <div><span>上传</span><strong>{formatRate(overview.network.txBytesPerSecond)}</strong></div>
            </div>
          </div>
          <div className="mini-chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history} margin={{ top: 8, right: 2, left: 2, bottom: 0 }}>
                <Area type="monotone" dataKey="rx" stroke="#5b9cf5" fill="#5b9cf51b" strokeWidth={1.5} isAnimationActive={false} />
                <Area type="monotone" dataKey="tx" stroke="#e0a14b" fill="#e0a14b0f" strokeWidth={1.5} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel container-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">CONTAINERS</span>
              <h2>Docker 容器</h2>
            </div>
            <span className="panel-count">{runningContainers}/{overview.containers.length} 运行中</span>
          </div>
          {overview.containers.length > 0 ? (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead><tr><th>容器</th><th>镜像</th><th>状态</th><th>详情</th></tr></thead>
                <tbody>
                  {overview.containers.map((container) => (
                    <tr key={container.id}>
                      <td><span className="table-primary"><Box size={15} /> {container.name}</span></td>
                      <td className="muted-cell">{container.image}</td>
                      <td><span className={`state-badge is-${container.state === 'running' ? 'running' : 'stopped'}`}><i />{container.state === 'running' ? '运行中' : '已停止'}</span></td>
                      <td className="muted-cell">{container.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="panel-empty">
              <Database size={21} />
              <div><strong>未连接 Docker 数据源</strong><span>按部署文档启用受保护的 Docker API 后即可显示容器。</span></div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
