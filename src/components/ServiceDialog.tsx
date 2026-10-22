import { useEffect, useMemo, useState } from 'react';
import { Globe2, House, Trash2, X } from 'lucide-react';
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
  externalUrl: '',
  scope: 'internal',
  runtime: 'infrastructure',
  category: '其他',
  icon: 'default',
  iconUrl: '',
  iconAllowInsecureTls: false,
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
      setDraft(service
        ? {
            ...structuredClone(service),
            externalUrl: service.externalUrl || '',
            scope: service.scope || 'internal',
            runtime: service.runtime || 'infrastructure',
            iconUrl: service.iconUrl || '',
          }
        : structuredClone(blankService));
      setError('');
    }
  }, [open, service]);

  const Icon = useMemo(() => getServiceIcon(draft.icon), [draft.icon]);
  const isExternalBookmark = draft.scope === 'external';

  if (!open) return null;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.url.trim()) {
      setError(isExternalBookmark ? '名称和书签地址不能为空。' : '名称和内网地址不能为空。');
      return;
    }
    try {
      const url = new URL(draft.url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    } catch {
      setError(isExternalBookmark
        ? '书签地址必须是完整的 http:// 或 https:// 地址。'
        : '内网地址必须是完整的 http:// 或 https:// 地址。');
      return;
    }
    if (!isExternalBookmark && draft.externalUrl.trim()) {
      try {
        const url = new URL(draft.externalUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      } catch {
        setError('互联网地址必须是完整的 http:// 或 https:// 地址。');
        return;
      }
    }
    if (draft.iconUrl.trim()) {
      try {
        const url = new URL(draft.iconUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      } catch {
        setError('自定义图标地址必须是完整的 http:// 或 https:// 地址。');
        return;
      }
    }

    const checkUrl = !isExternalBookmark && draft.check.type === 'http' ? draft.check.url?.trim() : undefined;

    const next: Service = {
      ...draft,
      id: draft.id || makeId(draft.name),
      name: draft.name.trim(),
      description: draft.description.trim(),
      url: draft.url.trim(),
      externalUrl: isExternalBookmark ? '' : draft.externalUrl.trim(),
      scope: isExternalBookmark ? 'external' : 'internal',
      runtime: isExternalBookmark ? 'infrastructure' : draft.runtime,
      category: draft.category.trim() || '其他',
      iconUrl: draft.iconUrl.trim(),
      iconAllowInsecureTls: isExternalBookmark ? false : draft.iconAllowInsecureTls,
      check: isExternalBookmark
        ? { type: 'none' as const }
        : draft.check.type === 'http'
          ? { type: 'http' as const, ...(checkUrl ? { url: checkUrl } : {}) }
          : draft.check.type === 'tcp'
            ? { type: 'tcp' as const, host: draft.check.host?.trim(), port: Number(draft.check.port) }
            : { type: 'none' as const },
    };
    setError('');
    await onSave(next);
  }

  async function handleDelete() {
    if (!service || !onDelete) return;
    if (window.confirm(`确定删除“${service.name}”吗？`)) {
      await onDelete(service.id);
    }
  }

  function selectScope(scope: Service['scope']) {
    setDraft((current) => scope === 'external'
      ? {
          ...current,
          scope,
          runtime: 'infrastructure',
          externalUrl: '',
          iconAllowInsecureTls: false,
          check: { type: 'none' },
        }
      : { ...current, scope });
    setError('');
  }

  return (
    <div className="dialog-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="service-dialog" role="dialog" aria-modal="true" aria-labelledby="service-dialog-title">
        <div className="dialog-header">
          <div className="dialog-title-wrap">
            <div className="dialog-icon"><Icon size={19} /></div>
            <div>
              <h2 id="service-dialog-title">
                {editing
                  ? isExternalBookmark ? '编辑外网书签' : '编辑内网服务'
                  : '添加入口'}
              </h2>
              <p>{isExternalBookmark ? '管理云服务与互联网链接' : '管理家庭网络中的服务入口'}</p>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <fieldset className="check-fieldset service-scope-fieldset">
            <legend>入口类型</legend>
            <div className="segmented-control service-scope-control">
              <button
                type="button"
                className={!isExternalBookmark ? 'is-active' : ''}
                aria-pressed={!isExternalBookmark}
                onClick={() => selectScope('internal')}
              >
                内网服务
              </button>
              <button
                type="button"
                className={isExternalBookmark ? 'is-active' : ''}
                aria-pressed={isExternalBookmark}
                onClick={() => selectScope('external')}
              >
                外网书签
              </button>
            </div>
          </fieldset>

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
              <span>{isExternalBookmark ? '书签地址' : '内网地址'}</span>
              <div className="input-with-icon">
                {isExternalBookmark ? <Globe2 size={15} /> : <House size={15} />}
                <input
                  value={draft.url}
                  onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                  placeholder={isExternalBookmark ? 'https://www.aliyun.com' : 'https://vault.home.arpa'}
                />
              </div>
            </label>
            {!isExternalBookmark && (
              <label className="field field-span-2">
                <span>互联网地址（可选）</span>
                <div className="input-with-icon">
                  <Globe2 size={15} />
                  <input
                    value={draft.externalUrl}
                    onChange={(event) => setDraft({ ...draft, externalUrl: event.target.value })}
                    placeholder="https://vault.example.com"
                  />
                </div>
              </label>
            )}
            {!isExternalBookmark && (
              <label className="field field-span-2">
                <span>运行环境</span>
                <select
                  value={draft.runtime}
                  onChange={(event) => setDraft({ ...draft, runtime: event.target.value as Service['runtime'] })}
                >
                  <option value="infrastructure">基础设施</option>
                  <option value="vm">ESXi 虚拟机</option>
                  <option value="docker">Synology Docker</option>
                </select>
              </label>
            )}
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
              <span>备用图标</span>
              <select value={draft.icon} onChange={(event) => setDraft({ ...draft, icon: event.target.value })}>
                {serviceIconOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label className="field field-span-2">
              <span>自定义图标地址（可选）</span>
              <div className="input-with-icon">
                <Globe2 size={15} />
                <input
                  value={draft.iconUrl}
                  onChange={(event) => setDraft({ ...draft, iconUrl: event.target.value })}
                  placeholder="https://example.com/favicon.png"
                />
              </div>
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

          {!isExternalBookmark && (
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
                    placeholder={draft.url || '留空时使用内网地址'}
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
          )}

          <div className="service-option-list">
            {!isExternalBookmark && (
              <label className="toggle-row">
                <input
                  type="checkbox"
                  aria-label="允许自签名 HTTPS 图标"
                  checked={draft.iconAllowInsecureTls}
                  onChange={(event) => setDraft({ ...draft, iconAllowInsecureTls: event.target.checked })}
                />
                <span className="toggle-switch" />
                <span>
                  <strong>允许自签名 HTTPS 图标</strong>
                  <small>仅对这个可信内网服务的页面和同源图标跳过证书校验</small>
                </span>
              </label>
            )}

            <label className="toggle-row">
              <input
                type="checkbox"
                checked={draft.favorite}
                onChange={(event) => setDraft({ ...draft, favorite: event.target.checked })}
              />
              <span className="toggle-switch" />
              <span>
                <strong>设为常用</strong>
                <small>{isExternalBookmark ? '书签会优先显示在导航页' : '服务会显示在导航页顶部'}</small>
              </span>
            </label>
          </div>

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
                {saving ? '保存中…' : isExternalBookmark ? '保存书签' : '保存服务'}
              </button>
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
