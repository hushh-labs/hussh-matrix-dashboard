import { expect, it } from 'vitest';
import * as legacy from '../src/server/uat-one-feature-native';
import * as boundary from '../src/server/bigquery-cost-control';

it('does not export the retired single-feature native constructor',()=>{
  expect(Object.hasOwn(legacy,'UatFeatureNative')).toBe(false);
  expect(Object.hasOwn(boundary,'UatFeatureNative')).toBe(false);
});
