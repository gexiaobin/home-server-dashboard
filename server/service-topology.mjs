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

function createsCycle(hostId, childId, childrenByHost) {
  const pending = [childId];
  const visited = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === hostId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(childrenByHost.get(current) ?? []));
  }
  return false;
}

function configuredTrees(topology, hostServiceById, workloadServiceById) {
  const workloads = [...workloadServiceById.values()];
  const requestedHosts = Array.isArray(topology.hosts)
    ? topology.hosts
    : legacyHosts(topology, workloads);
  const hostConfigs = new Map();

  for (const configuredHost of requestedHosts) {
    const service = hostServiceById.get(configuredHost?.serviceId);
    if (!service || hostConfigs.has(service.id)) continue;
    hostConfigs.set(service.id, {
      isHost: true,
      service,
      nodeType: configuredHost.nodeType === 'nas' ? 'nas' : 'server',
      requestedServiceIds: Array.isArray(configuredHost.serviceIds) ? configuredHost.serviceIds : [],
    });
  }

  const childrenByHost = new Map([...hostConfigs].map(([serviceId]) => [serviceId, []]));
  const claimedWorkloads = new Set();
  for (const [hostId, host] of hostConfigs) {
    for (const serviceId of host.requestedServiceIds) {
      if (
        serviceId === hostId
        || !workloadServiceById.has(serviceId)
        || claimedWorkloads.has(serviceId)
        || createsCycle(hostId, serviceId, childrenByHost)
      ) continue;
      claimedWorkloads.add(serviceId);
      childrenByHost.get(hostId).push(serviceId);
    }
  }

  const buildHostTree = (hostId) => {
    const host = hostConfigs.get(hostId);
    return {
      isHost: true,
      id: hostNodeId(host.service),
      label: host.service.name,
      nodeType: host.service.runtime === 'vm' ? 'vm' : host.nodeType,
      service: host.service,
      children: childrenByHost.get(hostId).map((serviceId) => (
        hostConfigs.has(serviceId)
          ? buildHostTree(serviceId)
          : {
              isHost: false,
              id: serviceNodeId(workloadServiceById.get(serviceId)),
              service: workloadServiceById.get(serviceId),
              children: [],
            }
      )),
    };
  };

  const trees = [...hostConfigs.keys()]
    .filter((serviceId) => !claimedWorkloads.has(serviceId))
    .map(buildHostTree);
  const configuredHostIds = new Set(hostConfigs.keys());
  const unassigned = workloads.filter((service) => (
    !claimedWorkloads.has(service.id) && !configuredHostIds.has(service.id)
  ));
  for (const runtime of ['vm', 'docker']) {
    const services = unassigned.filter((service) => service.runtime === runtime);
    if (services.length === 0) continue;
    trees.push({
      isHost: true,
      id: `service-topology-unassigned-${runtime}`,
      label: runtime === 'vm' ? '未分配虚拟机' : '未分配 Docker 应用',
      nodeType: 'server',
      children: services.map((service) => ({
        isHost: false,
        id: serviceNodeId(service),
        service,
        children: [],
      })),
    });
  }

  return trees;
}

function hostNode(tree, x, y, rawNodes, claimedNodeIds) {
  if (!tree.service) {
    return { id: tree.id, label: tree.label, type: tree.nodeType, x, y };
  }
  const details = findHostDetails(tree.service, rawNodes, claimedNodeIds);
  if (details?.id) claimedNodeIds.add(details.id);
  const hostname = urlHostname(tree.service.url);
  return {
    ...(details || {}),
    id: tree.id,
    label: tree.label,
    type: tree.nodeType,
    serviceId: tree.service.id,
    x,
    y,
    ...(!details?.ipAddress && isIP(hostname) ? { ipAddress: hostname } : {}),
  };
}

function workloadNode(tree, x, y) {
  const hostname = urlHostname(tree.service.url);
  return {
    id: tree.id,
    label: tree.service.name,
    type: tree.service.runtime === 'vm' ? 'vm' : 'container',
    serviceId: tree.service.id,
    x,
    y,
    ...(isIP(hostname) ? { ipAddress: hostname } : {}),
  };
}

export function projectServiceTopology({ services = [], topology = {}, snapshot = {} } = {}) {
  const rawNodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : [];
  const internalServices = services.filter((service) => service?.scope !== 'external');
  const hostServiceById = new Map(internalServices
    .filter((service) => ['infrastructure', 'vm'].includes(service.runtime ?? 'infrastructure'))
    .map((service) => [service.id, service]));
  const workloadServiceById = new Map(internalServices
    .filter((service) => ['vm', 'docker'].includes(service.runtime))
    .map((service) => [service.id, service]));
  const trees = configuredTrees(topology, hostServiceById, workloadServiceById);
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
  const rootPositions = positions(trees.length, 8, 92);
  const rootWidth = trees.length > 0 ? 84 / trees.length : 84;

  const projectTree = (tree, parentId, minimumX, maximumX, depth) => {
    const x = (minimumX + maximumX) / 2;
    const y = Math.min(92, 51 + depth * 20);
    const node = tree.isHost
      ? hostNode(tree, x, y, rawNodes, claimedNodeIds)
      : workloadNode(tree, x, y);
    nodes.push(node);
    links.push({ source: parentId, target: node.id, ...(depth === 0 ? { label: 'LAN' } : {}) });
    if (tree.children.length === 0) return;
    const childPositions = positions(tree.children.length, minimumX, maximumX);
    const childWidth = (maximumX - minimumX) / Math.max(1, tree.children.length);
    tree.children.forEach((child, index) => {
      const childX = childPositions[index];
      projectTree(
        child,
        node.id,
        Math.max(2, childX - childWidth * 0.44),
        Math.min(98, childX + childWidth * 0.44),
        depth + 1,
      );
    });
  };

  trees.forEach((tree, index) => {
    const x = rootPositions[index];
    projectTree(
      tree,
      router.id,
      Math.max(4, x - rootWidth * 0.42),
      Math.min(96, x + rootWidth * 0.42),
      0,
    );
  });

  return {
    updatedAt: snapshot?.updatedAt ?? null,
    nodes,
    links,
    ...(snapshot?.stats ? { stats: snapshot.stats } : {}),
  };
}
