import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  ExternalLink,
  Network,
  RefreshCw,
  X,
} from 'lucide-react';
import { api } from '../api';
import { ServiceAppIcon } from '../components/ServiceAppIcon';
import { getNodeIcon } from '../components/icons';
import { formatBytes, formatRate, formatUptime, statusLabel } from '../lib/format';
import { getServiceUrl } from '../lib/service-url';
import type {
  AppConfig,
  NetworkMode,
  Service,
  ServiceHealth,
  ServiceStatus,
  TopologyNode,
  TopologySnapshot,
} from '../types';

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
  container: 'Docker 应用',
  client: '终端',
  switch: '交换机',
  ap: '无线 AP',
  camera: '摄像头',
  printer: '打印机',
};

function serviceHostname(service?: Service): string | undefined {
  if (!service) return undefined;
  try {
    return new URL(service.url).hostname;
  } catch {
    return undefined;
  }
}

interface TopologyTree {
  node: TopologyNode;
  children: TopologyTree[];
}

function managedFallback(topology: AppConfig['topology'], services: Service[], message?: string): TopologySnapshot {
  const internal = services.filter((service) => service.scope !== 'external');
  const hostCandidates = internal.filter((service) => service.runtime === 'infrastructure' || service.runtime === 'vm');
  const workloads = internal.filter((service) => service.runtime === 'vm' || service.runtime === 'docker');
  const hostCandidateMap = new Map(hostCandidates.map((service) => [service.id, service]));
  const workloadMap = new Map(workloads.map((service) => [service.id, service]));
  const hostConfigs = new Map<string, { service: Service; nodeType: 'server' | 'nas'; serviceIds: string[] }>();
  for (const host of topology.hosts ?? []) {
    const service = hostCandidateMap.get(host.serviceId);
    if (!service || hostConfigs.has(service.id)) continue;
    hostConfigs.set(service.id, { service, nodeType: host.nodeType, serviceIds: host.serviceIds });
  }

  const childrenByHost = new Map([...hostConfigs.keys()].map((id) => [id, [] as string[]]));
  const assignedIds = new Set<string>();
  const createsCycle = (hostId: string, childId: string) => {
    const pending = [childId];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === hostId) return true;
      if (!current || visited.has(current)) continue;
      visited.add(current);
      pending.push(...(childrenByHost.get(current) ?? []));
    }
    return false;
  };
  for (const [hostId, host] of hostConfigs) {
    for (const serviceId of host.serviceIds) {
      if (
        serviceId === hostId
        || !workloadMap.has(serviceId)
        || assignedIds.has(serviceId)
        || createsCycle(hostId, serviceId)
      ) continue;
      assignedIds.add(serviceId);
      childrenByHost.get(hostId)?.push(serviceId);
    }
  }

  const nodes: TopologyNode[] = [
    { id: 'managed-internet', label: 'Internet', type: 'internet', status: 'up', x: 50, y: 7 },
    { id: 'managed-router', label: 'iKuai', type: 'router', status: 'unknown', x: 50, y: 24 },
  ];
  const links: TopologySnapshot['links'] = [
    { source: 'managed-internet', target: 'managed-router', label: 'WAN' },
  ];
  const hostNodeId = (serviceId: string) => `managed-host-${serviceId}`;
  const serviceNodeId = (serviceId: string) => `managed-service-${serviceId}`;

  const addServiceTree = (serviceId: string, parentId: string, depth: number) => {
    const service = workloadMap.get(serviceId);
    if (!service) return;
    const configuredHost = hostConfigs.get(serviceId);
    const nodeId = configuredHost ? hostNodeId(serviceId) : serviceNodeId(serviceId);
    nodes.push({
      id: nodeId,
      label: service.name,
      type: configuredHost ? 'vm' : service.runtime === 'vm' ? 'vm' : 'container',
      serviceId: service.id,
      ipAddress: serviceHostname(service),
      x: 50,
      y: Math.min(92, 49 + depth * 20),
    });
    links.push({ source: parentId, target: nodeId });
    for (const childId of childrenByHost.get(serviceId) ?? []) {
      addServiceTree(childId, nodeId, depth + 1);
    }
  };

  for (const [hostId, host] of hostConfigs) {
    if (assignedIds.has(hostId)) continue;
    const nodeId = hostNodeId(hostId);
    nodes.push({
      id: nodeId,
      label: host.service.name,
      type: host.service.runtime === 'vm' ? 'vm' : host.nodeType,
      serviceId: host.service.id,
      ipAddress: serviceHostname(host.service),
      x: 50,
      y: 49,
    });
    links.push({ source: 'managed-router', target: nodeId, label: 'LAN' });
    for (const childId of childrenByHost.get(hostId) ?? []) addServiceTree(childId, nodeId, 1);
  }

  const configuredHostIds = new Set(hostConfigs.keys());
  for (const runtime of ['vm', 'docker'] as const) {
    const children = workloads.filter((service) => (
      service.runtime === runtime && !assignedIds.has(service.id) && !configuredHostIds.has(service.id)
    ));
    if (children.length === 0) continue;
    const branchId = `managed-unassigned-${runtime}`;
    nodes.push({
      id: branchId,
      label: runtime === 'vm' ? '未分配虚拟机' : '未分配 Docker 应用',
      type: 'server',
      x: 50,
      y: 49,
    });
    links.push({ source: 'managed-router', target: branchId, label: 'LAN' });
    for (const service of children) addServiceTree(service.id, branchId, 1);
  }
  return {
    requestedSource: topology.source,
    source: 'manual',
    status: topology.source === 'ikuai' ? 'fallback' : 'manual',
    message,
    updatedAt: null,
    nodes,
    links,
  };
}

function snapshotTrees(snapshot: TopologySnapshot, routerNode?: TopologyNode): TopologyTree[] {
  const nodeMap = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const childrenById = new Map<string, string[]>();
  for (const link of snapshot.links) {
    if (!nodeMap.has(link.source) || !nodeMap.has(link.target)) continue;
    const children = childrenById.get(link.source) ?? [];
    if (!children.includes(link.target)) children.push(link.target);
    childrenById.set(link.source, children);
  }

  const buildTree = (nodeId: string, ancestors = new Set<string>()): TopologyTree | null => {
    const node = nodeMap.get(nodeId);
    if (!node || ancestors.has(nodeId)) return null;
    const nextAncestors = new Set(ancestors).add(nodeId);
    return {
      node,
      children: (childrenById.get(nodeId) ?? [])
        .map((childId) => buildTree(childId, nextAncestors))
        .filter((child): child is TopologyTree => child !== null),
    };
  };

  const linkedRoots = routerNode ? childrenById.get(routerNode.id) ?? [] : [];
  if (linkedRoots.length > 0) {
    return linkedRoots
      .map((nodeId) => buildTree(nodeId))
      .filter((tree): tree is TopologyTree => tree !== null);
  }

  // Older server snapshots had coordinates but no links.
  const hosts = snapshot.nodes.filter((node) => node.type === 'server' || node.type === 'nas');
  const workloads = snapshot.nodes.filter((node) => node.type === 'vm' || node.type === 'container');
  return hosts.map((host) => {
    const nearestHost = (node: TopologyNode) => hosts.reduce((nearest, candidate) => (
      Math.abs(candidate.x - node.x) < Math.abs(nearest.x - node.x) ? candidate : nearest
    ), hosts[0]);
    return {
      node: host,
      children: workloads
        .filter((node) => nearestHost(node)?.id === host.id)
        .map((node) => ({ node, children: [] })),
    };
  });
}

function nodeStatus(node: TopologyNode, statusMap: Map<string, ServiceHealth>): ServiceStatus {
  if (node.status) return node.status;
  if (!node.serviceId) return node.type === 'internet' || node.type === 'router' ? 'up' : 'unknown';
  return statusMap.get(node.serviceId)?.status || 'unknown';
}

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === '') return null;
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function TopologyNodeButton({
  node,
  service,
  status,
  selected,
  onSelect,
}: {
  node: TopologyNode;
  service?: Service;
  status: ServiceStatus;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = getNodeIcon(node.type);
  return (
    <button
      type="button"
      className={`topology-node topology-tree-node is-${status} ${selected ? 'is-selected' : ''}`}
      onClick={onSelect}
    >
      {service ? <ServiceAppIcon service={service} /> : <span className="node-icon"><Icon size={20} strokeWidth={1.7} /></span>}
      <span className="node-copy">
        <strong>{node.label}</strong>
        <small>{node.ipAddress || node.interface || NODE_TYPE_LABELS[node.type]}</small>
      </span>
      <i className={`status-dot is-${status}`} />
    </button>
  );
}

export function TopologyView({ topology, services, health, networkMode }: TopologyViewProps) {
  const fallback = useMemo(() => managedFallback(topology, services), [services, topology]);
  const [snapshot, setSnapshot] = useState<TopologySnapshot>(fallback);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const activeRequest = useRef(0);
  const statusMap = useMemo(() => new Map(health.map((item) => [item.id, item])), [health]);
  const serviceMap = useMemo(() => new Map(services.map((item) => [item.id, item])), [services]);
  const nodeMap = useMemo(() => new Map(snapshot.nodes.map((item) => [item.id, item])), [snapshot.nodes]);
  const internetNode = snapshot.nodes.find((node) => node.type === 'internet');
  const routerNode = snapshot.nodes.find((node) => node.type === 'router');
  const vmNodes = snapshot.nodes.filter((node) => node.type === 'vm');
  const dockerNodes = snapshot.nodes.filter((node) => node.type === 'container');
  const trees = useMemo(() => snapshotTrees(snapshot, routerNode), [routerNode, snapshot]);
  const selectedNode = selectedId ? nodeMap.get(selectedId) : undefined;
  const selectedService = selectedNode?.serviceId ? serviceMap.get(selectedNode.serviceId) : undefined;
  const selectedServiceUrl = selectedService ? getServiceUrl(selectedService, networkMode) : null;
  const selectedHealth = selectedNode?.serviceId ? statusMap.get(selectedNode.serviceId) : undefined;
  const selectedStatus = selectedNode ? nodeStatus(selectedNode, statusMap) : 'unknown';

  const refreshTopology = useCallback(async (silent = false) => {
    if (topology.source !== 'ikuai') {
      setSnapshot(managedFallback(topology, services));
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
        setSnapshot(managedFallback(
          topology,
          services,
          error instanceof Error
            ? `${error.message}，当前显示已登记服务。`
            : 'iKuai 数据暂时不可用，当前显示已登记服务。',
        ));
      }
    } finally {
      if (activeRequest.current === requestId) setRefreshing(false);
    }
  }, [services, topology]);

  useEffect(() => {
    setSnapshot(fallback);
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
  }, [fallback, refreshTopology, topology]);

  useEffect(() => {
    if (selectedId && !nodeMap.has(selectedId)) setSelectedId(null);
  }, [nodeMap, selectedId]);

  const updatedLabel = snapshot.updatedAt
    ? new Date(snapshot.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })
    : null;

  const renderNode = (node: TopologyNode) => (
    <TopologyNodeButton
      key={node.id}
      node={node}
      service={node.serviceId ? serviceMap.get(node.serviceId) : undefined}
      status={nodeStatus(node, statusMap)}
      selected={selectedId === node.id}
      onSelect={() => setSelectedId(node.id)}
    />
  );

  const descendantCount = (tree: TopologyTree): number => (
    tree.children.reduce((total, child) => total + 1 + descendantCount(child), 0)
  );

  const renderTree = (tree: TopologyTree) => {
    const isContainerGrid = tree.children.length > 0 && tree.children.every((child) => (
      child.node.type === 'container' && child.children.length === 0
    ));
    const containerColumns = tree.children.length === 4 ? 2 : Math.min(tree.children.length, 3);

    return (
      <div className="topology-subtree" key={tree.node.id}>
        {renderNode(tree.node)}
        {tree.children.length > 0 && (
          <div className={`topology-children${isContainerGrid ? ` is-container-grid columns-${containerColumns}` : ''}`}>
            {isContainerGrid && (
              <span className="topology-child-group-label">DOCKER / {tree.children.length} 个应用</span>
            )}
            {tree.children.map(renderTree)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="topology-view">
      <div className="topology-toolbar">
        <div className="topology-summary">
          <span><Network size={16} /></span>
          <div><strong>{vmNodes.length} 台虚拟机</strong><small>{dockerNodes.length} 个 Docker 应用</small></div>
        </div>
        <div className={`topology-source is-${snapshot.status}`}>
          <i className={`status-dot ${snapshot.status === 'live' ? 'is-up' : snapshot.status === 'fallback' ? 'is-down' : 'is-unknown'}`} />
          <div>
            <strong>{snapshot.status === 'live' ? 'iKuai 实时数据' : snapshot.status === 'fallback' ? 'iKuai 暂不可用' : '服务目录拓扑'}</strong>
            <small>{updatedLabel ? `更新于 ${updatedLabel}` : topology.source === 'ikuai' ? '等待 iKuai 数据' : '来自服务中心配置'}</small>
          </div>
        </div>
        {snapshot.status === 'live' && snapshot.stats && (
          <div className="topology-throughput" aria-label="iKuai 实时吞吐">
            <span><ArrowDownToLine size={13} /> {formatRate(snapshot.stats.download)}</span>
            <span><ArrowUpFromLine size={13} /> {formatRate(snapshot.stats.upload)}</span>
            <span>路由在线终端 {snapshot.stats.onlineClients} 台</span>
          </div>
        )}
        <div className="topology-legend">
          <span><i className="status-dot is-up" /> 在线</span>
          <span><i className="status-dot is-down" /> 离线</span>
          <span><i className="status-dot is-unknown" /> 未检测</span>
        </div>
        {topology.source === 'ikuai' && (
          <button className="icon-button topology-refresh" onClick={() => void refreshTopology()} aria-label="刷新拓扑" title="刷新拓扑">
            <RefreshCw className={refreshing ? 'spin' : ''} size={16} />
          </button>
        )}
      </div>

      <div className={`topology-workspace ${selectedNode ? 'has-inspector' : ''} ${snapshot.message ? 'has-notice' : ''}`}>
        <div className="topology-canvas">
          {snapshot.message && (
            <div className="topology-notice" role="status"><AlertTriangle size={15} /><span>{snapshot.message}</span></div>
          )}
          <div className="topology-viewport" aria-label="网络拓扑画布">
            <div className="managed-topology">
              <div className="topology-root-stack">
                {internetNode && renderNode(internetNode)}
                <span className="topology-trunk"><small>WAN</small></span>
                {routerNode && renderNode(routerNode)}
              </div>

              {trees.length > 0 ? (
                <>
                  <div className="topology-fork" aria-hidden="true"><span /></div>
                  <div className="topology-branches">
                    {trees.map((tree) => (
                      <section className="topology-branch" aria-labelledby={`branch-title-${tree.node.id}`} key={tree.node.id}>
                        <div className="topology-branch-heading">
                          <span className="panel-kicker">HOST / 宿主</span>
                          <strong id={`branch-title-${tree.node.id}`}>{tree.node.label} <b>{descendantCount(tree)}</b></strong>
                        </div>
                        {renderTree(tree)}
                      </section>
                    ))}
                  </div>
                </>
              ) : (
                <div className="topology-branch-empty topology-no-hosts">暂无宿主或可展示的工作负载</div>
              )}
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
              {selectedService ? (
                <ServiceAppIcon service={selectedService} />
              ) : (() => { const Icon = getNodeIcon(selectedNode.type); return <span><Icon size={22} /></span>; })()}
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
