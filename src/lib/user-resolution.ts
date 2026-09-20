import firebaseUserMapJson from './firebase-user-map.json';
import type { OneActiveUserIdentity } from './types';

interface FirebaseUserRecord {
  displayName?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
}

const userCatalogMap = firebaseUserMapJson as Record<string, FirebaseUserRecord>;

// Fast lightweight MD5 implementation for client-side device hash matching
function md5(str: string): string {
  function rotateLeft(lValue: number, iShiftBits: number) {
    return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
  }
  function addUnsigned(lX: number, lY: number) {
    const lX8 = lX & 0x80000000;
    const lY8 = lY & 0x80000000;
    const lX4 = lX & 0x40000000;
    const lY4 = lY & 0x40000000;
    const lResult = (lX & 0x3fffffff) + (lY & 0x3fffffff);
    if (lX4 & lY4) return lResult ^ 0x80000000 ^ lX8 ^ lY8;
    if (lX4 | lY4) {
      if (lResult & 0x40000000) return lResult ^ 0xc0000000 ^ lX8 ^ lY8;
      else return lResult ^ 0x40000000 ^ lX8 ^ lY8;
    } else return lResult ^ lX8 ^ lY8;
  }
  function F(x: number, y: number, z: number) { return (x & y) | (~x & z); }
  function G(x: number, y: number, z: number) { return (x & z) | (y & ~z); }
  function H(x: number, y: number, z: number) { return x ^ y ^ z; }
  function I(x: number, y: number, z: number) { return y ^ (x | ~z); }
  function FF(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function GG(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function HH(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function II(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function convertToWordArray(string: string) {
    let lMessageLength = string.length;
    let lNumberOfWords_temp1 = lMessageLength + 8;
    let lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
    let lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16;
    let lWordArray = Array(lNumberOfWords - 1);
    let lBytePosition = 0;
    let lByteCount = 0;
    while (lByteCount < lMessageLength) {
      const lWordIndex = (lByteCount - (lByteCount % 4)) / 4;
      lBytePosition = (lByteCount % 4) * 8;
      lWordArray[lWordIndex] = (lWordArray[lWordIndex] | (string.charCodeAt(lByteCount) << lBytePosition));
      lByteCount++;
    }
    const lWordIndex = (lByteCount - (lByteCount % 4)) / 4;
    lBytePosition = (lByteCount % 4) * 8;
    lWordArray[lWordIndex] = lWordArray[lWordIndex] | (0x80 << lBytePosition);
    lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
    lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
    return lWordArray;
  }
  function wordToHex(lValue: number) {
    let WordToHexValue = '', WordToHexValue_temp = '', ByteNumber, WordNumber;
    for (WordNumber = 0; WordNumber <= 3; WordNumber++) {
      ByteNumber = (lValue >>> (WordNumber * 8)) & 255;
      WordToHexValue_temp = '0' + ByteNumber.toString(16);
      WordToHexValue += WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2);
    }
    return WordToHexValue;
  }
  const x = convertToWordArray(str);
  let k, AA, BB, CC, DD, a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  for (k = 0; k < x.length; k += 16) {
    AA = a; BB = b; CC = c; DD = d;
    a = FF(a, b, c, d, x[k], 7, 0xd76aa478); d = FF(d, a, b, c, x[k + 1], 12, 0xe8c7b756); c = FF(c, d, a, b, x[k + 2], 17, 0x242070db); b = FF(b, c, d, a, x[k + 3], 22, 0xc1bdceee);
    a = FF(a, b, c, d, x[k + 4], 7, 0xf57c0faf); d = FF(d, a, b, c, x[k + 5], 12, 0x4787c62a); c = FF(c, d, a, b, x[k + 6], 17, 0xa8304613); b = FF(b, c, d, a, x[k + 7], 22, 0xfd469501);
    a = FF(a, b, c, d, x[k + 8], 7, 0x698098d8); d = FF(d, a, b, c, x[k + 9], 12, 0x8b44f7af); c = FF(c, d, a, b, x[k + 10], 17, 0xffff5bb1); b = FF(b, c, d, a, x[k + 11], 22, 0x895cd7be);
    a = FF(a, b, c, d, x[k + 12], 7, 0x6b901122); d = FF(d, a, b, c, x[k + 13], 12, 0xfd987193); c = FF(c, d, a, b, x[k + 14], 17, 0xa679438e); b = FF(b, c, d, a, x[k + 15], 22, 0x49b40821);
    a = GG(a, b, c, d, x[k + 1], 5, 0xf61e2562); d = GG(d, a, b, c, x[k + 6], 9, 0xc040b340); c = GG(c, d, a, b, x[k + 11], 14, 0x265e5a51); b = GG(b, c, d, a, x[k], 20, 0xe9b6c7aa);
    a = GG(a, b, c, d, x[k + 5], 5, 0xd62f105d); d = GG(d, a, b, c, x[k + 10], 9, 0x02441453); c = GG(c, d, a, b, x[k + 15], 14, 0xd8a1e681); b = GG(b, c, d, a, x[k + 4], 20, 0xe7d3fbc8);
    a = GG(a, b, c, d, x[k + 9], 5, 0x21e1cde6); d = GG(d, a, b, c, x[k + 14], 9, 0xc33707d6); c = GG(c, d, a, b, x[k + 3], 14, 0xf4d50d87); b = GG(b, c, d, a, x[k + 8], 20, 0x455a14ed);
    a = GG(a, b, c, d, x[k + 13], 5, 0xa9e3e905); d = GG(d, a, b, c, x[k + 2], 9, 0xfcefa3f8); c = GG(c, d, a, b, x[k + 7], 14, 0x676f02d9); b = GG(b, c, d, a, x[k + 12], 20, 0x8d2a4c8a);
    a = HH(a, b, c, d, x[k + 5], 4, 0xfffa3942); d = HH(d, a, b, c, x[k + 8], 11, 0x8771f681); c = HH(c, d, a, b, x[k + 11], 16, 0x6d9d6122); b = HH(b, c, d, a, x[k + 14], 23, 0xfde5380c);
    a = HH(a, b, c, d, x[k + 1], 4, 0xa4beea44); d = HH(d, a, b, c, x[k + 4], 11, 0x4bdecfa9); c = HH(c, d, a, b, x[k + 7], 16, 0xf6bb4b60); b = HH(b, c, d, a, x[k + 10], 23, 0xbebfbc70);
    a = HH(a, b, c, d, x[k + 13], 4, 0x289b7ec6); d = HH(d, a, b, c, x[k], 11, 0xeaa127fa); c = HH(c, d, a, b, x[k + 3], 16, 0xd4ef3085); b = HH(b, c, d, a, x[k + 6], 23, 0x04881d05);
    a = HH(a, b, c, d, x[k + 9], 4, 0xd9d4d039); d = HH(d, a, b, c, x[k + 12], 11, 0xe6ed998e); c = HH(c, d, a, b, x[k + 15], 16, 0x1fa27cf8); b = HH(b, c, d, a, x[k], 23, 0xc4ac5665);
    a = II(a, b, c, d, x[k], 6, 0xf4292244); d = II(d, a, b, c, x[k + 7], 10, 0x432aff97); c = II(c, d, a, b, x[k + 14], 15, 0xab9423a7); b = II(b, c, d, a, x[k + 5], 21, 0xfc93a039);
    a = II(a, b, c, d, x[k + 12], 6, 0x655b59c3); d = II(d, a, b, c, x[k + 3], 10, 0x8f0ccc92); c = II(c, d, a, b, x[k + 10], 15, 0xffeff47d); b = II(b, c, d, a, x[k + 1], 21, 0x85845dd1);
    a = II(a, b, c, d, x[k + 8], 6, 0x6fa87e4f); d = II(d, a, b, c, x[k + 15], 10, 0xfe2ce6e0); c = II(c, d, a, b, x[k + 2], 15, 0xa3014314); b = II(b, c, d, a, x[k + 9], 21, 0x4e0811a1);
    a = addUnsigned(a, AA); b = addUnsigned(b, BB); c = addUnsigned(c, CC); d = addUnsigned(d, DD);
  }
  return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
}

export function findInCatalog(item: Partial<OneActiveUserIdentity>): FirebaseUserRecord | null {
  if (item.userId && userCatalogMap[item.userId]) return userCatalogMap[item.userId];
  if (item.userId && userCatalogMap[item.userId.toLowerCase()]) return userCatalogMap[item.userId.toLowerCase()];
  if (item.boundEmail && userCatalogMap[item.boundEmail.toLowerCase().trim()]) return userCatalogMap[item.boundEmail.toLowerCase().trim()];
  if (item.displayName && userCatalogMap[item.displayName.toLowerCase().trim()]) return userCatalogMap[item.displayName.toLowerCase().trim()];
  if (item.phoneNumber && userCatalogMap[item.phoneNumber.trim()]) return userCatalogMap[item.phoneNumber.trim()];

  if (item.userPseudoId) {
    const p = item.userPseudoId.trim();
    if (userCatalogMap[p]) return userCatalogMap[p];
    
    const hash = md5(p);
    if (userCatalogMap[hash]) return userCatalogMap[hash];

    const prefix = p.split('.')[0];
    if (prefix && userCatalogMap[prefix]) return userCatalogMap[prefix];
    const prefixHash = md5(prefix);
    if (userCatalogMap[prefixHash]) return userCatalogMap[prefixHash];
  }

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

  // 2. Lookup in Firebase catalog by userId, boundEmail, displayName, or userPseudoId
  const record = findInCatalog(item);
  if (record?.phoneNumber && record.phoneNumber.trim() && record.phoneNumber.trim() !== '—') {
    return record.phoneNumber.trim();
  }

  // 3. Strict non-fabrication rule: Return 'Not available' if no phone number in Firebase Auth
  return 'Not available';
}

export function resolveUserName(
  item: Partial<OneActiveUserIdentity>,
  _index: number = 0
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

  const record = findInCatalog(item);
  if (record?.displayName && record.displayName.trim()) {
    return record.displayName.trim();
  }

  const email = item.boundEmail || record?.email;
  if (email && email.trim() && email.includes('@')) {
    const namePart = email.split('@')[0];
    const words = namePart
      .split(/[._-]/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
    if (words.length > 0) return words.join(' ');
  }

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
  const name = resolveUserName(item, _index);
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${slug}@gmail.com`;
}
