export type ServiceStatus = 'up' | 'down' | 'unknown' | 'checking';
export type NetworkMode = 'internal' | 'external';
export type ServiceScope = 'internal' | 'external';
export type ServiceRuntime = 'infrastructure' | 'vm' | 'docker';

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
  scope: ServiceScope;
  runtime: ServiceRuntime;
  category: string;
  icon: string;
  iconUrl: string;
  iconAllowInsecureTls: boolean;
  favorite: boolean;
  check: ServiceCheck;
}

export interface TopologyNode {
  id: string;
  label: string;
  type: 'internet' | 'router' | 'nas' | 'server' | 'vm' | 'container' | 'client' | 'switch' | 'ap' | 'camera' | 'printer';
  serviceId?: string;
  x: number;
  y: number;
  status?: ServiceStatus;
  ipAddress?: string;
  mac?: string;
  interface?: string;
  uplinkDevice?: string;
  vendor?: string;
  model?: string;
  version?: string;
  clientType?: string;
  upload?: number;
  download?: number;
  totalUp?: number;
  totalDown?: number;
  connectedAt?: string;
  uptimeSeconds?: number;
  cpuUsage?: number;
  memoryUsage?: number;
}

export interface TopologyLink {
  source: string;
  target: string;
  label?: string;
}

export interface TopologyHost {
  serviceId: string;
  nodeType: 'server' | 'nas';
  serviceIds: string[];
}

export interface AppConfig {
  settings: {
    title: string;
    location: string;
    hostDisplayName: string;
    refreshInterval: number;
  };
  services: Service[];
  topology: {
    source: 'manual' | 'ikuai';
    refreshInterval: number;
    hosts: TopologyHost[];
    nodes: TopologyNode[];
    links: TopologyLink[];
  };
}

export interface TopologySnapshot {
  requestedSource: 'manual' | 'ikuai';
  source: 'manual' | 'ikuai';
  status: 'manual' | 'live' | 'fallback';
  message?: string;
  updatedAt: string | null;
  nodes: TopologyNode[];
  links: TopologyLink[];
  stats?: {
    onlineClients: number;
    knownDevices: number;
    linkedInterfaces: number;
    upload: number;
    download: number;
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
    detectedHostname: string;
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
  containersAvailable: boolean;
}

export interface MetricPoint {
  time: string;
  cpu: number;
  memory: number;
  rx: number;
  tx: number;
}
