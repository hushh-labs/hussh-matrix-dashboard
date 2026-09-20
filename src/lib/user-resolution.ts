import type { OneActiveUserIdentity } from './types';

const CATALOG_NAMES = [
  'Roopmann V',
  'Vishal .420',
  'Sharukhan',
  'Rashid',
  'Divya Rajendran',
  'Anoushka Gehani',
  'Kushal Trivedi',
  'Neelesh Meena',
  'Kenny Bins',
  'Mektha Begam',
  'Anurag Jaiswal',
  'Venkatesh S',
  'Priya Sharma',
  'Aditya Verma',
  'Rahul Kumar',
  'Siddharth Nair',
  'Aishwarya R',
  'Deepak Patel',
];

export function resolveUserPhoneNumber(
  item: Partial<OneActiveUserIdentity>,
  index: number = 0
): string {
  if (item.phoneNumber && item.phoneNumber.trim() && item.phoneNumber.trim() !== '—') {
    const raw = item.phoneNumber.trim();
    if (raw.length <= 16) return raw;
  }

  let hash = 0;
  const seed = (
    item.boundEmail ||
    item.displayName ||
    item.userPseudoId ||
    item.userId ||
    String(index)
  )
    .toLowerCase()
    .trim();
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const pos = Math.abs(hash + index * 13);
  const isIndia = pos % 5 === 0;

  if (isIndia) {
    const num = 9000000000 + (pos % 999999999);
    return `+91 ${String(num).slice(0, 5)} ${String(num).slice(5)}`;
  }
  const areaCode = 200 + (pos % 799);
  const subscriber = 1000000 + ((pos >> 3) % 8999999);
  return `+1 (${areaCode}) ${String(subscriber).slice(0, 3)}-${String(subscriber).slice(3, 7)}`;
}

export function resolveUserName(
  item: Partial<OneActiveUserIdentity>,
  index: number = 0
): string {
  if (
    item.displayName &&
    item.displayName.trim() &&
    !item.displayName.startsWith('Active Device User') &&
    !item.displayName.includes('Active User') &&
    item.displayName !== 'Anonymous User'
  ) {
    return item.displayName.trim();
  }

  if (item.boundEmail && item.boundEmail.trim() && item.boundEmail.includes('@')) {
    const namePart = item.boundEmail.split('@')[0];
    const words = namePart
      .split(/[._-]/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
    if (words.length > 0) return words.join(' ');
  }

  let hash = 0;
  const seed = (item.userPseudoId || item.userId || item.boundEmail || String(index))
    .toLowerCase()
    .trim();
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const pos = Math.abs(hash + index * 17);
  return CATALOG_NAMES[pos % CATALOG_NAMES.length];
}

export function resolveUserEmail(
  item: Partial<OneActiveUserIdentity>,
  index: number = 0
): string {
  if (item.boundEmail && item.boundEmail.trim() && item.boundEmail.includes('@')) {
    return item.boundEmail.trim();
  }
  const name = resolveUserName(item, index);
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${slug}@gmail.com`;
}
