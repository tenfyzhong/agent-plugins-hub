# Sending agent usage metrics to Grafana Cloud

This guide configures Grafana Alloy to forward the agent-usage-exporter metrics
to a Grafana Cloud stack over Prometheus remote write. It uses
[`alloy/config.alloy`](alloy/config.alloy) and
[`alloy/config.env.sample`](alloy/config.env.sample).

## 1. Find your endpoint and username

In the grafana.com portal, open your stack. Two values matter, and they are
**not** the same:

| What | Where to find it | Shape |
| --- | --- | --- |
| Prometheus metrics instance ID (remote-write username) | Stack → "Send metrics" instructions, or the Grafana Cloud Prometheus data source URL host | `<prometheus-instance-id>` (digits) |
| Remote-write URL | The same host as the data source URL, with the path `/api/prom/push` | `https://prometheus-prod-<N>-prod-<region>.grafana.net/api/prom/push` |

> The Prometheus metrics instance ID is **not** the OTLP instance ID used for
> OTLP ingestion (for example `GRAFANA_CLOUD_INSTANCE_ID`). Using the OTLP
> instance ID as the remote-write username fails with HTTP 401
> "invalid authentication credentials".

## 2. Create a credential

Use an access policy token:

1. Security → Access Policies → create a policy with scope **`metrics:write`**
   and a realm covering your stack (for example "All stacks").
2. **Create token** from that policy.
3. If you later edit the policy, create a **new** token — an existing token
   keeps the permissions it was created with.

## 3. Configure Alloy

Create `config.env` from the sample and fill in the three values:

```env
AGENT_USAGE_PROMETHEUS_URL=https://prometheus-prod-<N>-prod-<region>.grafana.net/api/prom/push
AGENT_USAGE_PROMETHEUS_USERNAME=<prometheus-instance-id>
AGENT_USAGE_PROMETHEUS_PASSWORD=<access-policy-token>
```

Copy `config.alloy` next to it. On macOS with the Homebrew formula the files
live in `/opt/homebrew/etc/alloy/`; the wrapper sources `config.env` on start,
so restart Alloy after changing either file:

```bash
brew services restart grafana/grafana/alloy
```

If Alloy is not installed yet, install the tap formula first, then start it:

```bash
brew install grafana/grafana/alloy
brew services start grafana/grafana/alloy
```

## 4. Verify

- Alloy log shows the remote-write component starting with your URL.
- Grafana → Explore → your Grafana Cloud Prometheus data source → query
  `agent_usage_tokens` and `agent_usage_cost_usd` over the last hour.
- Or import the ready-made
  [`dashboards/agent-usage.json`](dashboards/agent-usage.json) dashboard
  (Dashboards → Import → upload the file → pick the Prometheus data source).
- Labels: `agent`, `model`, `token_type`, `project`. Query per-project spend
  with `sum by (project) (agent_usage_cost_usd)`.
- Cost values are USD per million tokens (the bundled DeepSeek rates were
  converted from CNY at 6.74 CNY/USD on 2026-08-14); the metric name
  `agent_usage_cost_usd` matches the unit.

## 5. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| 401 "invalid authentication credentials" | remote-write username is the OTLP instance ID | Use the Prometheus metrics instance ID from step 1 |
| 401 with the correct username | credential lacks remote-write permission | Access policy token needs scope `metrics:write` and a realm covering the stack; regenerate the token after policy changes |
| 530, "error code: 1016" | hostname does not exist (for example a bare `<instance-id>.grafana.net`) | Use the `prometheus-prod-<N>-prod-<region>` host from the data source URL or the portal |
| Series only under `agent_usage_tokens_total` / `agent_usage_cost_usd_USD_total` | metrics were ingested through the OTLP gateway, which translates names | Either query the translated names, or switch to this remote-write route (`add_metric_suffixes = false` keeps the clean names); the two routes produce separate series |

If you previously used OTLP ingestion, its series keep the translated names and
stop growing after you switch to remote write.
