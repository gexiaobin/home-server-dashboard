import {
  Box,
  Boxes,
  Cloud,
  Container,
  Globe2,
  HardDrive,
  House,
  Image,
  Laptop,
  MonitorCog,
  Network,
  Play,
  Router,
  Server,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

const serviceIcons: Record<string, LucideIcon> = {
  server: Server,
  boxes: Boxes,
  house: House,
  play: Play,
  image: Image,
  shield: ShieldCheck,
  network: Network,
  storage: HardDrive,
  default: Box,
};

const nodeIcons: Record<string, LucideIcon> = {
  internet: Globe2,
  router: Router,
  nas: HardDrive,
  server: Server,
  vm: MonitorCog,
  container: Container,
  client: Laptop,
  cloud: Cloud,
};

export function getServiceIcon(name: string): LucideIcon {
  return serviceIcons[name] || serviceIcons.default;
}

export function getNodeIcon(type: string): LucideIcon {
  return nodeIcons[type] || Server;
}

export const serviceIconOptions = [
  { value: 'server', label: '服务器' },
  { value: 'boxes', label: '虚拟化' },
  { value: 'house', label: '智能家庭' },
  { value: 'play', label: '媒体' },
  { value: 'image', label: '照片' },
  { value: 'shield', label: '安全' },
  { value: 'network', label: '网络' },
  { value: 'storage', label: '存储' },
  { value: 'default', label: '应用' },
];
