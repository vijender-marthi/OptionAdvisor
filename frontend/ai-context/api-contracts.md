# API Contracts

## TradeRecommendation
| Field | Type | Description |
|---|---|---|
| id | string | Unique identifier |
| ticker | string | Ticker symbol |
| engine_type | string | `day`, `swing`, `regular` |
| strategy | string | Strategy name |
| direction | string | `long`/`short` |
| signal | string | Market signal |
| confidence | number | 0‑1 confidence score |
| entry_zone | string | Suggested entry zone |
| target | number | Target price |
| stop_loss | number | Stop‑loss price |
| expiry | string | Expiry date |
| reason | string | Rationale |
| risk_level | string | Risk tier |
| action_label | string | Label for UI action |

## Alert
| Field | Type | Description |
|---|---|---|
| id | string |
| ticker | string |
| alert_type | string |
| severity | string |
| engine_type | string |
| message | string |
| recommended_action | string |
| status | string |
| created_at | string |

## Position
| Field | Type | Description |
|---|---|---|
| id | string |
| ticker | string |
| strategy | string |
| engine_source | string |
| entry_date | string |
| expiry | string |
| contracts | number |
| shares | number |
| entry_price | number |
| current_price | number |
| pnl_amount | number |
| pnl_percent | number |
| target | number |
| stop_loss | number |
| risk_status | string |
| recommended_action | string |

## WatchlistItem
| Field | Type | Description |
|---|---|---|
| id | string |
| ticker | string |
| watch_reason | string |
| engine_source | string |
| desired_entry | string |
| current_price | number |
| distance_to_entry | number |
| signal | string |
| alert_status | string |
| last_updated | string |
