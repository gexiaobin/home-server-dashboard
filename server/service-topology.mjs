import { isIP } from 'node:net';

const ROOT_POSITIONS = Object.freeze({
  internet: Object.freeze({ x: 50, y: 8 }),
  router: Object.freeze({ x: 50, y: 27 }),
});

function serviceNodeId(service) {
  return `service-topology-service-${service.id}`;
}

function hostNodeId(service) {
  return `service-topology-host-${service.id}`;
}

function urlHostname(value) {
  try {
    return new URL(value).hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  } catch {
    return '';
  }
}

function normalizedHost(value) {
  return typeof value === 'string'
    ? value.trim().replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
    : '';
}

function hostMatchesNode(hostname, node) {
  if (!hostname || !node || typeof node !== 'object') return false;
  return [node.ipAddress, node.hostname, node.label]
    .some((value) => normalizedHost(value) === hostname);
}

function findHostDetails(service, rawNodes, claimedNodeIds) {
  const directMatch = rawNodes.find((node) => (
    node?.serviceId === service.id && !claimedNodeIds.has(node.id)
  ));
  if (directMatch) return directMatch;

  const hostname = urlHostname(service.url);
  return rawNodes.find((node) => (
    !claimedNodeIds.has(node?.id) && hostMatchesNode(hostname, node)
  ));
}

function rootNode(rawNodes, type, fallback) {
  const source = rawNodes.find((node) => node?.type === type);
  return {
    ...fallback,
    ...(source || {}),
    type,
    x: ROOT_POSITIONS[type].x,
    y: ROOT_POSITIONS[type].y,
  };
}

function positions(count, minimum, maximum) {
  if (count <= 0) return [];
  if (count === 1) return [(minimum + maximum) / 2];
  const step = (maximum - minimum) / (count - 1);
  return Array.from({ length: count }, (_, index) => minimum + step * index);
}

function legacyHosts(topology, workloads) {
  return [
    ...(topology.vmHostServiceId ? [{
      serviceId: topology.vmHostServiceId,
      nodeType: 'server',
      serviceIds: workloads.filter((service) => service.runtime === 'vm').map((service) => service.id),
    }] : []),
    ...(topology.dockerHostServiceId && topology.dockerHostServiceId !== topology.vmHostServiceId ? [{
      serviceId: topology.dockerHostServiceId,
      nodeType: 'nas',
      serviceIds: workloads.filter((service) => service.runtime === 'docker').map((service) => service.id),
    }] : []),
  ];
}

function configuredBranches(topology, hostServiceById, workloadServiceById) {
  const workloads = [...workloadServiceById.values()];
  const requestedHosts = Array.isArray(topology.hosts)
    ? topology.hosts
    : legacyHosts(topology, workloads);
  const claimedHosts = new Set();
  const claimedWorkloads = new Set();
  const branches = [];

  for (const configuredHost of requestedHosts) {
    const hostService = hostServiceById.get(configuredHost?.serviceId);
    if (!hostService || claimedHosts.has(hostService.id)) continue;
    claimedHosts.add(hostService.id);
    const services = (Array.isArray(configuredHost.serviceIds) ? configuredHost.serviceIds : [])
      .flatMap((serviceId) => {
        const service = workloadServiceById.get(serviceId);
        if (!service || claimedWorkloads.has(service.id)) return [];
        claimedWorkloads.add(service.id);
        return [service];
      });
    branches.push({
      id: hostNodeId(hostService),
      label: hostService.name,
      nodeType: configuredHost.nodeType === 'nas' ? 'nas' : 'server',
      service: hostService,
      services,
    });
  }

  const unassigned = workloads.filter((service) => !claimedWorkloads.has(service.id));
  for (const runtime of ['vm', 'docker']) {
    const services = unassigned.filter((service) => service.runtime === runtime);
    if (services.length === 0) continue;
    branches.push({
      id: `service-topology-unassigned-${runtime}`,
      label: runtime === 'vm' ? '未分配虚拟机' : '未分配 Docker 应用',
      nodeType: 'server',
      services,
    });
  }

  return branches;
}

function hostNode(branch, x, rawNodes, claimedNodeIds) {
  if (!branch.service) {
    return {
      id: branch.id,
      label: branch.label,
      type: branch.nodeType,
      x,
      y: 51,
    };
  }
  const details = findHostDetails(branch.service, rawNodes, claimedNodeIds);
  if (details?.id) claimedNodeIds.add(details.id);
  const hostname = urlHostname(branch.service.url);
  return {
    ...(details || {}),
    id: branch.id,
    label: branch.label,
    type: branch.nodeType,
    serviceId: branch.service.id,
    x,
    y: 51,
    ...(!details?.ipAddress && isIP(hostname) ? { ipAddress: hostname } : {}),
  };
}

function leafNodes(services, minimumX, maximumX) {
  const leafPositions = positions(services.length, minimumX, maximumX);
  return services.map((service, index) => {
    const hostname = urlHostname(service.url);
    return {
      id: serviceNodeId(service),
      label: service.name,
      type: service.runtime === 'vm' ? 'vm' : 'container',
      serviceId: service.id,
      x: leafPositions[index],
      y: 81,
      ...(isIP(hostname) ? { ipAddress: hostname } : {}),
    };
  });
}

export function projectServiceTopology({ services = [], topology = {}, snapshot = {} } = {}) {
  const rawNodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : [];
  const internalServices = services.filter((service) => service?.scope !== 'external');
  const hostServiceById = new Map(internalServices
    .filter((service) => (service.runtime ?? 'infrastructure') === 'infrastructure')
    .map((service) => [service.id, service]));
  const workloadServiceById = new Map(internalServices
    .filter((service) => ['vm', 'docker'].includes(service.runtime))
    .map((service) => [service.id, service]));
  const branches = configuredBranches(topology, hostServiceById, workloadServiceById);
  const claimedNodeIds = new Set();
  const internet = rootNode(rawNodes, 'internet', {
    id: 'service-topology-internet',
    label: 'Internet',
  });
  const router = rootNode(rawNodes, 'router', {
    id: 'service-topology-router',
    label: 'iKuai',
    status: 'unknown',
  });
  const nodes = [internet, router];
  const links = [{ source: internet.id, target: router.id, label: 'WAN' }];
  const branchPositions = positions(branches.length, 8, 92);
  const branchWidth = branches.length > 0 ? 84 / branches.length : 84;

  branches.forEach((branch, index) => {
    const x = branchPositions[index];
    const host = hostNode(branch, x, rawNodes, claimedNodeIds);
    const minimumX = Math.max(4, x - branchWidth * 0.42);
    const maximumX = Math.min(96, x + branchWidth * 0.42);
    const leaves = leafNodes(branch.services, minimumX, maximumX);
    nodes.push(host, ...leaves);
    links.push({ source: router.id, target: host.id, label: 'LAN' });
    links.push(...leaves.map((leaf) => ({ source: host.id, target: leaf.id })));
  });

  return {
    updatedAt: snapshot?.updatedAt ?? null,
    nodes,
    links,
    ...(snapshot?.stats ? { stats: snapshot.stats } : {}),
  };
}
