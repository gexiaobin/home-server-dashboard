import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Trash2, X } from 'lucide-react';
import type { Service } from '../types';
import { getServiceIcon, serviceIconOptions } from './icons';

interface ServiceDialogProps {
  service: Service | null;
  categories: string[];
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (service: Service) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

const blankService: Service = {
  id: '',
  name: '',
  description: '',
  url: '',
  category: '其他',
  icon: 'default',
  favorite: false,
  check: { type: 'none' },
};

function makeId(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-|-$/g, '') || `service-${Date.now()}`;
}

export function ServiceDialog({ service, categories, open, saving, onClose, onSave, onDelete }: ServiceDialogProps) {
  const [draft, setDraft] = useState<Service>(blankService);
  const [error, setError] = useState('');
  const editing = Boolean(service);

  useEffect(() => {
    if (open) {
      setDraft(service ? structuredClone(service) : structuredClone(blankService));
      setError('');
    }
  }, [open, service]);

  const Icon = useMemo(() => getServiceIcon(draft.icon), [draft.icon]);

  if (!open) return null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.url.trim()) {
      setError('名称和访问地址不能为空。');
      return;
    }
    try {
      const url = new URL(draft.url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    } catch {
      setError('访问地址必须是完整的 http:// 或 https:// 地址。');
      return;
    }

    const next = {
      ...draft,
      id: draft.id || makeId(draft.name),
      name: draft.name.trim(),
      description: draft.description.trim(),
      category: draft.category.trim() || '其他',
      check: draft.check.type === 'http'
        ? { type: 'http' as const, url: draft.check.url?.trim() || draft.url.trim() }
        : draft.check.type === 'tcp'
          ? { type: 'tcp' as const, host: draft.check.host?.trim(), port: Number(draft.check.port) }
          : { type: 'none' as const },
    };
    setError('');
    await onSave(next);
  }

  async function handleDelete() {
    if (!service || !onDelete) return;
    if (window.confirm(`确定删除“${service.name}”吗？拓扑节点不会自动删除。`)) {
      await onDelete(service.id);
    }
  }

  return (
    <div className="dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="service-dialog" role="dialog" aria-modal="true" aria-labelledby="service-dialog-title">
        <div className="dialog-header">
          <div className="dialog-title-wrap">
            <div className="dialog-icon"><Icon size={19} /></div>
            <div>
              <h2 id="service-dialog-title">{editing ? '编辑服务' : '添加服务'}</h2>
              <p>{editing ? '更新入口信息与状态检测方式' : '添加一个新的家庭服务入口'}</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <label className="field field-span-2">
              <span>服务名称</span>
              <input
                autoFocus
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="例如：Vaultwarden"
              />
            </label>
            <label className="field field-span-2">
              <span>访问地址</span>
              <div className="input-with-icon">
                <ExternalLink size={15} />
                <input
                  value={draft.url}
                  onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                  placeholder="https://vault.home.arpa"
                />
              </div>
            </label>
            <label className="field">
              <span>分类</span>
              <input
                list="service-categories"
                value={draft.category}
                onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                placeholder="基础设施"
              />
              <datalist id="service-categories">
                {categories.map((category) => <option key={category} value={category} />)}
              </datalist>
            </label>
            <label className="field">
              <span>图标</span>
              <select value={draft.icon} onChange={(event) => setDraft({ ...draft, icon: event.target.value })}>
                {serviceIconOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="field field-span-2">
              <span>说明</span>
              <input
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                placeholder="一句话说明这个服务的用途"
              />
            </label>
          </div>

          <fieldset className="check-fieldset">
            <legend>状态检测</legend>
            <div className="segmented-control">
              {[
                { value: 'none', label: '不检测' },
                { value: 'http', label: 'HTTP' },
                { value: 'tcp', label: 'TCP' },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={draft.check.type === item.value ? 'is-active' : ''}
                  onClick={() => setDraft({ ...draft, check: { type: item.value as Service['check']['type'] } })}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {draft.check.type === 'http' && (
              <label className="field">
                <span>检测地址</span>
                <input
                  value={draft.check.url || ''}
                  onChange={(event) => setDraft({ ...draft, check: { type: 'http', url: event.target.value } })}
                  placeholder={draft.url || '留空时使用访问地址'}
                />
              </label>
            )}
            {draft.check.type === 'tcp' && (
              <div className="form-grid tcp-grid">
                <label className="field">
                  <span>主机</span>
                  <input
                    value={draft.check.host || ''}
                    onChange={(event) => setDraft({ ...draft, check: { ...draft.check, type: 'tcp', host: event.target.value } })}
                    placeholder="192.168.1.10"
                  />
                </label>
                <label className="field">
                  <span>端口</span>
                  <input
                    type="number"
                    min="1"
                    max="65535"
                    value={draft.check.port || ''}
                    onChange={(event) => setDraft({ ...draft, check: { ...draft.check, type: 'tcp', port: Number(event.target.value) } })}
                    placeholder="443"
                  />
                </label>
              </div>
            )}
          </fieldset>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={draft.favorite}
              onChange={(event) => setDraft({ ...draft, favorite: event.target.checked })}
            />
            <span className="toggle-switch" />
            <span>
              <strong>设为常用</strong>
              <small>服务会显示在导航页顶部</small>
            </span>
          </label>

          {error && <div className="form-error" role="alert">{error}</div>}

          <div className="dialog-footer">
            {editing && onDelete ? (
              <button type="button" className="button button-danger" onClick={handleDelete} disabled={saving}>
                <Trash2 size={16} /> 删除
              </button>
            ) : <span />}
            <div className="dialog-footer-actions">
              <button type="button" className="button button-ghost" onClick={onClose}>取消</button>
              <button type="submit" className="button button-primary" disabled={saving}>
                {saving ? '保存中…' : '保存服务'}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
