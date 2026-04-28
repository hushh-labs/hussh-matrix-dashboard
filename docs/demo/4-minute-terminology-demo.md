# Hussh Matrix Dashboard 4-Minute Terminology Demo

## Production Goal

Create a beginner-friendly 16:9 MP4 that explains the vocabulary used in the Hussh Matrix Dashboard. The video should use the actual dashboard as the visual source and define each term in plain English as it appears, with calm pacing, sparse captions, and a professional narration track.

## Audience

- New operators who need to understand the dashboard quickly.
- Managers and team leads who need plain-English confidence in the metrics.
- Engineers and technical buyers who want to know what each signal means.
- Investors or stakeholders who need the difference between product, search, database, and infrastructure metrics.

## Timing And Shots

| Time | Shot | Caption |
| --- | --- | --- |
| 0:00-0:18 | Dashboard opening and top-level view | Metrics, in Plain English |
| 0:18-0:50 | Main metric tiles and status bar | Aggregate Metrics |
| 0:50-1:22 | Kai production usage view | Sessions + Events |
| 1:22-1:56 | Kai production traffic and reliability | Requests + Error Rate |
| 1:56-2:28 | Hushh AI infrastructure section | p95 Latency + Cloud Run |
| 2:28-3:00 | HushhTech search and report totals | Impressions + CTR |
| 3:00-3:28 | HushhTech database truth metrics | Supabase + BigQuery |
| 3:28-3:48 | Platform/source health view | Source Health + Probes |
| 3:48-4:00 | Closing production URL | metrics.hushh.ai |

## Voiceover Script

Welcome to the Hussh Matrix Dashboard terminology tour. This video is for anyone new to the platform. Instead of assuming the words are already familiar, we will translate the main dashboard terms into plain English as they appear on screen.

A dashboard is one shared place to see product health. Aggregate metrics are totals, counts, and trends across many users. They are useful for teams because they explain what is happening without exposing raw personal records.

Start with sessions. A session is one visit or active period from a person using a product. If someone opens the site, looks around, leaves, and comes back later, that can become another session. Users count people or devices. Active users are people who returned within a time window. DAU, WAU, and MAU mean daily, weekly, and monthly active users.

Events are actions inside the product, like opening a page, starting onboarding, submitting a form, or using a feature. Page views are a specific kind of event: a page was seen. Engaged sessions are sessions with meaningful activity, not just a quick bounce.

Requests are infrastructure traffic. A request happens when a browser, app, or service asks the server for something: a page, an API response, a file, or a health check. Cloud Run requests tell us how much live production traffic the hosted service is handling. A non-2xx response is a request that did not return a normal success code. Error rate is the share of requests that did not succeed.

Cloud Run is the Google Cloud service that hosts the production app. It runs the container, scales it up when traffic grows, and scales it down when traffic is quiet. Instances are the running copies of that service. More instances usually mean the system is responding to more demand.

Latency means response time: how long users wait after a request is made. P95 latency means the response time for the 95th percentile. In simple terms, if p95 is 600 milliseconds, then 95 percent of requests finished in 600 milliseconds or less, while the slowest 5 percent took longer. P95 is better than only using average latency because one unusually slow request does not hide the real experience for almost everyone.

GA4 means Google Analytics 4. It is product usage analytics: users, sessions, events, devices, locations, and engagement trends. Search Console is Google search visibility data. Impressions mean the site appeared in search results. Clicks mean someone clicked that result. CTR, or click-through rate, is clicks divided by impressions.

Supabase is the database-backed product layer used for aggregate counts such as signups, profiles, onboarding, and stored product activity. BigQuery is a cloud data warehouse. A BigQuery export means analytics or search data has been copied into a place where the dashboard can query it consistently.

A funnel is a sequence of steps, such as signup, profile, onboarding, and activation. Conversion rate shows how many people moved from one step to the next. Dropoff shows where people stopped. Freshness tells us how recent the data is. A source can be live, near-live, waiting, delayed, or unavailable.

Source health is the trust layer. It shows which systems are connected and whether they are reporting cleanly. A production probe is an automated check against the real live service. No-store cache headers mean the API is designed to return fresh dashboard data instead of stale browser cache.

The big idea is simple: product metrics explain what people are doing, search metrics explain how people find the products, database metrics explain what was actually stored, and Cloud Run metrics explain whether production is healthy. Together, they make metrics.hushh.ai understandable for beginners and useful for operators, managers, engineers, buyers, and investors.

## Glossary Coverage

- Dashboard: one shared product health view.
- Aggregate metrics: totals, counts, and trends, not raw personal records.
- Sessions: visits or active periods.
- Users and active users: people or devices, filtered by time window.
- DAU, WAU, MAU: daily, weekly, and monthly active users.
- Events: product actions.
- Page views: pages seen.
- Engaged sessions: sessions with meaningful activity.
- Requests: server or API traffic.
- Cloud Run requests: production traffic handled by the hosted service.
- Non-2xx: responses that were not normal success responses.
- Error rate: failed or non-success responses divided by total requests.
- Cloud Run: Google Cloud hosting for the production app.
- Instances: running copies of the Cloud Run service.
- Latency: response time.
- P95 latency: speed at or below which 95 percent of requests finished.
- GA4: Google Analytics 4 usage analytics.
- Search Console: Google search visibility data.
- Impressions: search result appearances.
- Clicks: search result visits.
- CTR: clicks divided by impressions.
- Supabase: database-backed product counts.
- BigQuery: cloud warehouse used for consistent analytics queries.
- Funnel: ordered product journey steps.
- Conversion rate: users moving from one step to the next.
- Dropoff: users who stop before the next step.
- Freshness: how recent a source is.
- Source health: connected-source status.
- Production probe: automated verification against the live system.
- No-store cache headers: API responses designed to stay fresh.

## Render Command

```bash
swift scripts/demo-render-video.swift terminology
```

Expected output:

```text
artifacts/demo/hussh-matrix-dashboard-terminology-demo.mp4
```
