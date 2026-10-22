import { isIP } from 'node:net';

const ROOT_POSITIONS = Object.freeze({
  internet: Object.freeze({ x: 50, y: 8 }),
  router: Object.freeze({ x: 50, y: 27 }),
});

const BRANCHES = Object.freeze({
  vm: Object.freeze({
    hostId: 'service-topology-vm-host',
    hostLabel: 'VMware ESXi',
    hostType: 'server',
    hostX: 27,
    leafType: 'vm',
    minimumX: 6,
    maximumX: 46,
  }),
  docker: Object.freeze({
    hostId: 'service-topology-docker-host',
    hostLabel: 'Synology',
    hostType: 'nas',
    hostX: 73,
    leafType: 'container',
    minimumX: 54,
    maximumX: 94,
  }),
});

function serviceNodeId(service) {
  return `service-topology-service-${service.id}`;
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

function leafPositions(count, minimum, maximum) {
  if (count <= 0) return [];
  if (count === 1) return [(minimum + maximum) / 2];
  const step = (maximum - minimum) / (count - 1);
  return Array.from({ length: count }, (_, index) => minimum + step * index);
}

function hostNode(service, branch, rawNodes, claimedNodeIds) {
  if (!service) {
    return {
      id: branch.hostId,
      label: branch.hostLabel,
      type: branch.hostType,
      x: branch.hostX,
      y: 51,
    };
  }
  const details = findHostDetails(service, rawNodes, claimedNodeIds);
  if (details?.id) claimedNodeIds.add(details.id);
  const hostname = urlHostname(service.url);
  return {
    ...(details || {}),
    id: branch.hostId,
    label: service.name,
    type: branch.hostType,
    serviceId: service.id,
    x: branch.hostX,
    y: 51,
    ...(!details?.ipAddress && isIP(hostname) ? { ipAddress: hostname } : {}),
  };
}

function leafNodes(services, branch) {
  const positions = leafPositions(services.length, branch.minimumX, branch.maximumX);
  return services.map((service, index) => {
    const hostname = urlHostname(service.url);
    return {
      id: serviceNodeId(service),
      label: service.name,
      type: branch.leafType,
      serviceId: service.id,
      x: positions[index],
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
  const vmHostService = hostServiceById.get(topology.vmHostServiceId);
  const requestedDockerHostService = hostServiceById.get(topology.dockerHostServiceId);
  const dockerHostService = requestedDockerHostService?.id !== vmHostService?.id
    ? requestedDockerHostService
    : undefined;
  const hostServices = { vm: vmHostService, docker: dockerHostService };
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
  const selectedHostIds = new Set(Object.values(hostServices)
    .filter(Boolean)
    .map((service) => service.id));

  for (const [runtime, branch] of Object.entries(BRANCHES)) {
    const hostService = hostServices[runtime];
    const host = hostNode(hostService, branch, rawNodes, claimedNodeIds);
    const branchServices = internalServices.filter((service) => (
      service.runtime === runtime && !selectedHostIds.has(service.id)
    ));
    const leaves = leafNodes(branchServices, branch);
    nodes.push(host, ...leaves);
    links.push({ source: router.id, target: host.id, label: 'LAN' });
    links.push(...leaves.map((leaf) => ({ source: host.id, target: leaf.id })));
  }

  return {
    updatedAt: snapshot?.updatedAt ?? null,
    nodes,
    links,
    ...(snapshot?.stats ? { stats: snapshot.stats } : {}),
  };
}
