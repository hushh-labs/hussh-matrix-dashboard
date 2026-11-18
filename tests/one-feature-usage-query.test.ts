import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { oneFeatureUsageQuery } from '../src/server/one-feature-usage-query';
const deviceKeySql="CONCAT(COALESCE(platform, 'UNKNOWN'), ':', user_pseudo_id)";
// Recorded from the unchanged pre-extraction template, not a warehouse query.
const cases = [
  ['`prod.dataset.events_*`', "_TABLE_SUFFIX BETWEEN '20261118' AND '20261118' AND production_scope", '1f1bc6ec146740ea1a132e755c079dbd7702529b812c68084ab2676168ede93c'],
  ['`uat.dataset.events_*`', "_TABLE_SUFFIX BETWEEN '20261118' AND '20261118' AND uat_scope", '6f5df49e15d5ed5f8e072fc8e1d52eb8794ddc40c1ddab5d33189b40e2b44a97'],
  ['`prod.dataset.events_*`', "_TABLE_SUFFIX BETWEEN '20261020' AND '20261118' AND production_scope", '9d99dbff539c96aaecfa91f652e1384d13a0b9ada7e3366d6f0dd382aa1979b6'],
  ['`uat.dataset.events_*`', "_TABLE_SUFFIX BETWEEN '20260821' AND '20261118' AND uat_scope", '09eb6a670aa7930cb6aaef4b6f0b5cc9e3ff1eb454e37f586b06408f6c4155b9'],
];
describe('One feature SQL extraction', () => {
  it.each(cases)('preserves the prior complete query for %s / %s', (table,dateFilter,expected) => {
    const sql=oneFeatureUsageQuery({deviceKeySql,table,dateFilter});
    const addition="          WHEN event_name = 'mail_receipts_workspace_viewed' THEN 'receipts_workspace_viewed'\n";
    const add="          WHEN event_name = 'one_location_sms_contact_add_result' THEN 'sms_contact_add'\n";
    const remove="          WHEN event_name = 'one_location_sms_contact_remove_result' THEN 'sms_contact_remove'\n";
    const calendar="          WHEN event_name = 'one_calendar_invitation_response' THEN 'calendar_invitation_response'\n";
    for(const entry of [addition,add,remove,calendar])expect(sql.split(entry)).toHaveLength(2);
    expect(createHash('sha256').update(sql.replace(addition,'').replace(add,'').replace(remove,'').replace(calendar,'')).digest('hex')).toBe(expected);
    expect(sql).toContain(`FROM ${table}`); expect(sql).toContain(`WHERE ${dateFilter}`);
  });
});
