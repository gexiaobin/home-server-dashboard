import { describe, expect, it } from 'vitest';

import { projectServiceTopology } from './service-topology.mjs';

const services = [
  {
    id: 'esxi',
    name: 'VMware ESXi',
    url: 'https://192.0.2.10',
    scope: 'internal',
    runtime: 'infrastructure',
  },
  {
    id: 'synology',
    name: 'Synology DS920+',
    url: 'https://nas.home.arpa:5001',
    scope: 'internal',
    runtime: 'infrastructure',
  },
  {
    id: 'istoreos',
    name: 'iStoreOS',
    url: 'http://192.0.2.2',
    scope: 'internal',
    runtime: 'vm',
  },
  {
    id: 'fnos',
    name: 'fnOS',
    url: 'http://192.0.2.3',
    scope: 'internal',
    runtime: 'vm',
  },
  {
    id: 'immich',
    name: 'Immich',
    url: 'http://192.0.2.8:2283',
    scope: 'internal',
    runtime: 'docker',
  },
  {
    id: 'aliyun',
    name: 'Alibaba Cloud',
    url: 'https://home.console.aliyun.com',
    scope: 'external',
    runtime: 'infrastructure',
  },
];

const topology = {
  vmHostServiceId: 'esxi',
  dockerHostServiceId: 'synology',
};

describe('projectServiceTopology', () => {
  it('projects configured internal services while preserving router telemetry', () => {
    const stats = {
      onlineClients: 16,
      knownDevices: 20,
      linkedInterfaces: 3,
      upload: 1_024,
      download: 2_048,
    };
    const result = projectServiceTopology({
      services,
      topology,
      snapshot: {
        updatedAt: '2026-10-22T10:00:00.000Z',
        stats,
        nodes: [
          { id: 'ikuai-internet', label: 'Internet', type: 'internet', status: 'up' },
          {
            id: 'ikuai-router',
            label: 'Main iKuai',
            type: 'router',
            status: 'up',
            ipAddress: '192.0.2.1',
            cpuUsage: 12,
          },
          {
            id: 'raw-esxi',
            label: 'ESXi host',
            type: 'server',
            status: 'up',
            ipAddress: '192.0.2.10',
            mac: '00:11:22:33:44:55',
          },
          {
            id: 'raw-nas',
            label: 'nas.home.arpa',
            type: 'nas',
            status: 'up',
            ipAddress: '192.0.2.8',
            model: 'DS920+',
          },
          { id: 'raw-laptop', label: 'Laptop', type: 'client', ipAddress: '192.0.2.99' },
        ],
        links: [{ source: 'ikuai-router', target: 'raw-laptop' }],
      },
    });

    expect(result.updatedAt).toBe('2026-10-22T10:00:00.000Z');
    expect(result.stats).toBe(stats);
    expect(result.nodes.map((node) => node.label)).toEqual([
      'Internet',
      'Main iKuai',
      'VMware ESXi',
      'iStoreOS',
      'fnOS',
      'Synology DS920+',
      'Immich',
    ]);
    expect(result.nodes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Laptop' }),
      expect.objectContaining({ label: 'Alibaba Cloud' }),
    ]));
    expect(result.nodes.find((node) => node.serviceId === 'esxi')).toMatchObject({
      id: 'service-topology-vm-host',
      type: 'server',
      ipAddress: '192.0.2.10',
      mac: '00:11:22:33:44:55',
      status: 'up',
    });
    expect(result.nodes.find((node) => node.serviceId === 'synology')).toMatchObject({
      id: 'service-topology-docker-host',
      type: 'nas',
      ipAddress: '192.0.2.8',
      model: 'DS920+',
    });
    expect(result.links).toEqual(expect.arrayContaining([
      { source: 'ikuai-internet', target: 'ikuai-router', label: 'WAN' },
      { source: 'ikuai-router', target: 'service-topology-vm-host', label: 'LAN' },
      { source: 'service-topology-vm-host', target: 'service-topology-service-istoreos' },
      { source: 'service-topology-docker-host', target: 'service-topology-service-immich' },
    ]));
  });

  it('builds a usable fallback graph without leaking external or unassigned services', () => {
    const result = projectServiceTopology({
      services: [
        ...services,
        {
          id: 'unassigned',
          name: 'Unassigned infrastructure',
          url: 'http://192.0.2.90',
          scope: 'internal',
          runtime: 'infrastructure',
        },
      ],
      topology,
      snapshot: {
        nodes: [
          { id: 'manual-internet', label: 'Internet', type: 'internet', x: 1, y: 1 },
          { id: 'manual-router', label: '主路由', type: 'router', ipAddress: '192.0.2.1' },
          { id: 'manual-nas', label: 'NAS', type: 'nas', serviceId: 'synology', model: 'DS920+' },
        ],
      },
    });

    expect(result.updatedAt).toBeNull();
    expect(result).not.toHaveProperty('stats');
    expect(result.nodes.map((node) => node.serviceId).filter(Boolean)).toEqual([
      'esxi',
      'istoreos',
      'fnos',
      'synology',
      'immich',
    ]);
    expect(result.nodes.find((node) => node.serviceId === 'synology')).toMatchObject({
      label: 'Synology DS920+',
      model: 'DS920+',
    });
    expect(result.nodes.find((node) => node.type === 'internet')).toMatchObject({
      id: 'manual-internet',
      x: 50,
      y: 8,
    });
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
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'server', label: 'Host' }),
      expect.objectContaining({ type: 'nas', label: 'Synology' }),
    ]));
  });

  it('keeps both requested host branches when host services are not configured', () => {
    const result = projectServiceTopology({
      services: [
        { id: 'vm', name: 'iStoreOS', url: 'http://192.168.1.2', scope: 'internal', runtime: 'vm' },
        { id: 'app', name: 'Qinglong', url: 'http://192.168.1.8:8903', scope: 'internal', runtime: 'docker' },
      ],
      topology: {},
    });

    expect(result.nodes.map((node) => node.label)).toEqual([
      'Internet',
      'iKuai',
      'VMware ESXi',
      'iStoreOS',
      'Synology',
      'Qinglong',
    ]);
    expect(result.nodes.find((node) => node.type === 'router')).toMatchObject({
      status: 'unknown',
    });
  });

  it('ignores leaf and external bookmark host references without hiding services', () => {
    const result = projectServiceTopology({
      services,
      topology: {
        vmHostServiceId: 'istoreos',
        dockerHostServiceId: 'aliyun',
      },
    });

    expect(result.nodes.find((node) => node.id === 'service-topology-vm-host')).toMatchObject({
      label: 'VMware ESXi',
      type: 'server',
    });
    expect(result.nodes.find((node) => node.id === 'service-topology-vm-host')).not.toHaveProperty('serviceId');
    expect(result.nodes.find((node) => node.id === 'service-topology-docker-host')).toMatchObject({
      label: 'Synology',
      type: 'nas',
    });
    expect(result.nodes.filter((node) => node.serviceId === 'istoreos')).toEqual([
      expect.objectContaining({ type: 'vm', label: 'iStoreOS' }),
    ]);
    expect(result.nodes.some((node) => node.serviceId === 'aliyun')).toBe(false);
  });

  it('uses a duplicated infrastructure host only for the VMware branch', () => {
    const result = projectServiceTopology({
      services,
      topology: {
        vmHostServiceId: 'esxi',
        dockerHostServiceId: 'esxi',
      },
    });

    expect(result.nodes.find((node) => node.id === 'service-topology-vm-host')).toMatchObject({
      label: 'VMware ESXi',
      serviceId: 'esxi',
    });
    expect(result.nodes.find((node) => node.id === 'service-topology-docker-host')).toMatchObject({
      label: 'Synology',
      type: 'nas',
    });
    expect(result.nodes.filter((node) => node.serviceId === 'esxi')).toHaveLength(1);
  });
});
