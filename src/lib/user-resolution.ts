import firebaseUserMapJson from './firebase-user-map.json';
import type { OneActiveUserIdentity } from './types';

interface FirebaseUserRecord {
  displayName?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
}

const userCatalogMap = firebaseUserMapJson as Record<string, FirebaseUserRecord>;

export function findInCatalog(item: Partial<OneActiveUserIdentity>): FirebaseUserRecord | null {
  if (item.userId && userCatalogMap[item.userId]) return userCatalogMap[item.userId];
  if (item.userId && userCatalogMap[item.userId.toLowerCase()]) return userCatalogMap[item.userId.toLowerCase()];
  if (item.boundEmail && userCatalogMap[item.boundEmail.toLowerCase().trim()]) return userCatalogMap[item.boundEmail.toLowerCase().trim()];
  if (item.userPseudoId && userCatalogMap[item.userPseudoId]) return userCatalogMap[item.userPseudoId];
  if (item.phoneNumber && userCatalogMap[item.phoneNumber.trim()]) return userCatalogMap[item.phoneNumber.trim()];
  return null;
}

export function resolveUserPhoneNumber(
  item: Partial<OneActiveUserIdentity>,
  _index: number = 0
): string {
  // 1. Direct phone number from telemetry
  if (item.phoneNumber && item.phoneNumber.trim() && item.phoneNumber.trim() !== '—') {
    return item.phoneNumber.trim();
  }

  // 2. Lookup in Firebase catalog by userId, boundEmail, or userPseudoId
  const record = findInCatalog(item);
  if (record?.phoneNumber && record.phoneNumber.trim() && record.phoneNumber.trim() !== '—') {
    return record.phoneNumber.trim();
  }

  // 3. Authentic & accurate: NO fake/hallucinated numbers! Return '—' if no phone number exists
  return '—';
}

export function resolveUserName(
  item: Partial<OneActiveUserIdentity>,
  _index: number = 0
): string {
  // 1. Direct display name from item (excluding generic placeholders)
  if (
    item.displayName &&
    item.displayName.trim() &&
    !item.displayName.startsWith('Active Device User') &&
    !item.displayName.includes('Active User') &&
    item.displayName !== 'Anonymous User'
  ) {
    return item.displayName.trim();
  }

  // 2. Lookup in Firebase catalog
  const record = findInCatalog(item);
  if (record?.displayName && record.displayName.trim()) {
    return record.displayName.trim();
  }

  // 3. Format from boundEmail or catalog email
  const email = item.boundEmail || record?.email;
  if (email && email.trim() && email.includes('@')) {
    const namePart = email.split('@')[0];
    const words = namePart
      .split(/[._-]/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
    if (words.length > 0) return words.join(' ');
  }

  // 4. Clean anonymous fallback with ID snippet
  if (item.userPseudoId) {
    return `Active Device (${item.userPseudoId.slice(0, 8)})`;
  }
  return 'Active User';
}

export function resolveUserEmail(
  item: Partial<OneActiveUserIdentity>,
  _index: number = 0
): string {
  if (item.boundEmail && item.boundEmail.trim() && item.boundEmail.includes('@')) {
    return item.boundEmail.trim();
  }
  const record = findInCatalog(item);
  if (record?.email && record.email.trim() && record.email.includes('@')) {
    return record.email.trim();
  }
  return '—';
}
