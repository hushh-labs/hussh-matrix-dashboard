/** Capture only the initial selected UAT scope of a genuine document reload. */
export function uatReloadIntent(type:string|undefined, tab:string, environment:string, range:{startDate:string;endDate:string}) {
  return type === 'reload' && tab === 'one' && environment === 'uat'
    ? {startDate:range.startDate,endDate:range.endDate} : null;
}
