export type ServiceStatus = 'up' | 'down' | 'unknown' | 'checking';
export type NetworkMode = 'internal' | 'external';

export interface ServiceCheck {
  type: 'http' | 'tcp' | 'none';
  url?: string;
  host?: string;
  port?: number;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  url: string;
  externalUrl: string;
  category: string;
  icon: string;
  favorite: boolean;
  check: ServiceCheck;
}

export interface TopologyNode {
  id: string;
  label: string;
  type: 'internet' | 'router' | 'nas' | 'server' | 'vm' | 'container' | 'client';
  serviceId?: string;
  x: number;
  y: number;
}

export interface TopologyLink {
  source: string;
  target: string;
  label?: string;
}

export interface AppConfig {
  settings: {
    title: string;
    location: string;
    refreshInterval: number;
  };
  services: Service[];
  topology: {
    nodes: TopologyNode[];
    links: TopologyLink[];
  };
}

export interface ServiceHealth {
  id: string;
  status: ServiceStatus;
  latency: number | null;
  checkedAt: string | null;
  message?: string;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
}

export interface Overview {
  timestamp: string;
  system: {
    hostname: string;
    platform: string;
    uptime: number;
    loadAverage: number[];
  };
  cpu: { usage: number; cores: number };
  memory: { used: number; total: number; percent: number };
  disks: Array<{ mount: string; used: number; total: number; percent: number }>;
  network: {
    rxBytesPerSecond: number;
    txBytesPerSecond: number;
    interfaces: Array<{ name: string; rxBytes: number; txBytes: number }>;
  };
  temperatures: Array<{ label: string; value: number }>;
  services: ServiceHealth[];
  containers: ContainerInfo[];
}

export interface MetricPoint {
  time: string;
  cpu: number;
  memory: number;
  rx: number;
  tx: number;
}
