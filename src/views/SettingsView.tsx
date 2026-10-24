import { useEffect, useRef, useState } from 'react';
import { Download, FileJson, Network, Plus, Save, ShieldCheck, Trash2, Upload } from 'lucide-react';
import type { AppConfig, TopologyHost } from '../types';

interface SettingsViewProps {
  config: AppConfig;
  detectedHostname?: string;
  saving: boolean;
  onSave: (config: AppConfig) => Promise<void>;
}

export function SettingsView({ config, detectedHostname, saving, onSave }: SettingsViewProps) {
  const [draft, setDraft] = useState(config.settings);
  const [topologyDraft, setTopologyDraft] = useState({
    source: config.topology.source,
    refreshInterval: config.topology.refreshInterval,
    hosts: structuredClone(config.topology.hosts ?? []),
  });
  const [importError, setImportError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(config.settings);
    setTopologyDraft({
      source: config.topology.source,
      refreshInterval: config.topology.refreshInterval,
      hosts: structuredClone(config.topology.hosts ?? []),
    });
  }, [
    config.settings,
    config.topology.source,
    config.topology.refreshInterval,
    config.topology.hosts,
  ]);

  async function saveGeneral(event: React.FormEvent) {
    event.preventDefault();
    await onSave({ ...config, settings: { ...draft, refreshInterval: Math.max(3000, Number(draft.refreshInterval)) } });
  }

  async function saveTopology(event: React.FormEvent) {
    event.preventDefault();
    await onSave({
      ...config,
      topology: {
        ...config.topology,
        ...topologyDraft,
      },
    });
  }

  function exportConfig() {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'homelab-config.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importConfig(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as AppConfig;
      if (!parsed.settings || !Array.isArray(parsed.services) || !parsed.topology?.nodes || !parsed.topology?.links) {
        throw new Error('配置结构不完整');
      }
      await onSave(parsed);
      setDraft({
        ...config.settings,
        ...parsed.settings,
        hostDisplayName: parsed.settings.hostDisplayName || '',
      });
      setTopologyDraft({
        source: parsed.topology.source || 'manual',
        refreshInterval: parsed.topology.refreshInterval || 15_000,
        hosts: Array.isArray(parsed.topology.hosts) ? structuredClone(parsed.topology.hosts) : [],
      });
      setImportError('');
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '无法读取配置文件');
    } finally {
      event.target.value = '';
    }
  }

  const hostServices = config.services.filter((service) => (
    service.scope === 'internal' && (service.runtime === 'infrastructure' || service.runtime === 'vm')
  ));
  const workloadServices = config.services.filter((service) => (
    service.scope === 'internal' && (service.runtime === 'vm' || service.runtime === 'docker')
  ));
  const selectedHostServiceIds = new Set(topologyDraft.hosts.map((host) => host.serviceId));
  const availableHostServices = hostServices.filter((service) => !selectedHostServiceIds.has(service.id));
  const assignedServiceIds = new Set(topologyDraft.hosts.flatMap((host) => host.serviceIds));
  const unassignedWorkloadCount = workloadServices.filter((service) => (
    !assignedServiceIds.has(service.id) && !selectedHostServiceIds.has(service.id)
  )).length;

  function createsCycle(hostServiceId: string, childServiceId: string) {
    const childrenByHost = new Map(topologyDraft.hosts.map((host) => [
      host.serviceId,
      host.serviceIds.filter((id) => id !== childServiceId),
    ]));
    const pending = [childServiceId];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === hostServiceId) return true;
      if (!current || visited.has(current)) continue;
      visited.add(current);
      pending.push(...(childrenByHost.get(current) ?? []));
    }
    return false;
  }

  function addHost() {
    const service = availableHostServices[0];
    if (!service) return;
    setTopologyDraft({
      ...topologyDraft,
      hosts: [...topologyDraft.hosts, { serviceId: service.id, nodeType: 'server', serviceIds: [] }],
    });
  }

  function updateHost(index: number, patch: Partial<TopologyHost>) {
    setTopologyDraft({
      ...topologyDraft,
      hosts: topologyDraft.hosts.map((host, hostIndex) => (
        hostIndex === index
          ? {
              ...host,
              ...patch,
              serviceIds: patch.serviceId
                ? host.serviceIds.filter((id) => id !== patch.serviceId)
                : host.serviceIds,
            }
          : host
      )),
    });
  }

  function removeHost(index: number) {
    setTopologyDraft({
      ...topologyDraft,
      hosts: topologyDraft.hosts.filter((_, hostIndex) => hostIndex !== index),
    });
  }

  function assignService(hostIndex: number, serviceId: string, checked: boolean) {
    setTopologyDraft({
      ...topologyDraft,
      hosts: topologyDraft.hosts.map((host, index) => ({
        ...host,
        serviceIds: checked
          ? index === hostIndex
            ? [...host.serviceIds.filter((id) => id !== serviceId), serviceId]
            : host.serviceIds.filter((id) => id !== serviceId)
          : index === hostIndex
            ? host.serviceIds.filter((id) => id !== serviceId)
            : host.serviceIds,
      })),
    });
  }

  return (
    <div className="settings-view">
      <section className="settings-section">
        <div className="settings-section-copy">
          <span className="panel-kicker">WORKSPACE</span>
          <h2>工作区</h2>
          <p>自定义标题、位置、主机名称和监控数据刷新频率。</p>
        </div>
        <form className="settings-form" onSubmit={saveGeneral}>
          <label className="field">
            <span>工作区名称</span>
            <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          </label>
          <label className="field">
            <span>位置</span>
            <input value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} />
          </label>
          <label className="field settings-field-wide">
            <span>主机显示名称</span>
            <input
              value={draft.hostDisplayName}
              aria-label="主机显示名称"
              maxLength={100}
              placeholder={detectedHostname || '例如 Synology DS920+'}
              onChange={(event) => setDraft({ ...draft, hostDisplayName: event.target.value })}
            />
            <small>留空时显示系统自动探测到的主机名；该设置会随配置导入、导出和备份。</small>
          </label>
          <label className="field">
            <span>刷新间隔</span>
            <select value={draft.refreshInterval} onChange={(event) => setDraft({ ...draft, refreshInterval: Number(event.target.value) })}>
              <option value={3000}>3 秒</option>
              <option value={5000}>5 秒</option>
              <option value={10000}>10 秒</option>
              <option value={30000}>30 秒</option>
            </select>
          </label>
          <button className="button button-primary settings-save" type="submit" disabled={saving}><Save size={16} /> {saving ? '保存中…' : '保存设置'}</button>
        </form>
      </section>

      <section className="settings-section">
        <div className="settings-section-copy">
          <span className="panel-kicker">NETWORK MAP</span>
          <h2>拓扑数据源</h2>
          <p>配置实时数据源，并按实际环境建立虚拟化平台、虚拟机宿主与 Docker 应用的多级关系。</p>
        </div>
        <form className="settings-form" onSubmit={saveTopology}>
          <label className="field">
            <span>数据源</span>
            <select
              aria-label="拓扑数据源"
              value={topologyDraft.source}
              onChange={(event) => setTopologyDraft({
                ...topologyDraft,
                source: event.target.value as AppConfig['topology']['source'],
              })}
            >
              <option value="manual">服务目录（无 iKuai）</option>
              <option value="ikuai">iKuai v4 API</option>
            </select>
          </label>
          <label className="field">
            <span>刷新间隔</span>
            <select
              aria-label="拓扑刷新间隔"
              value={topologyDraft.refreshInterval}
              disabled={topologyDraft.source !== 'ikuai'}
              onChange={(event) => setTopologyDraft({
                ...topologyDraft,
                refreshInterval: Number(event.target.value),
              })}
            >
              <option value={10_000}>10 秒</option>
              <option value={15_000}>15 秒</option>
              <option value={30_000}>30 秒</option>
              <option value={60_000}>1 分钟</option>
            </select>
          </label>
          <div className="topology-host-manager settings-field-wide">
            <div className="topology-host-manager-header">
              <div>
                <strong>宿主与工作负载层级</strong>
                <span>{topologyDraft.hosts.length} 个宿主 · {unassignedWorkloadCount} 个服务未分配</span>
              </div>
              <button
                className="button button-secondary"
                type="button"
                disabled={availableHostServices.length === 0}
                onClick={addHost}
              >
                <Plus size={15} /> 添加宿主
              </button>
            </div>
            {topologyDraft.hosts.length === 0 ? (
              <div className="topology-host-empty">
                {hostServices.length > 0
                  ? '尚未配置宿主。未分配的虚拟机和 Docker 应用仍会显示在通用分支中。'
                  : '请先在服务中心添加运行环境为“基础设施”或“虚拟机”的内网服务。'}
              </div>
            ) : (
              <div className="topology-host-list">
                {topologyDraft.hosts.map((host, index) => {
                  const selectedService = hostServices.find((service) => service.id === host.serviceId);
                  const parentHost = topologyDraft.hosts.find((candidate) => candidate.serviceIds.includes(host.serviceId));
                  const parentService = parentHost
                    ? hostServices.find((service) => service.id === parentHost.serviceId)
                    : undefined;
                  return (
                    <fieldset className="topology-host-editor" key={host.serviceId}>
                      <legend>宿主 {index + 1}{parentService ? ` · ${parentService.name} 下级` : ' · 根级'}</legend>
                      <div className="topology-host-fields">
                        <label className="field">
                          <span>关联服务</span>
                          <select
                            aria-label={`宿主 ${index + 1} 关联服务`}
                            value={host.serviceId}
                            onChange={(event) => updateHost(index, { serviceId: event.target.value })}
                          >
                            {hostServices.map((service) => (
                              <option
                                key={service.id}
                                value={service.id}
                                disabled={service.id !== host.serviceId && selectedHostServiceIds.has(service.id)}
                              >
                                {service.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span>节点样式</span>
                          {selectedService?.runtime === 'vm' ? (
                            <select aria-label={`宿主 ${index + 1} 节点样式`} value="vm" disabled>
                              <option value="vm">虚拟机（自动）</option>
                            </select>
                          ) : (
                            <select
                              aria-label={`宿主 ${index + 1} 节点样式`}
                              value={host.nodeType}
                              onChange={(event) => updateHost(index, { nodeType: event.target.value as TopologyHost['nodeType'] })}
                            >
                              <option value="server">服务器</option>
                              <option value="nas">NAS</option>
                            </select>
                          )}
                        </label>
                        <button
                          className="icon-button subtle topology-host-remove"
                          type="button"
                          aria-label={`删除宿主 ${selectedService?.name || index + 1}`}
                          title="删除宿主"
                          onClick={() => removeHost(index)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                      <div className="topology-workload-picker">
                        <span>承载服务</span>
                        {workloadServices.length > 0 ? (
                          <div className="topology-workload-grid">
                            {workloadServices.map((service) => {
                              const checked = host.serviceIds.includes(service.id);
                              const cycle = service.id === host.serviceId || createsCycle(host.serviceId, service.id);
                              const isNestedHost = selectedHostServiceIds.has(service.id);
                              return (
                              <label key={service.id} className={cycle && !checked ? 'is-disabled' : ''}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={cycle && !checked}
                                  onChange={(event) => assignService(index, service.id, event.target.checked)}
                                />
                                <span>{service.name}<small>{service.runtime === 'vm' ? (isNestedHost ? '虚拟机 · 下级宿主' : '虚拟机') : 'Docker 应用'}</small></span>
                              </label>
                              );
                            })}
                          </div>
                        ) : (
                          <small>服务中心暂无虚拟机或 Docker 应用。</small>
                        )}
                      </div>
                    </fieldset>
                  );
                })}
              </div>
            )}
          </div>
          <div className="config-summary settings-field-wide">
            <Network size={22} />
            <div>
              <strong>{topologyDraft.source === 'ikuai' ? 'iKuai API Token' : '服务目录拓扑'}</strong>
              <span>{topologyDraft.source === 'ikuai'
                ? '路由器地址与 Token 仅从服务端部署环境读取，不进入配置导出。'
                : '拓扑节点由宿主关联与服务分配自动生成。'}</span>
            </div>
          </div>
          <button className="button button-primary settings-save" type="submit" disabled={saving}>
            <Save size={16} /> {saving ? '保存中…' : '保存拓扑设置'}
          </button>
        </form>
      </section>

      <section className="settings-section">
        <div className="settings-section-copy">
          <span className="panel-kicker">DATA</span>
          <h2>配置数据</h2>
          <p>导出备份，或一次性导入服务与拓扑配置。</p>
        </div>
        <div className="settings-form">
          <div className="config-summary">
            <FileJson size={22} />
            <div><strong>当前配置</strong><span>{config.services.length} 个服务 · {config.topology.nodes.length} 个拓扑节点</span></div>
          </div>
          <div className="button-row">
            <button className="button button-secondary" onClick={exportConfig}><Download size={16} /> 导出 JSON</button>
            <button className="button button-secondary" onClick={() => fileRef.current?.click()}><Upload size={16} /> 导入 JSON</button>
            <input ref={fileRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={importConfig} />
          </div>
          {importError && <div className="form-error">{importError}</div>}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-copy">
          <span className="panel-kicker">SECURITY</span>
          <h2>访问保护</h2>
          <p>身份验证由部署环境变量控制，不会写入浏览器配置。</p>
        </div>
        <div className="security-note">
          <ShieldCheck size={22} />
          <div>
            <strong>建议仅在可信网络或 VPN 内使用</strong>
            <span>对外访问时，请同时启用 HTTPS 反向代理，并设置 BASIC_AUTH_USERNAME 与 BASIC_AUTH_PASSWORD。</span>
          </div>
        </div>
      </section>
    </div>
  );
}
