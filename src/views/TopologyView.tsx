import { useMemo, useState } from 'react';
import {
  ExternalLink,
  Focus,
  Layers3,
  Minus,
  Network,
  Plus,
  X,
} from 'lucide-react';
import type { AppConfig, Service, ServiceHealth, TopologyNode } from '../types';
import { getNodeIcon } from '../components/icons';
import { statusLabel } from '../lib/format';

interface TopologyViewProps {
  topology: AppConfig['topology'];
  services: Service[];
  health: ServiceHealth[];
}

function nodeStatus(node: TopologyNode, statusMap: Map<string, ServiceHealth>) {
  if (!node.serviceId) return node.type === 'internet' || node.type === 'router' ? 'up' : 'unknown';
  return statusMap.get(node.serviceId)?.status || 'unknown';
}

export function TopologyView({ topology, services, health }: TopologyViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const statusMap = useMemo(() => new Map(health.map((item) => [item.id, item])), [health]);
  const serviceMap = useMemo(() => new Map(services.map((item) => [item.id, item])), [services]);
  const nodeMap = useMemo(() => new Map(topology.nodes.map((item) => [item.id, item])), [topology.nodes]);
  const selectedNode = selectedId ? nodeMap.get(selectedId) : undefined;
  const selectedService = selectedNode?.serviceId ? serviceMap.get(selectedNode.serviceId) : undefined;
  const selectedHealth = selectedNode?.serviceId ? statusMap.get(selectedNode.serviceId) : undefined;

  return (
    <div className="topology-view">
      <div className="topology-toolbar">
        <div className="topology-summary">
          <span><Network size={16} /></span>
          <div><strong>{topology.nodes.length} 个节点</strong><small>{topology.links.length} 条链路</small></div>
        </div>
        <div className="topology-legend">
          <span><i className="status-dot is-up" /> 在线</span>
          <span><i className="status-dot is-down" /> 离线</span>
          <span><i className="status-dot is-unknown" /> 未检测</span>
        </div>
        <div className="zoom-tools">
          <button className="icon-button" onClick={() => setZoom((v) => Math.max(0.8, v - 0.1))} aria-label="缩小" title="缩小"><Minus size={16} /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button className="icon-button" onClick={() => setZoom((v) => Math.min(1.3, v + 0.1))} aria-label="放大" title="放大"><Plus size={16} /></button>
          <button className="icon-button" onClick={() => setZoom(1)} aria-label="适配视图" title="适配视图"><Focus size={16} /></button>
        </div>
      </div>

      <div className={`topology-workspace ${selectedNode ? 'has-inspector' : ''}`}>
        <div className="topology-viewport">
          <div className="topology-grid" style={{ transform: `scale(${zoom})` }}>
            <svg className="topology-links" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true">
              {topology.links.map((link, index) => {
                const source = nodeMap.get(link.source);
                const target = nodeMap.get(link.target);
                if (!source || !target) return null;
                const x1 = source.x * 10;
                const y1 = source.y * 6;
                const x2 = target.x * 10;
                const y2 = target.y * 6;
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
            {topology.nodes.map((node) => {
              const Icon = getNodeIcon(node.type);
              const status = nodeStatus(node, statusMap);
              return (
                <button
                  key={node.id}
                  className={`topology-node is-${status} ${selectedId === node.id ? 'is-selected' : ''}`}
                  style={{ left: `${node.x}%`, top: `${node.y}%` }}
                  onClick={() => setSelectedId(node.id)}
                >
                  <span className="node-icon"><Icon size={20} strokeWidth={1.7} /></span>
                  <span className="node-copy"><strong>{node.label}</strong><small>{node.type.toUpperCase()}</small></span>
                  <i className={`status-dot is-${status}`} />
                </button>
              );
            })}
            {topology.nodes.length === 0 && (
              <div className="topology-empty"><Layers3 size={26} /><strong>拓扑为空</strong><span>从设置页导入包含拓扑节点的配置。</span></div>
            )}
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
              <div><h2>{selectedNode.label}</h2><p>{selectedNode.type.toUpperCase()}</p></div>
            </div>
            <dl className="detail-list compact">
              <div><dt>状态</dt><dd><span className={`status-inline is-${selectedHealth?.status || (selectedNode.serviceId ? 'unknown' : 'up')}`}><i />{statusLabel(selectedHealth?.status || (selectedNode.serviceId ? 'unknown' : 'up'))}</span></dd></div>
              <div><dt>节点 ID</dt><dd>{selectedNode.id}</dd></div>
              {selectedHealth?.latency != null && <div><dt>响应时间</dt><dd>{Math.round(selectedHealth.latency)} ms</dd></div>}
              {selectedHealth?.checkedAt && <div><dt>最近检测</dt><dd>{new Date(selectedHealth.checkedAt).toLocaleTimeString('zh-CN', { hour12: false })}</dd></div>}
            </dl>
            {selectedService && (
              <div className="inspector-service">
                <span>关联服务</span>
                <strong>{selectedService.name}</strong>
                <p>{selectedService.description}</p>
                <a className="button button-secondary" href={selectedService.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={15} /> 打开服务
                </a>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
