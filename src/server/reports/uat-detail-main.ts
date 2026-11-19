import { createUatDetailBootstrap } from './uat-detail-bootstrap';
import { shutdownUatDetailServer } from './uat-detail-http';

// Dedicated process entrypoint; no existing web/worker startup imports it.
const port=Number(process.env.PORT ?? '8080');
if (!Number.isSafeInteger(port) || port<1 || port>65535) throw new Error('UAT listener unavailable');
const server=createUatDetailBootstrap();
server.listen(port,'0.0.0.0');
for(const signal of ['SIGTERM','SIGINT'] as const) process.once(signal,()=>{void shutdownUatDetailServer(server,5000);});
