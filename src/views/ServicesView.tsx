import { Clock3, ExternalLink, Pencil, Plus, Server, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ServiceAppIcon } from '../components/ServiceAppIcon';
import { statusLabel } from '../lib/format';
import type { Service, ServiceHealth, ServiceStatus } from '../types';

interface ServicesViewProps {
  services: Service[];
  health: ServiceHealth[];
  search: string;
  onAdd: () => void;
  onEdit: (service: Service) => void;
  onToggleFavorite: (service: Service) => void;
}

type HealthFilter = 'all' | ServiceStatus;

function getServiceHost(service: Service): string {
  const endpoint = service.url || service.check.url;

  if (endpoint) {
    try {
      return new URL(endpoint).host;
    } catch {
      // Keep checking the structured probe target when the launch URL is relative.
    }
  }

  if (service.check.host) {
    return service.check.port ? `${service.check.host}:${service.check.port}` : service.check.host;
  }

  return endpoint || '--';
}

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

function ServiceCard({
  service,
  status,
  onEdit,
  onToggleFavorite,
}: {
  service: Service;
  status?: ServiceHealth;
  onEdit: () => void;
  onToggleFavorite: () => void;
}) {
  const currentStatus = status?.status || 'unknown';
  const checkedAt = formatCheckedAt(status?.checkedAt);
  const host = getServiceHost(service);

  return (
    <article className="service-card service-pod">
      <div className="service-card-head">
        <div className="service-identity">
          <ServiceAppIcon service={service} />
          <div className="service-title-group">
            <span className="service-category" title={service.category}>{service.category}</span>
            <h3 title={service.name}>{service.name}</h3>
          </div>
        </div>
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
            title="编辑服务"
            onClick={onEdit}
          >
            <Pencil size={15} />
          </button>
        </div>
      </div>

      <p className="service-description">{service.description || '暂无说明'}</p>

      <dl className="service-meta-list">
        <div>
          <dt>主机</dt>
          <dd title={host}>{host}</dd>
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
        <a
          className="open-service"
          href={service.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`打开 ${service.name}`}
          title={`打开 ${service.name}`}
        >
          <ExternalLink size={15} />
        </a>
      </div>
    </article>
  );
}

export function ServicesView({ services, health, search, onAdd, onEdit, onToggleFavorite }: ServicesViewProps) {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  const statusById = useMemo(() => new Map(health.map((item) => [item.id, item])), [health]);
  const categories = useMemo(
    () => [...new Set(services.map((service) => service.category))].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [services],
  );
  const activeCategory = selectedCategory === 'all' || categories.includes(selectedCategory)
    ? selectedCategory
    : 'all';
  const normalizedSearch = search.trim().toLocaleLowerCase('zh-CN');

  const filteredServices = services.filter((service) => {
    const serviceStatus = statusById.get(service.id)?.status || 'unknown';
    const matchesSearch = !normalizedSearch || [
      service.name,
      service.description,
      service.category,
      service.url,
      service.check.host,
    ].some((value) => value?.toLocaleLowerCase('zh-CN').includes(normalizedSearch));

    return matchesSearch
      && (activeCategory === 'all' || service.category === activeCategory)
      && (healthFilter === 'all' || serviceStatus === healthFilter)
      && (!favoritesOnly || service.favorite);
  });

  const onlineCount = services.filter((service) => statusById.get(service.id)?.status === 'up').length;
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
          <p>{services.length} 个服务 · {onlineCount} 个在线 · {services.filter((service) => service.favorite).length} 个收藏</p>
        </div>
        <button className="button button-primary" type="button" onClick={onAdd}>
          <Plus size={16} /> 添加服务
        </button>
      </div>

      <section className="service-directory" aria-labelledby="service-directory-title">
        <div className="service-directory-heading">
          <div>
            <span className="panel-kicker">APPLICATION INDEX</span>
            <h2 id="service-directory-title">服务目录</h2>
          </div>
          <span className="service-result-count">显示 {filteredServices.length} / {services.length}</span>
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
              <span>健康状态</span>
              <select
                aria-label="按健康状态筛选"
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

        {filteredServices.length > 0 ? (
          <div className="service-grid service-directory-grid">
            {filteredServices.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                status={statusById.get(service.id)}
                onEdit={() => onEdit(service)}
                onToggleFavorite={() => onToggleFavorite(service)}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state service-empty-state">
            <div className="empty-icon"><Server size={24} /></div>
            <h2>{services.length === 0 ? '还没有服务' : '没有符合条件的服务'}</h2>
            <p>
              {services.length === 0
                ? '添加第一个家庭服务入口。'
                : search.trim()
                  ? '请调整顶部搜索词或当前筛选条件。'
                  : '请调整分类、健康状态或收藏筛选。'}
            </p>
            {services.length === 0 ? (
              <button className="button button-primary" type="button" onClick={onAdd}>
                <Plus size={16} /> 添加服务
              </button>
            ) : hasLocalFilters ? (
              <button className="button button-secondary" type="button" onClick={resetFilters}>重置筛选</button>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
