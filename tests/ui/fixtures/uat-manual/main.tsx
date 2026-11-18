import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {UatManualRefresh} from '../../../../src/metrics-web/app/uat-manual-refresh';
function App(){const [day,setDay]=useState('2026-11-18');return <><button onClick={()=>setDay('2026-11-19')}>Change date</button><UatManualRefresh enabled request={{reportId:'one.agent-detail-uat',startDate:day,endDate:day,timezone:'UTC'}}/></>;}
createRoot(document.getElementById('root')!).render(<App/>);

