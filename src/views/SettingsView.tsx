import { useEffect, useRef, useState } from 'react';
import { Download, FileJson, Network, Save, ShieldCheck, Upload } from 'lucide-react';
import type { AppConfig } from '../types';

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
  });
  const [importError, setImportError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(config.settings);
    setTopologyDraft({
      source: config.topology.source,
      refreshInterval: config.topology.refreshInterval,
    });
  }, [config.settings, config.topology.source, config.topology.refreshInterval]);

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
      });
      setImportError('');
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '无法读取配置文件');
    } finally {
      event.target.value = '';
    }
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
          <p>选择手工拓扑，或从 iKuai v4 只读 API 获取在线终端与上联关系。</p>
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
              <option value="manual">手工配置</option>
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
          <div className="config-summary settings-field-wide">
            <Network size={22} />
            <div>
              <strong>{topologyDraft.source === 'ikuai' ? 'iKuai API Token' : '手工节点与链路'}</strong>
              <span>{topologyDraft.source === 'ikuai'
                ? '路由器地址与 Token 仅从服务端部署环境读取，不进入配置导出。'
                : `${config.topology.nodes.length} 个节点 · ${config.topology.links.length} 条链路`}</span>
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
