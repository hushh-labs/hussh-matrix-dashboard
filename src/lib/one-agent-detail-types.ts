/** Serializable report shape shared with presentation; validation remains server-side. */
export type OneAgentDetailV1 = { version:'1'; environment:'production'|'uat'; scopeDigest:string; manifestDigest:string;
  period:{startDate:string;endDate:string;timezone:string}; source:{kind:'ga4_export';coverage:'intraday_or_unknown';watermark:string|null;checkedAt:string|null};
  rows:Array<{agent:string;key:string;state:'measured'|'unavailable'|'not_tracked';counts:{accounts:number|null;devices:number|null;signals:number|null;
    successes:number|null;expectedErrors:number|null;failures:number|null;outcomeSignals:number|null}|null;
    eventBreakdown:Array<{eventName:string;signals:number;successes:number;expectedErrors:number;failures:number}>|null}> };
