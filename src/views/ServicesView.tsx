import { ExternalLink, MoreHorizontal, Plus, Server, Star } from 'lucide-react';
import type { Service, ServiceHealth } from '../types';
import { getServiceIcon } from '../components/icons';
import { statusLabel } from '../lib/format';

interface ServicesViewProps {
  services: Service[];
  health: ServiceHealth[];
  search: string;
  onAdd: () => void;
  onEdit: (service: Service) => void;
  onToggleFavorite: (service: Service) => void;
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
  const Icon = getServiceIcon(service.icon);
  const currentStatus = status?.status || 'unknown';

  return (
    <article className="service-card">
      <div className="service-card-head">
        <div className="service-icon"><Icon size={21} strokeWidth={1.7} /></div>
        <div className="service-card-controls">
          <button
            className={`icon-button subtle ${service.favorite ? 'is-favorite' : ''}`}
            aria-label={service.favorite ? '取消常用' : '设为常用'}
            title={service.favorite ? '取消常用' : '设为常用'}
            onClick={onToggleFavorite}
          >
            <Star size={16} fill={service.favorite ? 'currentColor' : 'none'} />
          </button>
          <button className="icon-button subtle" aria-label="编辑服务" title="编辑服务" onClick={onEdit}>
            <MoreHorizontal size={18} />
          </button>
        </div>
      </div>
      <div className="service-card-body">
        <h3>{service.name}</h3>
        <p>{service.description || '暂无说明'}</p>
      </div>
      <div className="service-card-footer">
        <div className={`service-health is-${currentStatus}`}>
          <span className={`status-dot is-${currentStatus}`} />
          <span>{statusLabel(currentStatus)}</span>
          {status?.latency != null && <span className="latency">{Math.round(status.latency)} ms</span>}
        </div>
        <a className="open-service" href={service.url} target="_blank" rel="noreferrer" aria-label={`打开 ${service.name}`}>
          <ExternalLink size={15} />
        </a>
      </div>
    </article>
  );
}

export function ServicesView({ services, health, search, onAdd, onEdit, onToggleFavorite }: ServicesViewProps) {
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = services.filter((service) => [service.name, service.description, service.category]
    .some((value) => value.toLowerCase().includes(normalizedSearch)));
  const statusById = new Map(health.map((item) => [item.id, item]));
  const favorites = filtered.filter((service) => service.favorite);
  const categories = [...new Set(filtered.map((service) => service.category))];

  if (filtered.length === 0) {
    return (
      <div className="empty-state page-empty-state">
        <div className="empty-icon"><Server size={25} /></div>
        <h2>{services.length === 0 ? '还没有服务' : '没有匹配的服务'}</h2>
        <p>{services.length === 0 ? '添加第一个家庭服务入口。' : '尝试其他关键词，或清空搜索条件。'}</p>
        {services.length === 0 && <button className="button button-primary" onClick={onAdd}><Plus size={16} /> 添加服务</button>}
      </div>
    );
  }

  return (
    <div className="services-view">
      <div className="view-intro">
        <div>
          <div className="eyebrow">SERVICE CATALOG</div>
          <h2>你的家庭服务，一处抵达</h2>
          <p>{services.length} 个服务 · {health.filter((item) => item.status === 'up').length} 个在线</p>
        </div>
        <button className="button button-primary" onClick={onAdd}><Plus size={16} /> 添加服务</button>
      </div>

      {favorites.length > 0 && (
        <section className="service-section">
          <div className="section-heading">
            <div>
              <Star size={15} fill="currentColor" />
              <h2>常用</h2>
            </div>
            <span>{favorites.length}</span>
          </div>
          <div className="service-grid">
            {favorites.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                status={statusById.get(service.id)}
                onEdit={() => onEdit(service)}
                onToggleFavorite={() => onToggleFavorite(service)}
              />
            ))}
          </div>
        </section>
      )}

      {categories.map((category) => {
        const categoryServices = filtered.filter((service) => service.category === category);
        return (
          <section className="service-section" key={category}>
            <div className="section-heading">
              <div><h2>{category}</h2></div>
              <span>{categoryServices.length}</span>
            </div>
            <div className="service-grid">
              {categoryServices.map((service) => (
                <ServiceCard
                  key={service.id}
                  service={service}
                  status={statusById.get(service.id)}
                  onEdit={() => onEdit(service)}
                  onToggleFavorite={() => onToggleFavorite(service)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
