/** Compatibility names pin UAT; caller input cannot select Production. */
import { readOwnerProjection, readOwnerPermission, readOwnerSnapshot } from './owner-snapshot-client.mjs';
export const readUatOwnerProjection = (options, ...rest) => readOwnerProjection({ ...options, environment: 'uat' }, ...rest);
export const readUatPermission = (options, ...rest) => readOwnerPermission({ ...options, environment: 'uat' }, ...rest);
export const readUatSnapshot = (options, ...rest) => readOwnerSnapshot({ ...options, environment: 'uat' }, ...rest);
