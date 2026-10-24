import { describe, expect, it } from 'vitest';

import { projectServiceTopology } from './service-topology.mjs';

const services = [
  { id: 'proxmox-a', name: 'Proxmox A', url: 'https://192.0.2.10:8006', scope: 'internal', runtime: 'infrastructure' },
  { id: 'docker-b', name: 'Docker Host B', url: 'https://node-b.home.arpa', scope: 'internal', runtime: 'infrastructure' },
  { id: 'edge-c', name: 'Edge Host C', url: 'https://192.0.2.30', scope: 'internal', runtime: 'infrastructure' },
  { id: 'vm-a', name: 'VM A', url: 'http://192.0.2.11', scope: 'internal', runtime: 'vm' },
  { id: 'vm-b', name: 'VM B', url: 'http://192.0.2.12', scope: 'internal', runtime: 'vm' },
  { id: 'app-a', name: 'App A', url: 'http://192.0.2.21', scope: 'internal', runtime: 'docker' },
  { id: 'app-b', name: 'App B', url: 'http://192.0.2.22', scope: 'internal', runtime: 'docker' },
  { id: 'cloud', name: 'Cloud console', url: 'https://console.example.com', scope: 'external', runtime: 'infrastructure' },
];

const topology = {
  hosts: [
    { serviceId: 'proxmox-a', nodeType: 'server', serviceIds: ['vm-a', 'app-a'] },
    { serviceId: 'docker-b', nodeType: 'nas', serviceIds: ['vm-b'] },
  ],
};

describe('projectServiceTopology', () => {
  it('projects any number of configured hosts and preserves router telemetry', () => {
    const stats = { onlineClients: 16, knownDevices: 20, linkedInterfaces: 3, upload: 1_024, download: 2_048 };
    const result = projectServiceTopology({
      services,
      topology: {
        hosts: [
          ...topology.hosts,
          { serviceId: 'edge-c', nodeType: 'server', serviceIds: [] },
        ],
      },
      snapshot: {
        updatedAt: '2026-10-22T10:00:00.000Z',
        stats,
        nodes: [
          { id: 'ikuai-internet', label: 'Internet', type: 'internet', status: 'up' },
          { id: 'ikuai-router', label: 'Main iKuai', type: 'router', status: 'up', ipAddress: '192.0.2.1' },
          { id: 'raw-proxmox', label: 'Proxmox node', type: 'server', status: 'up', ipAddress: '192.0.2.10', mac: '00:11:22:33:44:55' },
          { id: 'raw-docker', label: 'node-b.home.arpa', type: 'server', status: 'up', ipAddress: '192.0.2.20', model: 'Generic x86' },
          { id: 'raw-laptop', label: 'Laptop', type: 'client', ipAddress: '192.0.2.99' },
        ],
      },
    });

    expect(result.updatedAt).toBe('2026-10-22T10:00:00.000Z');
    expect(result.stats).toBe(stats);
    expect(result.nodes.map((node) => node.label)).toEqual([
      'Internet', 'Main iKuai', 'Proxmox A', 'VM A', 'App A', 'Docker Host B', 'VM B',
      'Edge Host C', '未分配 Docker 应用', 'App B',
    ]);
    expect(result.nodes.find((node) => node.serviceId === 'proxmox-a')).toMatchObject({
      id: 'service-topology-host-proxmox-a', type: 'server', ipAddress: '192.0.2.10',
      mac: '00:11:22:33:44:55', status: 'up',
    });
    expect(result.nodes.find((node) => node.serviceId === 'docker-b')).toMatchObject({
      id: 'service-topology-host-docker-b', type: 'nas', model: 'Generic x86',
    });
    expect(result.nodes.some((node) => node.label === 'Laptop')).toBe(false);
    expect(result.nodes.some((node) => node.label === 'Cloud console')).toBe(false);
    expect(result.links).toEqual(expect.arrayContaining([
      { source: 'ikuai-internet', target: 'ikuai-router', label: 'WAN' },
      { source: 'ikuai-router', target: 'service-topology-host-proxmox-a', label: 'LAN' },
      { source: 'service-topology-host-proxmox-a', target: 'service-topology-service-vm-a' },
      { source: 'service-topology-host-proxmox-a', target: 'service-topology-service-app-a' },
      { source: 'service-topology-unassigned-docker', target: 'service-topology-service-app-b' },
    ]));
  });

  it('keeps unassigned VM and Docker workloads visible in generic branches', () => {
    const result = projectServiceTopology({ services, topology: { hosts: [] } });

    expect(result.nodes.map((node) => node.label)).toEqual([
      'Internet', 'iKuai', '未分配虚拟机', 'VM A', 'VM B', '未分配 Docker 应用', 'App A', 'App B',
    ]);
    expect(result.nodes.find((node) => node.type === 'router')).toMatchObject({ status: 'unknown' });
  });

  it('projects VM hosts and their Docker apps as a recursive tree', () => {
    const result = projectServiceTopology({
      services,
      topology: {
        hosts: [
          { serviceId: 'proxmox-a', nodeType: 'server', serviceIds: ['vm-a', 'vm-b'] },
          { serviceId: 'vm-a', nodeType: 'nas', serviceIds: ['app-a'] },
          { serviceId: 'vm-b', nodeType: 'server', serviceIds: ['app-b'] },
        ],
      },
    });

    expect(result.nodes.filter((node) => node.serviceId === 'vm-a')).toEqual([
      expect.objectContaining({ id: 'service-topology-host-vm-a', type: 'vm' }),
    ]);
    expect(result.links).toEqual(expect.arrayContaining([
      { source: 'service-topology-host-proxmox-a', target: 'service-topology-host-vm-a' },
      { source: 'service-topology-host-vm-a', target: 'service-topology-service-app-a' },
      { source: 'service-topology-host-proxmox-a', target: 'service-topology-host-vm-b' },
      { source: 'service-topology-host-vm-b', target: 'service-topology-service-app-b' },
    ]));
    expect(result.nodes.filter((node) => node.serviceId === 'app-a')).toHaveLength(1);
    expect(result.nodes.filter((node) => node.serviceId === 'app-b')).toHaveLength(1);
  });

  it('defensively removes cyclic VM host relationships', () => {
    const result = projectServiceTopology({
      services,
      topology: {
        hosts: [
          { serviceId: 'vm-a', nodeType: 'server', serviceIds: ['vm-b'] },
          { serviceId: 'vm-b', nodeType: 'server', serviceIds: ['vm-a', 'app-a'] },
        ],
      },
    });

    expect(result.links).toEqual(expect.arrayContaining([
      { source: 'service-topology-router', target: 'service-topology-host-vm-a', label: 'LAN' },
      { source: 'service-topology-host-vm-a', target: 'service-topology-host-vm-b' },
      { source: 'service-topology-host-vm-b', target: 'service-topology-service-app-a' },
    ]));
    expect(result.links).not.toContainEqual({
      source: 'service-topology-host-vm-b',
      target: 'service-topology-host-vm-a',
    });
  });

  it('ignores invalid and duplicate associations without duplicating or hiding workloads', () => {
    const result = projectServiceTopology({
      services,
      topology: {
        hosts: [
          { serviceId: 'vm-a', nodeType: 'server', serviceIds: ['vm-a'] },
          { serviceId: 'cloud', nodeType: 'nas', serviceIds: ['app-a'] },
          { serviceId: 'proxmox-a', nodeType: 'server', serviceIds: ['vm-a', 'vm-a', 'app-a'] },
          { serviceId: 'proxmox-a', nodeType: 'nas', serviceIds: ['vm-b'] },
        ],
      },
    });

    expect(result.nodes.filter((node) => node.serviceId === 'proxmox-a')).toHaveLength(1);
    for (const id of ['vm-a', 'vm-b', 'app-a', 'app-b']) {
      expect(result.nodes.filter((node) => node.serviceId === id)).toHaveLength(1);
    }
    expect(result.nodes.some((node) => node.serviceId === 'cloud')).toBe(false);
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'service-topology-unassigned-vm', label: '未分配虚拟机' }),
      expect.objectContaining({ id: 'service-topology-unassigned-docker', label: '未分配 Docker 应用' }),
    ]));
  });

  it('accepts legacy host fields and assigns workloads by runtime', () => {
    const result = projectServiceTopology({
      services,
      topology: { vmHostServiceId: 'proxmox-a', dockerHostServiceId: 'docker-b' },
    });

    expect(result.nodes.find((node) => node.serviceId === 'proxmox-a')).toMatchObject({ type: 'server' });
    expect(result.nodes.find((node) => node.serviceId === 'docker-b')).toMatchObject({ type: 'nas' });
    expect(result.links).toEqual(expect.arrayContaining([
      { source: 'service-topology-host-proxmox-a', target: 'service-topology-service-vm-a' },
      { source: 'service-topology-host-proxmox-a', target: 'service-topology-service-vm-b' },
      { source: 'service-topology-host-docker-b', target: 'service-topology-service-app-a' },
      { source: 'service-topology-host-docker-b', target: 'service-topology-service-app-b' },
    ]));
  });

  it('treats services without an explicit scope as internal for legacy configs', () => {
    const result = projectServiceTopology({
      services: [
        { id: 'host', name: 'Host', url: 'http://192.168.1.10', runtime: 'infrastructure' },
        { id: 'vm', name: 'Legacy VM', url: 'http://192.168.1.11', runtime: 'vm' },
      ],
      topology: { vmHostServiceId: 'host' },
    });

    expect(result.nodes.map((node) => node.serviceId).filter(Boolean)).toEqual(['host', 'vm']);
    expect(result.nodes.find((node) => node.serviceId === 'host')).toMatchObject({ type: 'server', label: 'Host' });
  });
});
