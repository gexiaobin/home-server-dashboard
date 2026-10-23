import { Bookmark, Clock3, ExternalLink, Globe2, Pencil, Plus, Server, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ServiceAppIcon } from '../components/ServiceAppIcon';
import { statusLabel } from '../lib/format';
import { getServiceHost, getServiceUrl } from '../lib/service-url';
import type { NetworkMode, Service, ServiceHealth, ServiceStatus } from '../types';

interface ServicesViewProps {
  services: Service[];
  health: ServiceHealth[];
  search: string;
  networkMode: NetworkMode;
  onAdd: () => void;
  onEdit: (service: Service) => void;
  onToggleFavorite: (service: Service) => void;
}

type HealthFilter = 'all' | ServiceStatus;

const runtimeLabels: Record<Service['runtime'], string> = {
  infrastructure: '基础设施',
  vm: '虚拟机',
  docker: 'Docker 应用',
};

function formatCheckedAt(checkedAt?: string | null): string {
  if (!checkedAt) return '尚未检测';

  const date = new Date(checkedAt);
  if (Number.isNaN(date.getTime())) return '时间未知';

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function CardControls({
  service,
  onEdit,
  onToggleFavorite,
}: {
  service: Service;
  onEdit: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div className="service-card-controls">
      <button
        className={`icon-button subtle ${service.favorite ? 'is-favorite' : ''}`}
        type="button"
        aria-label={service.favorite ? `取消收藏 ${service.name}` : `收藏 ${service.name}`}
        title={service.favorite ? '取消收藏' : '收藏'}
        onClick={onToggleFavorite}
      >
        <Star size={15} fill={service.favorite ? 'currentColor' : 'none'} />
      </button>
      <button
        className="icon-button subtle"
        type="button"
        aria-label={`编辑 ${service.name}`}
        title={service.scope === 'external' ? '编辑书签' : '编辑服务'}
        onClick={onEdit}
      >
        <Pencil size={15} />
      </button>
    </div>
  );
}

function CardHeader({
  service,
  onEdit,
  onToggleFavorite,
}: {
  service: Service;
  onEdit: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div className="service-card-head">
      <div className="service-identity">
        <ServiceAppIcon service={service} />
        <div className="service-title-group">
          <span className="service-category" title={service.category}>{service.category}</span>
          <h3 title={service.name}>{service.name}</h3>
        </div>
      </div>
      <CardControls service={service} onEdit={onEdit} onToggleFavorite={onToggleFavorite} />
    </div>
  );
}

function OpenLink({ service, url }: { service: Service; url: string | null }) {
  if (url) {
    return (
      <a
        className="open-service"
        href={url}
        target="_blank"
        rel="noreferrer"
        aria-label={`打开 ${service.name}`}
        title={`打开 ${service.name}`}
      >
        <ExternalLink size={15} />
      </a>
    );
  }

  return (
    <button
      className="open-service is-disabled"
      type="button"
      disabled
      aria-label={`${service.name} 未配置互联网地址`}
      title="未配置互联网地址"
    >
      <ExternalLink size={15} />
    </button>
  );
}

function InternalServiceCard({
  service,
  status,
  networkMode,
  onEdit,
  onToggleFavorite,
}: {
  service: Service;
  status?: ServiceHealth;
  networkMode: NetworkMode;
  onEdit: () => void;
  onToggleFavorite: () => void;
}) {
  const currentStatus = status?.status || 'unknown';
  const checkedAt = formatCheckedAt(status?.checkedAt);
  const activeUrl = getServiceUrl(service, networkMode);
  const host = getServiceHost(service, networkMode) || '未配置互联网地址';

  return (
    <article className="service-card service-pod internal-service-card">
      <CardHeader service={service} onEdit={onEdit} onToggleFavorite={onToggleFavorite} />

      <p className="service-description">{service.description || '暂无说明'}</p>

      <dl className="service-meta-list">
        <div>
          <dt>{networkMode === 'internal' ? '内网地址' : '互联网地址'}</dt>
          <dd title={host}>{host}</dd>
        </div>
        <div>
          <dt>运行环境</dt>
          <dd>{runtimeLabels[service.runtime]}</dd>
        </div>
        <div>
          <dt><Clock3 size={12} />最近检测</dt>
          <dd title={status?.checkedAt || undefined}>{checkedAt}</dd>
        </div>
      </dl>

      <div className="service-card-footer">
        <div className={`service-health is-${currentStatus}`} title={status?.message}>
          <span className={`status-dot is-${currentStatus}`} />
          <span>{statusLabel(currentStatus)}</span>
          {status?.latency != null && <span className="latency">{Math.round(status.latency)} ms</span>}
        </div>
        <OpenLink service={service} url={activeUrl} />
      </div>
    </article>
  );
}

function BookmarkCard({
  service,
  networkMode,
  onEdit,
  onToggleFavorite,
}: {
  service: Service;
  networkMode: NetworkMode;
  onEdit: () => void;
  onToggleFavorite: () => void;
}) {
  const url = getServiceUrl(service, networkMode);
  const host = getServiceHost(service, networkMode) || '地址不可用';

  return (
    <article className="service-card service-pod bookmark-card">
      <CardHeader service={service} onEdit={onEdit} onToggleFavorite={onToggleFavorite} />

      <p className="service-description">{service.description || '暂无说明'}</p>

      <dl className="service-meta-list bookmark-meta-list">
        <div>
          <dt><Globe2 size={12} />互联网地址</dt>
          <dd title={host}>{host}</dd>
        </div>
      </dl>

      <div className="service-card-footer">
        <span className="bookmark-scope-label"><Bookmark size={13} />外网书签</span>
        <OpenLink service={service} url={url} />
      </div>
    </article>
  );
}

export function ServicesView({ services, health, search, networkMode, onAdd, onEdit, onToggleFavorite }: ServicesViewProps) {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  const internalServices = services.filter((service) => service.scope !== 'external');
  const externalBookmarks = services.filter((service) => service.scope === 'external');
  const statusById = useMemo(() => new Map(health.map((item) => [item.id, item])), [health]);
  const categories = useMemo(
    () => [...new Set(services.map((service) => service.category))].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [services],
  );
  const activeCategory = selectedCategory === 'all' || categories.includes(selectedCategory)
    ? selectedCategory
    : 'all';
  const normalizedSearch = search.trim().toLocaleLowerCase('zh-CN');

  function matchesCommonFilters(service: Service) {
    const matchesSearch = !normalizedSearch || [
      service.name,
      service.description,
      service.category,
      service.url,
      service.externalUrl,
      service.check.host,
    ].some((value) => value?.toLocaleLowerCase('zh-CN').includes(normalizedSearch));

    return matchesSearch
      && (activeCategory === 'all' || service.category === activeCategory)
      && (!favoritesOnly || service.favorite);
  }

  const filteredInternalServices = internalServices.filter((service) => {
    const serviceStatus = statusById.get(service.id)?.status || 'unknown';
    return matchesCommonFilters(service)
      && (healthFilter === 'all' || serviceStatus === healthFilter);
  });
  const filteredExternalBookmarks = externalBookmarks.filter(matchesCommonFilters);
  const filteredCount = filteredInternalServices.length + filteredExternalBookmarks.length;
  const onlineCount = internalServices.filter((service) => statusById.get(service.id)?.status === 'up').length;
  const hasLocalFilters = activeCategory !== 'all' || healthFilter !== 'all' || favoritesOnly;

  function resetFilters() {
    setSelectedCategory('all');
    setHealthFilter('all');
    setFavoritesOnly(false);
  }

  return (
    <div className="services-view">
      <div className="view-intro services-intro">
        <div>
          <div className="eyebrow">SERVICE DIRECTORY / 服务目录</div>
          <h2>家庭服务控制台</h2>
          <p>
            {internalServices.length} 个内网服务 · {onlineCount} 个在线 · {externalBookmarks.length} 个外网书签 ·{' '}
            {services.filter((service) => service.favorite).length} 个收藏
          </p>
        </div>
        <button className="button button-primary" type="button" onClick={onAdd}>
          <Plus size={16} /> 添加入口
        </button>
      </div>

      <section className="service-directory" aria-labelledby="service-directory-title">
        <div className="service-directory-heading">
          <div>
            <span className="panel-kicker">APPLICATION INDEX</span>
            <h2 id="service-directory-title">服务目录</h2>
          </div>
          <span className="service-result-count">显示 {filteredCount} / {services.length}</span>
        </div>

        <div className="service-filter-bar">
          <div className="category-tabs" role="group" aria-label="按分类筛选">
            <button
              className={activeCategory === 'all' ? 'is-active' : ''}
              type="button"
              aria-pressed={activeCategory === 'all'}
              onClick={() => setSelectedCategory('all')}
            >
              全部 <span>{services.length}</span>
            </button>
            {categories.map((category) => {
              const count = services.filter((service) => service.category === category).length;
              return (
                <button
                  className={activeCategory === category ? 'is-active' : ''}
                  type="button"
                  aria-pressed={activeCategory === category}
                  onClick={() => setSelectedCategory(category)}
                  key={category}
                >
                  {category} <span>{count}</span>
                </button>
              );
            })}
          </div>

          <div className="service-filter-controls">
            <label className="health-filter">
              <span>内网状态</span>
              <select
                aria-label="按内网服务健康状态筛选"
                value={healthFilter}
                onChange={(event) => setHealthFilter(event.target.value as HealthFilter)}
              >
                <option value="all">全部状态</option>
                <option value="up">在线</option>
                <option value="down">离线</option>
                <option value="checking">检测中</option>
                <option value="unknown">未检测</option>
              </select>
            </label>
            <label className={`favorite-filter ${favoritesOnly ? 'is-active' : ''}`}>
              <input
                type="checkbox"
                checked={favoritesOnly}
                onChange={(event) => setFavoritesOnly(event.target.checked)}
              />
              <Star size={14} fill={favoritesOnly ? 'currentColor' : 'none'} />
              <span>仅收藏</span>
            </label>
          </div>
        </div>

        <div className="service-directory-groups">
          <section className="service-catalog-section internal-service-directory" aria-labelledby="internal-service-directory-title">
            <div className="service-directory-heading service-group-heading">
              <div>
                <span className="panel-kicker">LOCAL INFRASTRUCTURE</span>
                <h2 id="internal-service-directory-title">内网服务</h2>
              </div>
              <span className="service-result-count">{filteredInternalServices.length} / {internalServices.length}</span>
            </div>
            {filteredInternalServices.length > 0 ? (
              <div className="service-grid service-directory-grid">
                {filteredInternalServices.map((service) => (
                  <InternalServiceCard
                    key={service.id}
                    service={service}
                    status={statusById.get(service.id)}
                    networkMode={networkMode}
                    onEdit={() => onEdit(service)}
                    onToggleFavorite={() => onToggleFavorite(service)}
                  />
                ))}
              </div>
            ) : (
              <div className="service-group-empty">
                <Server size={20} />
                <span>{internalServices.length === 0 ? '还没有内网服务' : '没有符合条件的内网服务'}</span>
              </div>
            )}
          </section>

          <section className="service-catalog-section external-bookmark-directory" aria-labelledby="external-bookmark-directory-title">
            <div className="service-directory-heading service-group-heading">
              <div>
                <span className="panel-kicker">EXTERNAL BOOKMARKS</span>
                <h2 id="external-bookmark-directory-title">外网书签</h2>
              </div>
              <span className="service-result-count">{filteredExternalBookmarks.length} / {externalBookmarks.length}</span>
            </div>
            {filteredExternalBookmarks.length > 0 ? (
              <div className="service-grid service-directory-grid bookmark-directory-grid">
                {filteredExternalBookmarks.map((service) => (
                  <BookmarkCard
                    key={service.id}
                    service={service}
                    networkMode={networkMode}
                    onEdit={() => onEdit(service)}
                    onToggleFavorite={() => onToggleFavorite(service)}
                  />
                ))}
              </div>
            ) : (
              <div className="service-group-empty bookmark-group-empty">
                <Bookmark size={20} />
                <span>{externalBookmarks.length === 0 ? '还没有外网书签' : '没有符合条件的外网书签'}</span>
              </div>
            )}
          </section>
        </div>

        {filteredCount === 0 && services.length > 0 && hasLocalFilters && (
          <div className="service-filter-empty-action">
            <button className="button button-secondary" type="button" onClick={resetFilters}>重置筛选</button>
          </div>
        )}
      </section>
    </div>
  );
}
