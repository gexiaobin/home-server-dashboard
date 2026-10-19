import { useRef, useState } from 'react';
import { Download, FileJson, Save, ShieldCheck, Upload } from 'lucide-react';
import type { AppConfig } from '../types';

interface SettingsViewProps {
  config: AppConfig;
  saving: boolean;
  onSave: (config: AppConfig) => Promise<void>;
}

export function SettingsView({ config, saving, onSave }: SettingsViewProps) {
  const [draft, setDraft] = useState(config.settings);
  const [importError, setImportError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function saveGeneral(event: React.FormEvent) {
    event.preventDefault();
    await onSave({ ...config, settings: { ...draft, refreshInterval: Math.max(3000, Number(draft.refreshInterval)) } });
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
      setDraft(parsed.settings);
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
          <p>自定义标题、位置和监控数据刷新频率。</p>
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
            <span>对外访问时，请同时启用 HTTPS 反向代理，并设置 DASHBOARD_USERNAME 与 DASHBOARD_PASSWORD。</span>
          </div>
        </div>
      </section>
    </div>
  );
}
