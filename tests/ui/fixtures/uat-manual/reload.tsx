import React from 'react';
import {createRoot} from 'react-dom/client';
import {UatManualRefresh} from '../../../../src/metrics-web/app/uat-manual-refresh';
createRoot(document.getElementById('root')!).render(<React.StrictMode><UatManualRefresh enabled autoReload request={{startDate:'2026-11-18',endDate:'2026-11-18'}} /></React.StrictMode>);
