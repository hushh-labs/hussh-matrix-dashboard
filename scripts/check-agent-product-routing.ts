/** One hosts must never be inferred as the generic hushh.ai product. */
import assert from 'node:assert/strict';
import {
  inferProductFromQuestion,
  isOneEnvironmentSplitQuestion,
  productFromValue,
} from '../src/lib/agent-product-routing';

assert.equal(productFromValue('one.hushh.ai'), 'one.hushh.ai');
assert.equal(productFromValue('uat.one.hushh.ai'), 'uat.one.hushh.ai');
assert.equal(productFromValue('hushh.ai'), 'hushh.ai');
assert.equal(inferProductFromQuestion('Show one.hushh.ai search queries'), 'one.hushh.ai');
assert.equal(inferProductFromQuestion('Summarize uat.one.hushh.ai'), 'uat.one.hushh.ai');
assert.equal(inferProductFromQuestion('Show hushh.ai search queries'), 'hushh.ai');
assert.equal(isOneEnvironmentSplitQuestion('Compare One production and One UAT'), true);
assert.equal(isOneEnvironmentSplitQuestion('Compare One UAT with the public build'), true);
assert.equal(isOneEnvironmentSplitQuestion('Show One production search queries'), false);
assert.equal(isOneEnvironmentSplitQuestion('Show One product metrics'), false);
assert.equal(isOneEnvironmentSplitQuestion('Show One UAT account metrics'), false);
assert.equal(isOneEnvironmentSplitQuestion('Show Hushh AI production'), false);

console.log(JSON.stringify({ ok: true, checks: ['tool-keys', 'question-inference', 'environment-split'] }));
