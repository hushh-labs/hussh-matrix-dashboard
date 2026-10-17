# TailAdmin metrics UI revamp

Reference: https://demo.tailadmin.com/analytics. Reviewed 17 October 2026.

## Reference audit

The static public page catalogue contains 87 linked pages; all returned HTTP 200. The audit records page titles, headings, table counts, chart containers and shared stylesheet references. Browser visual checks covered Analytics, SaaS and Basic Tables at the in-app browser mobile width. This is not a claim of visual or interaction testing of all 87 vendor pages.

Run `python scripts/audit-tailadmin-reference.py` to regenerate `.codex/artifacts/tailadmin-reference-audit.json`. The audit never executes vendor scripts or submits forms.

## Shared design

- Outfit typography, neutral canvas, bordered white cards, blue navigation and chart accents.
- 290px desktop sidebar with an optional 90px collapsed state; a focus-contained drawer below 1280px.
- Shared page heading, breadcrumb, search, refresh and account controls.
- Light/dark semantic tokens cover report surfaces, charts, controls, warnings and success states.
- Internally scrolling, keyboard-focusable tables; existing mobile feature-card views retained.
- Reduced-motion preference respected. Header and content widths remain usable down to 320px.

## Page mapping

| Hushh page | Reference pattern |
| --- | --- |
| Founder briefing | Analytics KPI row, SaaS audience trend, concise interpretation and feature table |
| Analytics overview | Analytics charts and summary cards, with source coverage behind a disclosure |
| Growth | SaaS acquisition, audience and operating-cost cards |
| Over time | Basic Tables comparison layout |
| One app | Analytics summary cards, platform reporting, retention and feature drill-downs |
| One Location | Shared layout across production/UAT overview, features, circles and journey |
| Agent details | Shared chart/table styling and mobile feature-card disclosures |
| Hushh Connect | Responsive production and UAT columns with App Store/TestFlight availability |
| Instagram | Shared cards, existing content filters, pagination and campaign-link form |
| Data sources | Platform health cards and source/activation tables |
| Sign-in/access denied | Responsive split authentication layout with the existing Google flow |
| Matrix Agent One | Shared colours and responsive chat geometry |

## Data and source use

This is a new implementation of the observed visual direction in the existing React/Tailwind/Recharts application. No TailAdmin Pro source, template asset bundle, Figma file or branding has been copied into the repository. The existing aggregate API contracts, metric definitions, missing-data states, and production/UAT separation remain in place. Synthetic browser fixtures live only in `tests/ui/fixtures.ts`; application code does not import them.

## Verification

- `npm run lint`
- `npm run build`
- `npm test`
- `npm run test:ui`
- `npm run test:ui:one-platforms`
- `npm run test:ui:agent-feature-render`
- `npm run test:routes:one-location`
- `git diff --check`

Playwright exercises the eight main pages at 320, 390, 768, 1024, 1440 and 1920px, the eight Location routes, agent drill-downs, chat sizing, sidebar/search keyboard behaviour, themes, reporting dates, missing values and Google return paths. Requests use synthetic aggregates intercepted by Playwright, so these tests establish UI behaviour rather than production data accuracy. Screenshots are saved in `.codex/artifacts/ui/`.

The `responsive-ui.yml` workflow runs type-check, build and browser checks on pull requests with synthetic data and no production credentials. The existing deploy-on-main workflow also runs these UI gates before deploying a zero-traffic candidate and retains screenshots/traces as a seven-day artifact. Its existing interactive Google sign-in requirement before production promotion is unchanged.

## Public reference page catalogue

| Page | Tables | Chart containers in HTML |
| --- | ---: | ---: |
| [404.html](https://demo.tailadmin.com/404.html) | 0 | 0 |
| [500.html](https://demo.tailadmin.com/500.html) | 0 | 0 |
| [503.html](https://demo.tailadmin.com/503.html) | 0 | 0 |
| [add-product.html](https://demo.tailadmin.com/add-product.html) | 0 | 0 |
| [ai-settings.html](https://demo.tailadmin.com/ai-settings.html) | 0 | 0 |
| [ai.html](https://demo.tailadmin.com/ai.html) | 1 | 2 |
| [alerts.html](https://demo.tailadmin.com/alerts.html) | 0 | 0 |
| [analytics.html](https://demo.tailadmin.com/analytics.html) | 1 | 4 |
| [api-keys.html](https://demo.tailadmin.com/api-keys.html) | 1 | 0 |
| [avatars.html](https://demo.tailadmin.com/avatars.html) | 0 | 0 |
| [badge.html](https://demo.tailadmin.com/badge.html) | 0 | 0 |
| [bar-chart.html](https://demo.tailadmin.com/bar-chart.html) | 0 | 6 |
| [basic-tables.html](https://demo.tailadmin.com/basic-tables.html) | 6 | 0 |
| [billing.html](https://demo.tailadmin.com/billing.html) | 1 | 0 |
| [blank.html](https://demo.tailadmin.com/blank.html) | 0 | 0 |
| [breadcrumb.html](https://demo.tailadmin.com/breadcrumb.html) | 0 | 0 |
| [buttons-group.html](https://demo.tailadmin.com/buttons-group.html) | 0 | 0 |
| [buttons.html](https://demo.tailadmin.com/buttons.html) | 0 | 0 |
| [calendar.html](https://demo.tailadmin.com/calendar.html) | 0 | 0 |
| [cards.html](https://demo.tailadmin.com/cards.html) | 0 | 0 |
| [carousel.html](https://demo.tailadmin.com/carousel.html) | 0 | 0 |
| [chat.html](https://demo.tailadmin.com/chat.html) | 0 | 0 |
| [code-generator.html](https://demo.tailadmin.com/code-generator.html) | 0 | 0 |
| [coming-soon.html](https://demo.tailadmin.com/coming-soon.html) | 0 | 0 |
| [create-invoice.html](https://demo.tailadmin.com/create-invoice.html) | 2 | 0 |
| [crm.html](https://demo.tailadmin.com/crm.html) | 1 | 3 |
| [data-tables.html](https://demo.tailadmin.com/data-tables.html) | 0 | 0 |
| [dropdowns.html](https://demo.tailadmin.com/dropdowns.html) | 0 | 0 |
| [faq.html](https://demo.tailadmin.com/faq.html) | 0 | 0 |
| [file-manager.html](https://demo.tailadmin.com/file-manager.html) | 0 | 1 |
| [finance.html](https://demo.tailadmin.com/finance.html) | 1 | 3 |
| [form-elements.html](https://demo.tailadmin.com/form-elements.html) | 0 | 0 |
| [form-layout.html](https://demo.tailadmin.com/form-layout.html) | 0 | 0 |
| [image-generator.html](https://demo.tailadmin.com/image-generator.html) | 0 | 0 |
| [images.html](https://demo.tailadmin.com/images.html) | 0 | 0 |
| [inbox-details.html](https://demo.tailadmin.com/inbox-details.html) | 0 | 0 |
| [inbox.html](https://demo.tailadmin.com/inbox.html) | 0 | 0 |
| [index.html](https://demo.tailadmin.com/index.html) | 1 | 3 |
| [integrations.html](https://demo.tailadmin.com/integrations.html) | 0 | 0 |
| [invoices.html](https://demo.tailadmin.com/invoices.html) | 1 | 0 |
| [layout-five.html](https://demo.tailadmin.com/layout-five.html) | 0 | 0 |
| [layout-four.html](https://demo.tailadmin.com/layout-four.html) | 0 | 0 |
| [layout-one.html](https://demo.tailadmin.com/layout-one.html) | 0 | 0 |
| [layout-six.html](https://demo.tailadmin.com/layout-six.html) | 0 | 0 |
| [layout-three.html](https://demo.tailadmin.com/layout-three.html) | 0 | 0 |
| [layout-two.html](https://demo.tailadmin.com/layout-two.html) | 0 | 0 |
| [line-chart.html](https://demo.tailadmin.com/line-chart.html) | 0 | 3 |
| [links.html](https://demo.tailadmin.com/links.html) | 0 | 0 |
| [list.html](https://demo.tailadmin.com/list.html) | 0 | 0 |
| [logistics.html](https://demo.tailadmin.com/logistics.html) | 1 | 1 |
| [maintenance.html](https://demo.tailadmin.com/maintenance.html) | 0 | 0 |
| [maps.html](https://demo.tailadmin.com/maps.html) | 0 | 0 |
| [marketing.html](https://demo.tailadmin.com/marketing.html) | 1 | 1 |
| [modals.html](https://demo.tailadmin.com/modals.html) | 0 | 0 |
| [notifications.html](https://demo.tailadmin.com/notifications.html) | 0 | 0 |
| [pagination.html](https://demo.tailadmin.com/pagination.html) | 0 | 0 |
| [pie-chart.html](https://demo.tailadmin.com/pie-chart.html) | 0 | 5 |
| [popovers.html](https://demo.tailadmin.com/popovers.html) | 0 | 0 |
| [pricing-tables.html](https://demo.tailadmin.com/pricing-tables.html) | 0 | 0 |
| [products-list.html](https://demo.tailadmin.com/products-list.html) | 1 | 0 |
| [profile.html](https://demo.tailadmin.com/profile.html) | 0 | 0 |
| [progress-bar.html](https://demo.tailadmin.com/progress-bar.html) | 0 | 0 |
| [radar-chart.html](https://demo.tailadmin.com/radar-chart.html) | 0 | 3 |
| [radial-chart.html](https://demo.tailadmin.com/radial-chart.html) | 0 | 4 |
| [reset-password.html](https://demo.tailadmin.com/reset-password.html) | 0 | 0 |
| [ribbons.html](https://demo.tailadmin.com/ribbons.html) | 0 | 0 |
| [saas.html](https://demo.tailadmin.com/saas.html) | 1 | 6 |
| [sales.html](https://demo.tailadmin.com/sales.html) | 2 | 3 |
| [signin.html](https://demo.tailadmin.com/signin.html) | 0 | 0 |
| [signup.html](https://demo.tailadmin.com/signup.html) | 0 | 0 |
| [single-invoice.html](https://demo.tailadmin.com/single-invoice.html) | 1 | 0 |
| [single-transaction.html](https://demo.tailadmin.com/single-transaction.html) | 1 | 0 |
| [spinners.html](https://demo.tailadmin.com/spinners.html) | 0 | 0 |
| [stocks.html](https://demo.tailadmin.com/stocks.html) | 1 | 2 |
| [success.html](https://demo.tailadmin.com/success.html) | 0 | 0 |
| [support-ticket-reply.html](https://demo.tailadmin.com/support-ticket-reply.html) | 0 | 0 |
| [support-tickets.html](https://demo.tailadmin.com/support-tickets.html) | 1 | 0 |
| [tabs.html](https://demo.tailadmin.com/tabs.html) | 0 | 0 |
| [task-kanban.html](https://demo.tailadmin.com/task-kanban.html) | 0 | 0 |
| [task-list.html](https://demo.tailadmin.com/task-list.html) | 0 | 0 |
| [text-generator.html](https://demo.tailadmin.com/text-generator.html) | 0 | 0 |
| [tooltips.html](https://demo.tailadmin.com/tooltips.html) | 0 | 0 |
| [transactions.html](https://demo.tailadmin.com/transactions.html) | 1 | 0 |
| [two-step-verification.html](https://demo.tailadmin.com/two-step-verification.html) | 0 | 0 |
| [vector-maps.html](https://demo.tailadmin.com/vector-maps.html) | 0 | 0 |
| [video-generator.html](https://demo.tailadmin.com/video-generator.html) | 0 | 0 |
| [videos.html](https://demo.tailadmin.com/videos.html) | 0 | 0 |


## Founder wording and daily reporting follow-up

Visible headings and explanations use accounts, devices, visits, actions and results. Each page includes a short optional reading guide; feature tracking details remain available in disclosures. Production and test analytics stay separate, including the unavailable-test-data state.

The briefing supports an exact completed day, previous/next day, the latest completed day, custom ranges and calendar months. Its daily table exposes the same account/action series as the existing chart. Other product date controls support exact-day requests through their existing query parameters.

One and every agent detail show a daily device comparison using the existing capability daily series. Missing dates, untracked capabilities and failed daily reads are unavailable, never inferred as zero. Previous-day percentages require a nonzero baseline; recent days carry a provisional-data notice. These device comparisons do not claim unique daily people, diagnose causes, or change account KPIs. The only server change adds `capabilityDailyAvailable` from the existing query result; SQL, metric calculations, event classifications and authentication are unchanged.

Release validation includes 155 unit tests, responsive page and nested-route checks, date request assertions, real-zero/missing-data comparisons, production/test separation, Instagram controls, campaign links and a mocked chat round trip. Production accuracy is checked separately by the deployment reconciliation probes.
