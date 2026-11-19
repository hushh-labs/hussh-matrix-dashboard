# Private UAT detail worker (disabled by default)

`npm run metrics:uat-detail-worker` invokes the separate UAT-only listener. It refuses startup without the explicit listener/service/detail flags and fixed service configuration. Starting the process alone does not read Firestore, contact identity or submit warehouse/queue work. The listener authenticates the fixed web or task service account before constructing the runtime, which independently rechecks identity and approved policies. Cloud ingress, IAM, source identity, policy and cost budgets must be independently qualified before enabling it.

The dispatcher endpoint currently fails closed. This entrypoint alone does not provide an operational end-to-end refresh. Shutdown aborts in-flight requests and bounds connection draining; already dispatched operations remain uncertain and require their durable reconciliation. Slow-body tests are synthetic, not production ingress qualification.
