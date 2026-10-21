import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  ExternalLink,
  Focus,
  Layers3,
  Minus,
  Network,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { api } from '../api';
import type {
  AppConfig,
  NetworkMode,
  Service,
  ServiceHealth,
  TopologyNode,
  TopologySnapshot,
} from '../types';
import { getNodeIcon } from '../components/icons';
import { formatBytes, formatRate, formatUptime, statusLabel } from '../lib/format';
import { getServiceUrl } from '../lib/service-url';

interface TopologyViewProps {
  topology: AppConfig['topology'];
  services: Service[];
  health: ServiceHealth[];
  networkMode: NetworkMode;
}

const NODE_TYPE_LABELS: Record<TopologyNode['type'], string> = {
  internet: '互联网',
  router: '路由器',
  nas: 'NAS',
  server: '服务器',
  vm: '虚拟机',
  container: '容器',
  client: '终端',
  switch: '交换机',
  ap: '无线 AP',
  camera: '摄像头',
  printer: '打印机',
};

function manualSnapshot(topology: AppConfig['topology'], message?: string): TopologySnapshot {
  return {
    requestedSource: topology.source,
    source: 'manual',
    status: topology.source === 'ikuai' ? 'fallback' : 'manual',
    message,
    updatedAt: null,
    nodes: topology.nodes,
    links: topology.links,
  };
}

function nodeStatus(node: TopologyNode, statusMap: Map<string, ServiceHealth>) {
  if (node.status) return node.status;
  if (!node.serviceId) return node.type === 'internet' || node.type === 'router' ? 'up' : 'unknown';
  return statusMap.get(node.serviceId)?.status || 'unknown';
}

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === '') return null;
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

export function TopologyView({ topology, services, health, networkMode }: TopologyViewProps) {
  const [snapshot, setSnapshot] = useState<TopologySnapshot>(() => manualSnapshot(topology));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const activeRequest = useRef(0);
  const statusMap = useMemo(() => new Map(health.map((item) => [item.id, item])), [health]);
  const serviceMap = useMemo(() => new Map(services.map((item) => [item.id, item])), [services]);
  const nodeMap = useMemo(() => new Map(snapshot.nodes.map((item) => [item.id, item])), [snapshot.nodes]);
  const selectedNode = selectedId ? nodeMap.get(selectedId) : undefined;
  const selectedService = selectedNode?.serviceId ? serviceMap.get(selectedNode.serviceId) : undefined;
  const selectedServiceUrl = selectedService ? getServiceUrl(selectedService, networkMode) : null;
  const selectedHealth = selectedNode?.serviceId ? statusMap.get(selectedNode.serviceId) : undefined;
  const selectedStatus = selectedNode ? nodeStatus(selectedNode, statusMap) : 'unknown';

  const canvas = useMemo(() => {
    const layerCounts = new Map<number, number>();
    for (const node of snapshot.nodes) {
      const layer = Math.round(node.y / 5) * 5;
      layerCounts.set(layer, (layerCounts.get(layer) || 0) + 1);
    }
    const widestLayer = Math.max(1, ...layerCounts.values());
    return {
      width: Math.max(1_000, widestLayer * 170 + 140),
      height: 660,
    };
  }, [snapshot.nodes]);

  const centerView = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    window.requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2);
      viewport.scrollTop = 0;
    });
  }, []);

  const refreshTopology = useCallback(async (silent = false) => {
    if (topology.source !== 'ikuai') {
      setSnapshot(manualSnapshot(topology));
      return;
    }
    const requestId = activeRequest.current + 1;
    activeRequest.current = requestId;
    if (!silent) setRefreshing(true);
    try {
      const next = await api.getTopology();
      if (activeRequest.current === requestId) setSnapshot(next);
    } catch (error) {
      if (activeRequest.current === requestId) {
        setSnapshot(manualSnapshot(
          topology,
          error instanceof Error
            ? `${error.message}，当前显示手工拓扑。`
            : 'iKuai 数据暂时不可用，当前显示手工拓扑。',
        ));
      }
    } finally {
      if (!silent && activeRequest.current === requestId) setRefreshing(false);
    }
  }, [topology]);

  useEffect(() => {
    setSnapshot(manualSnapshot(topology));
    void refreshTopology(true);
    if (topology.source !== 'ikuai') return undefined;
    const timer = window.setInterval(
      () => void refreshTopology(true),
      Math.max(5_000, topology.refreshInterval),
    );
    return () => {
      window.clearInterval(timer);
      activeRequest.current += 1;
    };
  }, [refreshTopology, topology]);

  useEffect(() => {
    if (selectedId && !nodeMap.has(selectedId)) setSelectedId(null);
  }, [nodeMap, selectedId]);

  useEffect(() => {
    centerView();
  }, [canvas.width, centerView, snapshot.source]);

  const updatedLabel = snapshot.updatedAt
    ? new Date(snapshot.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })
    : null;

  return (
    <div className="topology-view">
      <div className="topology-toolbar">
        <div className="topology-summary">
          <span><Network size={16} /></span>
          <div><strong>{snapshot.nodes.length} 个节点</strong><small>{snapshot.links.length} 条链路</small></div>
        </div>
        <div className={`topology-source is-${snapshot.status}`}>
          <i className={`status-dot ${snapshot.status === 'live' ? 'is-up' : snapshot.status === 'fallback' ? 'is-down' : 'is-unknown'}`} />
          <div>
            <strong>{snapshot.status === 'live' ? 'iKuai 实时拓扑' : snapshot.status === 'fallback' ? '手工拓扑回退' : '手工拓扑'}</strong>
            <small>{updatedLabel ? `更新于 ${updatedLabel}` : topology.source === 'ikuai' ? '等待 iKuai 数据' : '来自项目配置'}</small>
          </div>
        </div>
        {snapshot.status === 'live' && snapshot.stats && (
          <div className="topology-throughput" aria-label="iKuai 实时吞吐">
            <span><ArrowDownToLine size={13} /> {formatRate(snapshot.stats.download)}</span>
            <span><ArrowUpFromLine size={13} /> {formatRate(snapshot.stats.upload)}</span>
            <span>{snapshot.stats.onlineClients} 台在线</span>
          </div>
        )}
        <div className="topology-legend">
          <span><i className="status-dot is-up" /> 在线</span>
          <span><i className="status-dot is-down" /> 离线</span>
          <span><i className="status-dot is-unknown" /> 未检测</span>
        </div>
        <div className="zoom-tools">
          {topology.source === 'ikuai' && (
            <button className="icon-button" onClick={() => void refreshTopology()} aria-label="刷新拓扑" title="刷新拓扑">
              <RefreshCw className={refreshing ? 'spin' : ''} size={16} />
            </button>
          )}
          <button className="icon-button" onClick={() => setZoom((value) => Math.max(0.55, value - 0.1))} aria-label="缩小" title="缩小"><Minus size={16} /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button className="icon-button" onClick={() => setZoom((value) => Math.min(1.4, value + 0.1))} aria-label="放大" title="放大"><Plus size={16} /></button>
          <button className="icon-button" onClick={centerView} aria-label="居中视图" title="居中视图"><Focus size={16} /></button>
        </div>
      </div>

      <div className={`topology-workspace ${selectedNode ? 'has-inspector' : ''} ${snapshot.message ? 'has-notice' : ''}`}>
        <div className="topology-canvas">
          {snapshot.message && (
            <div className="topology-notice" role="status"><AlertTriangle size={15} /><span>{snapshot.message}</span></div>
          )}
          <div className="topology-viewport" ref={viewportRef} aria-label="网络拓扑画布">
            <div
              className="topology-stage"
              style={{ width: canvas.width * zoom, height: canvas.height * zoom }}
            >
              <div
                className="topology-grid"
                style={{
                  width: canvas.width,
                  height: canvas.height,
                  transform: `scale(${zoom})`,
                }}
              >
                <svg
                  className="topology-links"
                  viewBox={`0 0 ${canvas.width} ${canvas.height}`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  {snapshot.links.map((link, index) => {
                    const source = nodeMap.get(link.source);
                    const target = nodeMap.get(link.target);
                    if (!source || !target) return null;
                    const x1 = (source.x / 100) * canvas.width;
                    const y1 = (source.y / 100) * canvas.height;
                    const x2 = (target.x / 100) * canvas.width;
                    const y2 = (target.y / 100) * canvas.height;
                    return (
                      <g key={`${link.source}-${link.target}-${index}`}>
                        <line x1={x1} y1={y1} x2={x2} y2={y2} />
                        {link.label && (
                          <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 7}>{link.label}</text>
                        )}
                      </g>
                    );
                  })}
                </svg>
                {snapshot.nodes.map((node) => {
                  const Icon = getNodeIcon(node.type);
                  const status = nodeStatus(node, statusMap);
                  return (
                    <button
                      key={node.id}
                      className={`topology-node is-${status} ${selectedId === node.id ? 'is-selected' : ''}`}
                      style={{
                        left: `${(node.x / 100) * canvas.width}px`,
                        top: `${(node.y / 100) * canvas.height}px`,
                      }}
                      onClick={() => setSelectedId(node.id)}
                    >
                      <span className="node-icon"><Icon size={20} strokeWidth={1.7} /></span>
                      <span className="node-copy">
                        <strong>{node.label}</strong>
                        <small>{node.ipAddress || node.interface || NODE_TYPE_LABELS[node.type]}</small>
                      </span>
                      <i className={`status-dot is-${status}`} />
                    </button>
                  );
                })}
                {snapshot.nodes.length === 0 && (
                  <div className="topology-empty"><Layers3 size={26} /><strong>拓扑为空</strong><span>在系统设置中选择数据源，或导入包含拓扑节点的配置。</span></div>
                )}
              </div>
            </div>
          </div>
        </div>

        {selectedNode && (
          <aside className="node-inspector">
            <div className="inspector-header">
              <span>节点详情</span>
              <button className="icon-button" onClick={() => setSelectedId(null)} aria-label="关闭详情"><X size={17} /></button>
            </div>
            <div className="inspector-identity">
              {(() => { const Icon = getNodeIcon(selectedNode.type); return <span><Icon size={22} /></span>; })()}
              <div><h2>{selectedNode.label}</h2><p>{NODE_TYPE_LABELS[selectedNode.type]}</p></div>
            </div>
            <dl className="detail-list compact">
              <div><dt>状态</dt><dd><span className={`status-inline is-${selectedStatus}`}><i />{statusLabel(selectedStatus)}</span></dd></div>
              <DetailRow label="IP 地址" value={selectedNode.ipAddress} />
              <DetailRow label="MAC 地址" value={selectedNode.mac} />
              <DetailRow label="接入接口" value={selectedNode.interface} />
              <DetailRow label="上联设备" value={selectedNode.uplinkDevice} />
              <DetailRow label="厂商" value={selectedNode.vendor} />
              <DetailRow label="型号" value={selectedNode.model} />
              <DetailRow label="系统版本" value={selectedNode.version} />
              <DetailRow label="终端类型" value={selectedNode.clientType} />
              {selectedNode.download !== undefined && <DetailRow label="下载速率" value={formatRate(selectedNode.download)} />}
              {selectedNode.upload !== undefined && <DetailRow label="上传速率" value={formatRate(selectedNode.upload)} />}
              {selectedNode.totalDown !== undefined && <DetailRow label="累计下载" value={formatBytes(selectedNode.totalDown)} />}
              {selectedNode.totalUp !== undefined && <DetailRow label="累计上传" value={formatBytes(selectedNode.totalUp)} />}
              <DetailRow label="上线时间" value={selectedNode.connectedAt} />
              {selectedNode.uptimeSeconds !== undefined && <DetailRow label="运行时间" value={formatUptime(selectedNode.uptimeSeconds)} />}
              {selectedNode.cpuUsage !== undefined && <DetailRow label="CPU" value={`${Math.round(selectedNode.cpuUsage)}%`} />}
              {selectedNode.memoryUsage !== undefined && <DetailRow label="内存" value={`${Math.round(selectedNode.memoryUsage)}%`} />}
              {selectedHealth?.latency != null && <DetailRow label="响应时间" value={`${Math.round(selectedHealth.latency)} ms`} />}
              {selectedHealth?.checkedAt && <DetailRow label="最近检测" value={new Date(selectedHealth.checkedAt).toLocaleTimeString('zh-CN', { hour12: false })} />}
            </dl>
            {selectedService && (
              <div className="inspector-service">
                <span>关联服务</span>
                <strong>{selectedService.name}</strong>
                <p>{selectedService.description}</p>
                {selectedServiceUrl ? (
                  <a className="button button-secondary" href={selectedServiceUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={15} /> 打开服务
                  </a>
                ) : (
                  <button className="button button-secondary" type="button" disabled title="未配置互联网地址">
                    <ExternalLink size={15} /> 未配置互联网地址
                  </button>
                )}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
