import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { oneLocationBehaviorQuery } from '../src/server/one-location-behavior-query';
const deviceKeySql="CONCAT(COALESCE(platform, 'UNKNOWN'), ':', user_pseudo_id)";
const cases=[
 ['`prod.dataset.events_*`',"_TABLE_SUFFIX BETWEEN '20261118' AND '20261118' AND production_scope",'677f8df1583f6be789a322afc9bc0579e33ec2341ecb8e353d24a4861c9c1bb5'],
 ['`uat.dataset.events_*`',"_TABLE_SUFFIX BETWEEN '20260821' AND '20261118' AND uat_scope",'6795f5406c99132b3243bafb89434496719dac41b7824c3000d3792beeed8ab2'],
];
it.each(cases)('preserves the existing Location query for %s and %s',(table,dateFilter,expected)=>{
 const sql=oneLocationBehaviorQuery({deviceKeySql,table,dateFilter});
 expect(createHash('sha256').update(sql).digest('hex')).toBe(expected);
});
