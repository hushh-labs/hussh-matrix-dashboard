# metrics.hussh.ai Development Context

## Current Product Contract

The dashboard is a public, aggregate-only operations surface. New work should preserve:

- `GET /api/health`
- `GET /api/analytics/all`
- product-specific analytics endpoints when present
- no-store/no-cache headers for live metrics APIs
- source freshness metadata for every live or pending source
- date-range support for daily reporting when the product has daily data
- neutral waiting states for missing exports or access, not raw setup errors

## Product Sources

- Hushh AI: Supabase Management API, Cloud Run Monitoring, Search Console export when tables exist, Mixpanel status when wired.
- Kai: UAT BigQuery public feed, UAT GA4 export, production Cloud Run Monitoring, production GA4 waiting until `hushh-pda.analytics_526603671` exists.
- HushhTech: public summary endpoint plus GA4/Search Console when configured.

## Development Rules

- Use `$hushh-product-metrics-dashboard` for new product metrics sections, daily reporting, DAU/MAU, funnels, growth graphs, freshness cards, and date selectors.
- Use `$senior-automation-testing` when adding API probes, UI smoke checks, production validation scripts, or CI commands.
- Use `$gcp-secret-manager` for every secret or runtime config value.
- Use `$deploy-on-main` when adding or changing automatic production deployment after merges to `main`.

## Minimum Checks Before Merge

```bash
npm run lint
npm run build
git diff --check
npm run test:prod:hushh-ai
npm run test:prod:one
```

Add a product-specific `npm run test:prod:<product>` when a new production product section is introduced.

## Privacy Boundary

Never expose:

- emails, names, phones, OTP rows, tokens, service-role keys, API secrets, raw prompts, stack traces, setup diagnostics, or financial transaction values
- person-level Supabase rows or Mixpanel user profiles
- raw provider payloads in public UI

Only expose aggregate metrics and sanitized source states.
