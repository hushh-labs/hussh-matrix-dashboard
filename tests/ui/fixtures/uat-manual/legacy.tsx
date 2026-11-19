import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {OneAppPanel} from '../../../../src/components/OneAppPanel';
function App(){const [environment,setEnvironment]=useState<'uat'|'production'>('uat'),[day,setDay]=useState('2026-11-18');return <><button onClick={()=>setEnvironment('production')}>Production</button><button onClick={()=>setEnvironment('uat')}>UAT</button><button onClick={()=>setDay('2026-11-19')}>Change date</button><OneAppPanel one={null} oneUat={null} healthMetrics={[]} rangeLabel={day} dateControl={null} locationRoute={{environment,tab:'overview'} as any} onOpenLocation={()=>{}} onCloseLocation={()=>{}} onLocationRouteChange={()=>{}} uatDetailDates={{startDate:day,endDate:day}} /></>}
createRoot(document.getElementById('root')!).render(<App/>);
