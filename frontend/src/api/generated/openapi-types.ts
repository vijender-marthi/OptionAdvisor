/* eslint-disable */
/**
 * Generated from FastAPI OpenAPI.
 *
 * Source: frontend/src/api/generated/openapi.json
 * Generator: frontend/scripts/generate-openapi-types.mjs
 *
 * Do not edit by hand. Run `npm --prefix frontend run generate:openapi`.
 */

export type ApiHttpMethod = "delete" | "get" | "patch" | "post" | "put"

export type ApiPath = "/" | "/api/admin/db-check" | "/api/admin/flush-cache" | "/api/admin/set-role" | "/api/alerts" | "/api/alerts/clear" | "/api/alerts/scan" | "/api/alerts/summary" | "/api/alerts/{alert_id}/acknowledge" | "/api/alerts/{alert_id}/note" | "/api/alerts/{alert_id}/resolve" | "/api/analyze" | "/api/auth/activate" | "/api/auth/forgot-password" | "/api/auth/google" | "/api/auth/login" | "/api/auth/register" | "/api/auth/reset-password" | "/api/backtest" | "/api/cache/clear" | "/api/carry-trade" | "/api/cycle-tracker" | "/api/dashboard-tickers" | "/api/day-trade" | "/api/day-trade-alerts/{email}" | "/api/day-trade/check" | "/api/day-trade/overnight-runner" | "/api/day-trade/workspace" | "/api/desk/alerts" | "/api/desk/alerts/count" | "/api/desk/alerts/history" | "/api/desk/alerts/{alert_id}" | "/api/desk/alerts/{alert_id}/fire" | "/api/desk/analysis/{ticker}" | "/api/desk/trades" | "/api/desk/trades/open" | "/api/desk/trades/stats" | "/api/desk/trades/{trade_id}" | "/api/desk/watchlist" | "/api/desk/watchlist/{ticker}" | "/api/early-entry-trigger" | "/api/email-status" | "/api/eod-journal/{email}/dates" | "/api/eod-journal/{email}/snapshot" | "/api/eod-journal/{email}/snapshot/{mode}/{date_key}/{ticker}" | "/api/exit-signals" | "/api/exit-signals/acknowledge" | "/api/health" | "/api/history-bars" | "/api/investment-thesis/starter/{ticker}" | "/api/journal/refresh/{email}" | "/api/journal/save" | "/api/journal/{email}" | "/api/journal/{email}/{entry_id}" | "/api/journal/{email}/{entry_id}/close" | "/api/journal/{email}/{entry_id}/notes" | "/api/journal/{email}/{entry_id}/update" | "/api/market-position" | "/api/my-tickers" | "/api/my-tickers/reorder" | "/api/my-tickers/{symbol}" | "/api/my-tickers/{symbol}/type/{trade_type}" | "/api/option-chain/{ticker}" | "/api/portfolio/add" | "/api/portfolio/close" | "/api/portfolio/remove" | "/api/portfolio/update" | "/api/portfolio/update-note" | "/api/positions-center" | "/api/premarket-bias" | "/api/search-tickers" | "/api/send-alert" | "/api/signal-feed" | "/api/signal-feed/alerts" | "/api/signal-feed/refresh" | "/api/stock-targets" | "/api/swing-trade" | "/api/test-email" | "/api/track-mode" | "/api/track-mode/add" | "/api/track-mode/remove" | "/api/trade-command-center" | "/api/trade-dashboard/story" | "/api/trade-ideas/{email}" | "/api/trade-ideas/{email}/{idea_id}" | "/api/trade-worksheet/evaluate" | "/api/trades/active" | "/api/trades/enter" | "/api/trades/{trade_id}/decision" | "/api/trades/{trade_id}/exit" | "/api/trading/cancel" | "/api/trading/close" | "/api/trading/execute" | "/api/trading/orders" | "/api/trading/positions" | "/api/trading/status" | "/api/user-data/{email}" | "/api/user/accent" | "/api/v1/calculation-run-types" | "/api/v1/calculation-runs" | "/api/v1/calculation-runs/{run_id}" | "/api/v1/calculation-snapshots/{snapshot_id}" | "/api/v1/calculation-snapshots/{snapshot_id}/audit-log" | "/api/v1/calculation-snapshots/{snapshot_id}/integrity" | "/api/v1/metric-definitions" | "/api/v2/analyze/{ticker}" | "/api/v2/analyze/{ticker}/public" | "/api/watchlist/add" | "/api/watchlist/remove" | "/backtest"

export type ApiOperationId = "acknowledge_exit_signal_api_exit_signals_acknowledge_post" | "active_trade_decision_one_api_trades__trade_id__decision_get" | "active_trade_enter_api_trades_enter_post" | "active_trade_exit_api_api_trades__trade_id__exit_post" | "active_trades_list_api_trades_active_get" | "add_to_watchlist_api_desk_watchlist_post" | "admin_db_check_api_admin_db_check_get" | "admin_flush_cache_api_admin_flush_cache_post" | "admin_set_role_api_admin_set_role_post" | "alert_count_api_desk_alerts_count_get" | "alert_history_api_desk_alerts_history_get" | "analyze_api_analyze_post" | "api_get_dashboard_tickers_api_dashboard_tickers_get" | "api_save_dashboard_tickers_api_dashboard_tickers_post" | "auth_activate_api_auth_activate_get" | "auth_forgot_password_api_auth_forgot_password_post" | "auth_google_api_auth_google_post" | "auth_login_api_auth_login_post" | "auth_register_api_auth_register_post" | "auth_reset_password_api_auth_reset_password_post" | "backtest_strategy_api_backtest_post" | "backtest_strategy_proxy_alias_backtest_post" | "calculation_run_api_v1_calculation_runs__run_id__get" | "calculation_run_types_api_v1_calculation_run_types_get" | "calculation_runs_api_v1_calculation_runs_get" | "calculation_snapshot_api_v1_calculation_snapshots__snapshot_id__get" | "calculation_snapshot_audit_log_api_v1_calculation_snapshots__snapshot_id__audit_log_get" | "calculation_snapshot_integrity_api_v1_calculation_snapshots__snapshot_id__integrity_get" | "carry_trade_scan_api_carry_trade_post" | "clear_all_caches_api_cache_clear_post" | "create_alert_api_desk_alerts_post" | "create_calculation_run_v1_api_v1_calculation_runs_post" | "create_signal_feed_alert_api_signal_feed_alerts_post" | "create_trade_api_desk_trades_post" | "create_trade_idea_api_trade_ideas__email__post" | "day_trade_check_api_day_trade_check_post" | "day_trade_scan_api_day_trade_post" | "day_trade_workspace_api_day_trade_workspace_get" | "delete_alert_api_desk_alerts__alert_id__delete" | "delete_my_ticker_api_my_tickers__symbol__delete" | "delete_my_ticker_type_api_my_tickers__symbol__type__trade_type__delete" | "delete_trade_api_desk_trades__trade_id__delete" | "delete_trade_idea_endpoint_api_trade_ideas__email___idea_id__delete" | "email_status_api_email_status_get" | "eod_journal_dates_api_eod_journal__email__dates_get" | "eod_journal_get_snapshot_api_eod_journal__email__snapshot__mode___date_key___ticker__get" | "eod_journal_save_snapshot_api_eod_journal__email__snapshot_post" | "exit_signals_api_exit_signals_get" | "fire_alert_api_desk_alerts__alert_id__fire_patch" | "get_analysis_api_desk_analysis__ticker__get" | "get_cycle_tracker_api_cycle_tracker_get" | "get_early_entry_trigger_api_early_entry_trigger_get" | "get_history_bars_api_history_bars_get" | "get_market_position_api_market_position_get" | "get_my_tickers_api_my_tickers_get" | "get_positions_center_api_positions_center_get" | "get_premarket_bias_api_premarket_bias_get" | "get_signal_feed_api_signal_feed_get" | "get_stock_targets_api_stock_targets_get" | "get_track_mode_api_track_mode_get" | "get_trade_command_center_api_trade_command_center_get" | "get_trade_stats_api_desk_trades_stats_get" | "get_user_accent_api_user_accent_get" | "get_user_data_api_user_data__email__get" | "get_watchlist_api_desk_watchlist_get" | "health_check_api_health_get" | "investment_thesis_starter_api_investment_thesis_starter__ticker__get" | "journal_close_api_journal__email___entry_id__close_patch" | "journal_delete_api_journal__email___entry_id__delete" | "journal_list_api_journal__email__get" | "journal_notes_api_journal__email___entry_id__notes_patch" | "journal_refresh_api_journal_refresh__email__post" | "journal_save_api_journal_save_post" | "journal_update_api_journal__email___entry_id__update_patch" | "list_alerts_api_desk_alerts_get" | "list_alerts_center_api_alerts_get" | "list_alerts_summary_api_alerts_summary_get" | "list_day_trade_alerts_api_api_day_trade_alerts__email__get" | "list_open_trades_api_desk_trades_open_get" | "list_trade_ideas_api_trade_ideas__email__get" | "list_trades_api_desk_trades_get" | "metric_definitions_api_v1_metric_definitions_get" | "option_chain_liquidity_api_option_chain__ticker__get" | "patch_my_ticker_api_my_tickers__symbol__patch" | "patch_trade_idea_api_trade_ideas__email___idea_id__patch" | "post_alert_acknowledge_api_alerts__alert_id__acknowledge_post" | "post_alert_note_api_alerts__alert_id__note_post" | "post_alert_resolve_api_alerts__alert_id__resolve_post" | "post_alerts_clear_api_alerts_clear_post" | "post_my_ticker_api_my_tickers_post" | "post_overnight_runner_api_day_trade_overnight_runner_post" | "post_portfolio_add_api_portfolio_add_post" | "post_portfolio_close_api_portfolio_close_post" | "post_portfolio_remove_api_portfolio_remove_post" | "post_portfolio_update_api_portfolio_update_post" | "post_portfolio_update_note_api_portfolio_update_note_post" | "post_track_mode_add_api_track_mode_add_post" | "post_track_mode_remove_api_track_mode_remove_post" | "post_watchlist_add_api_watchlist_add_post" | "post_watchlist_remove_api_watchlist_remove_post" | "put_my_tickers_reorder_api_my_tickers_reorder_put" | "refresh_signal_feed_api_signal_feed_refresh_post" | "remove_from_watchlist_api_desk_watchlist__ticker__delete" | "root__get" | "save_user_data_api_user_data__email__put" | "scan_alerts_center_api_alerts_scan_post" | "search_tickers_api_search_tickers_get" | "send_alert_api_send_alert_post" | "send_test_email_api_test_email_post" | "set_user_accent_api_user_accent_put" | "swing_trade_scan_api_swing_trade_post" | "trade_dashboard_story_api_trade_dashboard_story_post" | "trade_worksheet_evaluate_api_trade_worksheet_evaluate_post" | "trading_cancel_api_trading_cancel_post" | "trading_close_position_api_trading_close_post" | "trading_execute_api_trading_execute_post" | "trading_orders_api_trading_orders_get" | "trading_positions_api_trading_positions_get" | "trading_status_api_trading_status_get" | "unified_analyze_api_v2_analyze__ticker__get" | "unified_analyze_public_api_v2_analyze__ticker__public_get" | "update_alert_api_desk_alerts__alert_id__patch" | "update_trade_api_desk_trades__trade_id__patch"

export type ApiOperation = {
  readonly method: ApiHttpMethod
  readonly path: ApiPath
  readonly operationId: ApiOperationId
  readonly tags: readonly string[]
  readonly summary: string
}

export const API_OPERATIONS = [
  {
    "method": "get",
    "path": "/",
    "operationId": "root__get",
    "tags": [],
    "summary": "Root"
  },
  {
    "method": "get",
    "path": "/api/admin/db-check",
    "operationId": "admin_db_check_api_admin_db_check_get",
    "tags": [],
    "summary": "Admin Db Check"
  },
  {
    "method": "post",
    "path": "/api/admin/flush-cache",
    "operationId": "admin_flush_cache_api_admin_flush_cache_post",
    "tags": [],
    "summary": "Admin Flush Cache"
  },
  {
    "method": "post",
    "path": "/api/admin/set-role",
    "operationId": "admin_set_role_api_admin_set_role_post",
    "tags": [],
    "summary": "Admin Set Role"
  },
  {
    "method": "get",
    "path": "/api/alerts",
    "operationId": "list_alerts_center_api_alerts_get",
    "tags": [
      "command-center"
    ],
    "summary": "List Alerts Center"
  },
  {
    "method": "post",
    "path": "/api/alerts/clear",
    "operationId": "post_alerts_clear_api_alerts_clear_post",
    "tags": [
      "command-center"
    ],
    "summary": "Post Alerts Clear"
  },
  {
    "method": "post",
    "path": "/api/alerts/scan",
    "operationId": "scan_alerts_center_api_alerts_scan_post",
    "tags": [
      "command-center"
    ],
    "summary": "Scan Alerts Center"
  },
  {
    "method": "get",
    "path": "/api/alerts/summary",
    "operationId": "list_alerts_summary_api_alerts_summary_get",
    "tags": [
      "command-center"
    ],
    "summary": "List Alerts Summary"
  },
  {
    "method": "post",
    "path": "/api/alerts/{alert_id}/acknowledge",
    "operationId": "post_alert_acknowledge_api_alerts__alert_id__acknowledge_post",
    "tags": [
      "command-center"
    ],
    "summary": "Post Alert Acknowledge"
  },
  {
    "method": "post",
    "path": "/api/alerts/{alert_id}/note",
    "operationId": "post_alert_note_api_alerts__alert_id__note_post",
    "tags": [
      "command-center"
    ],
    "summary": "Post Alert Note"
  },
  {
    "method": "post",
    "path": "/api/alerts/{alert_id}/resolve",
    "operationId": "post_alert_resolve_api_alerts__alert_id__resolve_post",
    "tags": [
      "command-center"
    ],
    "summary": "Post Alert Resolve"
  },
  {
    "method": "post",
    "path": "/api/analyze",
    "operationId": "analyze_api_analyze_post",
    "tags": [],
    "summary": "Analyze"
  },
  {
    "method": "get",
    "path": "/api/auth/activate",
    "operationId": "auth_activate_api_auth_activate_get",
    "tags": [
      "auth"
    ],
    "summary": "Auth Activate"
  },
  {
    "method": "post",
    "path": "/api/auth/forgot-password",
    "operationId": "auth_forgot_password_api_auth_forgot_password_post",
    "tags": [
      "auth"
    ],
    "summary": "Auth Forgot Password"
  },
  {
    "method": "post",
    "path": "/api/auth/google",
    "operationId": "auth_google_api_auth_google_post",
    "tags": [
      "auth"
    ],
    "summary": "Auth Google"
  },
  {
    "method": "post",
    "path": "/api/auth/login",
    "operationId": "auth_login_api_auth_login_post",
    "tags": [
      "auth"
    ],
    "summary": "Auth Login"
  },
  {
    "method": "post",
    "path": "/api/auth/register",
    "operationId": "auth_register_api_auth_register_post",
    "tags": [
      "auth"
    ],
    "summary": "Auth Register"
  },
  {
    "method": "post",
    "path": "/api/auth/reset-password",
    "operationId": "auth_reset_password_api_auth_reset_password_post",
    "tags": [
      "auth"
    ],
    "summary": "Auth Reset Password"
  },
  {
    "method": "post",
    "path": "/api/backtest",
    "operationId": "backtest_strategy_api_backtest_post",
    "tags": [],
    "summary": "Backtest Strategy"
  },
  {
    "method": "post",
    "path": "/api/cache/clear",
    "operationId": "clear_all_caches_api_cache_clear_post",
    "tags": [],
    "summary": "Clear All Caches"
  },
  {
    "method": "post",
    "path": "/api/carry-trade",
    "operationId": "carry_trade_scan_api_carry_trade_post",
    "tags": [],
    "summary": "Carry Trade Scan"
  },
  {
    "method": "get",
    "path": "/api/cycle-tracker",
    "operationId": "get_cycle_tracker_api_cycle_tracker_get",
    "tags": [
      "command-center"
    ],
    "summary": "Get Cycle Tracker"
  },
  {
    "method": "get",
    "path": "/api/dashboard-tickers",
    "operationId": "api_get_dashboard_tickers_api_dashboard_tickers_get",
    "tags": [],
    "summary": "Api Get Dashboard Tickers"
  },
  {
    "method": "post",
    "path": "/api/dashboard-tickers",
    "operationId": "api_save_dashboard_tickers_api_dashboard_tickers_post",
    "tags": [],
    "summary": "Api Save Dashboard Tickers"
  },
  {
    "method": "post",
    "path": "/api/day-trade",
    "operationId": "day_trade_scan_api_day_trade_post",
    "tags": [],
    "summary": "Day Trade Scan"
  },
  {
    "method": "get",
    "path": "/api/day-trade-alerts/{email}",
    "operationId": "list_day_trade_alerts_api_api_day_trade_alerts__email__get",
    "tags": [],
    "summary": "List Day Trade Alerts Api"
  },
  {
    "method": "post",
    "path": "/api/day-trade/check",
    "operationId": "day_trade_check_api_day_trade_check_post",
    "tags": [],
    "summary": "Day Trade Check"
  },
  {
    "method": "post",
    "path": "/api/day-trade/overnight-runner",
    "operationId": "post_overnight_runner_api_day_trade_overnight_runner_post",
    "tags": [
      "command-center"
    ],
    "summary": "Post Overnight Runner"
  },
  {
    "method": "get",
    "path": "/api/day-trade/workspace",
    "operationId": "day_trade_workspace_api_day_trade_workspace_get",
    "tags": [],
    "summary": "Day Trade Workspace"
  },
  {
    "method": "get",
    "path": "/api/desk/alerts",
    "operationId": "list_alerts_api_desk_alerts_get",
    "tags": [
      "tradedesk"
    ],
    "summary": "List Alerts"
  },
  {
    "method": "post",
    "path": "/api/desk/alerts",
    "operationId": "create_alert_api_desk_alerts_post",
    "tags": [
      "tradedesk"
    ],
    "summary": "Create Alert"
  },
  {
    "method": "get",
    "path": "/api/desk/alerts/count",
    "operationId": "alert_count_api_desk_alerts_count_get",
    "tags": [
      "tradedesk"
    ],
    "summary": "Alert Count"
  },
  {
    "method": "get",
    "path": "/api/desk/alerts/history",
    "operationId": "alert_history_api_desk_alerts_history_get",
    "tags": [
      "tradedesk"
    ],
    "summary": "Alert History"
  },
  {
    "method": "delete",
    "path": "/api/desk/alerts/{alert_id}",
    "operationId": "delete_alert_api_desk_alerts__alert_id__delete",
    "tags": [
      "tradedesk"
    ],
    "summary": "Delete Alert"
  },
  {
    "method": "patch",
    "path": "/api/desk/alerts/{alert_id}",
    "operationId": "update_alert_api_desk_alerts__alert_id__patch",
    "tags": [
      "tradedesk"
    ],
    "summary": "Update Alert"
  },
  {
    "method": "patch",
    "path": "/api/desk/alerts/{alert_id}/fire",
    "operationId": "fire_alert_api_desk_alerts__alert_id__fire_patch",
    "tags": [
      "tradedesk"
    ],
    "summary": "Fire Alert"
  },
  {
    "method": "get",
    "path": "/api/desk/analysis/{ticker}",
    "operationId": "get_analysis_api_desk_analysis__ticker__get",
    "tags": [
      "tradedesk"
    ],
    "summary": "Get Analysis"
  },
  {
    "method": "get",
    "path": "/api/desk/trades",
    "operationId": "list_trades_api_desk_trades_get",
    "tags": [
      "tradedesk"
    ],
    "summary": "List Trades"
  },
  {
    "method": "post",
    "path": "/api/desk/trades",
    "operationId": "create_trade_api_desk_trades_post",
    "tags": [
      "tradedesk"
    ],
    "summary": "Create Trade"
  },
  {
    "method": "get",
    "path": "/api/desk/trades/open",
    "operationId": "list_open_trades_api_desk_trades_open_get",
    "tags": [
      "tradedesk"
    ],
    "summary": "List Open Trades"
  },
  {
    "method": "get",
    "path": "/api/desk/trades/stats",
    "operationId": "get_trade_stats_api_desk_trades_stats_get",
    "tags": [
      "tradedesk"
    ],
    "summary": "Get Trade Stats"
  },
  {
    "method": "delete",
    "path": "/api/desk/trades/{trade_id}",
    "operationId": "delete_trade_api_desk_trades__trade_id__delete",
    "tags": [
      "tradedesk"
    ],
    "summary": "Delete Trade"
  },
  {
    "method": "patch",
    "path": "/api/desk/trades/{trade_id}",
    "operationId": "update_trade_api_desk_trades__trade_id__patch",
    "tags": [
      "tradedesk"
    ],
    "summary": "Update Trade"
  },
  {
    "method": "get",
    "path": "/api/desk/watchlist",
    "operationId": "get_watchlist_api_desk_watchlist_get",
    "tags": [
      "tradedesk"
    ],
    "summary": "Get Watchlist"
  },
  {
    "method": "post",
    "path": "/api/desk/watchlist",
    "operationId": "add_to_watchlist_api_desk_watchlist_post",
    "tags": [
      "tradedesk"
    ],
    "summary": "Add To Watchlist"
  },
  {
    "method": "delete",
    "path": "/api/desk/watchlist/{ticker}",
    "operationId": "remove_from_watchlist_api_desk_watchlist__ticker__delete",
    "tags": [
      "tradedesk"
    ],
    "summary": "Remove From Watchlist"
  },
  {
    "method": "get",
    "path": "/api/early-entry-trigger",
    "operationId": "get_early_entry_trigger_api_early_entry_trigger_get",
    "tags": [
      "command-center"
    ],
    "summary": "Get Early Entry Trigger"
  },
  {
    "method": "get",
    "path": "/api/email-status",
    "operationId": "email_status_api_email_status_get",
    "tags": [],
    "summary": "Email Status"
  },
  {
    "method": "get",
    "path": "/api/eod-journal/{email}/dates",
    "operationId": "eod_journal_dates_api_eod_journal__email__dates_get",
    "tags": [],
    "summary": "Eod Journal Dates"
  },
  {
    "method": "post",
    "path": "/api/eod-journal/{email}/snapshot",
    "operationId": "eod_journal_save_snapshot_api_eod_journal__email__snapshot_post",
    "tags": [],
    "summary": "Eod Journal Save Snapshot"
  },
  {
    "method": "get",
    "path": "/api/eod-journal/{email}/snapshot/{mode}/{date_key}/{ticker}",
    "operationId": "eod_journal_get_snapshot_api_eod_journal__email__snapshot__mode___date_key___ticker__get",
    "tags": [],
    "summary": "Eod Journal Get Snapshot"
  },
  {
    "method": "get",
    "path": "/api/exit-signals",
    "operationId": "exit_signals_api_exit_signals_get",
    "tags": [],
    "summary": "Exit Signals"
  },
  {
    "method": "post",
    "path": "/api/exit-signals/acknowledge",
    "operationId": "acknowledge_exit_signal_api_exit_signals_acknowledge_post",
    "tags": [],
    "summary": "Acknowledge Exit Signal"
  },
  {
    "method": "get",
    "path": "/api/health",
    "operationId": "health_check_api_health_get",
    "tags": [],
    "summary": "Health Check"
  },
  {
    "method": "get",
    "path": "/api/history-bars",
    "operationId": "get_history_bars_api_history_bars_get",
    "tags": [],
    "summary": "Get History Bars"
  },
  {
    "method": "get",
    "path": "/api/investment-thesis/starter/{ticker}",
    "operationId": "investment_thesis_starter_api_investment_thesis_starter__ticker__get",
    "tags": [],
    "summary": "Investment Thesis Starter"
  },
  {
    "method": "post",
    "path": "/api/journal/refresh/{email}",
    "operationId": "journal_refresh_api_journal_refresh__email__post",
    "tags": [],
    "summary": "Journal Refresh"
  },
  {
    "method": "post",
    "path": "/api/journal/save",
    "operationId": "journal_save_api_journal_save_post",
    "tags": [],
    "summary": "Journal Save"
  },
  {
    "method": "get",
    "path": "/api/journal/{email}",
    "operationId": "journal_list_api_journal__email__get",
    "tags": [],
    "summary": "Journal List"
  },
  {
    "method": "delete",
    "path": "/api/journal/{email}/{entry_id}",
    "operationId": "journal_delete_api_journal__email___entry_id__delete",
    "tags": [],
    "summary": "Journal Delete"
  },
  {
    "method": "patch",
    "path": "/api/journal/{email}/{entry_id}/close",
    "operationId": "journal_close_api_journal__email___entry_id__close_patch",
    "tags": [],
    "summary": "Journal Close"
  },
  {
    "method": "patch",
    "path": "/api/journal/{email}/{entry_id}/notes",
    "operationId": "journal_notes_api_journal__email___entry_id__notes_patch",
    "tags": [],
    "summary": "Journal Notes"
  },
  {
    "method": "patch",
    "path": "/api/journal/{email}/{entry_id}/update",
    "operationId": "journal_update_api_journal__email___entry_id__update_patch",
    "tags": [],
    "summary": "Journal Update"
  },
  {
    "method": "get",
    "path": "/api/market-position",
    "operationId": "get_market_position_api_market_position_get",
    "tags": [
      "command-center"
    ],
    "summary": "Get Market Position"
  },
  {
    "method": "get",
    "path": "/api/my-tickers",
    "operationId": "get_my_tickers_api_my_tickers_get",
    "tags": [
      "command-center"
    ],
    "summary": "Get My Tickers"
  },
  {
    "method": "post",
    "path": "/api/my-tickers",
    "operationId": "post_my_ticker_api_my_tickers_post",
    "tags": [
      "command-center"
    ],
    "summary": "Post My Ticker"
  },
  {
    "method": "put",
    "path": "/api/my-tickers/reorder",
    "operationId": "put_my_tickers_reorder_api_my_tickers_reorder_put",
    "tags": [
      "command-center"
    ],
    "summary": "Put My Tickers Reorder"
  },
  {
    "method": "delete",
    "path": "/api/my-tickers/{symbol}",
    "operationId": "delete_my_ticker_api_my_tickers__symbol__delete",
    "tags": [
      "command-center"
    ],
    "summary": "Delete My Ticker"
  },
  {
    "method": "patch",
    "path": "/api/my-tickers/{symbol}",
    "operationId": "patch_my_ticker_api_my_tickers__symbol__patch",
    "tags": [
      "command-center"
    ],
    "summary": "Patch My Ticker"
  },
  {
    "method": "delete",
    "path": "/api/my-tickers/{symbol}/type/{trade_type}",
    "operationId": "delete_my_ticker_type_api_my_tickers__symbol__type__trade_type__delete",
    "tags": [
      "command-center"
    ],
    "summary": "Delete My Ticker Type"
  },
  {
    "method": "get",
    "path": "/api/option-chain/{ticker}",
    "operationId": "option_chain_liquidity_api_option_chain__ticker__get",
    "tags": [],
    "summary": "Option Chain Liquidity"
  },
  {
    "method": "post",
    "path": "/api/portfolio/add",
    "operationId": "post_portfolio_add_api_portfolio_add_post",
    "tags": [
      "command-center"
    ],
    "summary": "Post Portfolio Add"
  },
  {
    "method": "post",
    "path": "/api/portfolio/close",
    "operationId": "post_portfolio_close_api_portfolio_close_post",
    "tags": [
      "command-center"
    ],
    "summary": "Post Portfolio Close"
  },
  {
    "method": "post",
    "path": "/api/portfolio/remove",
    "operationId": "post_portfolio_remove_api_portfolio_remove_post",
    "tags": [
      "command-center"
    ],
    "summary": "Post Portfolio Remove"
  },
  {
    "method": "post",
    "path": "/api/portfolio/update",
    "operationId": "post_portfolio_update_api_portfolio_update_post",
    "tags": [
      "command-center"
    ],
    "summary": "Post Portfolio Update"
  },
  {
    "method": "post",
    "path": "/api/portfolio/update-note",
    "operationId": "post_portfolio_update_note_api_portfolio_update_note_post",
    "tags": [
      "command-center"
    ],
    "summary": "Post Portfolio Update Note"
  },
  {
    "method": "get",
    "path": "/api/positions-center",
    "operationId": "get_positions_center_api_positions_center_get",
    "tags": [
      "command-center"
    ],
    "summary": "Get Positions Center"
  },
  {
    "method": "get",
    "path": "/api/premarket-bias",
    "operationId": "get_premarket_bias_api_premarket_bias_get",
    "tags": [
      "command-center"
    ],
    "summary": "Get Premarket Bias"
  },
  {
    "method": "get",
    "path": "/api/search-tickers",
    "operationId": "search_tickers_api_search_tickers_get",
    "tags": [
      "command-center"
    ],
    "summary": "Search Tickers"
  },
  {
    "method": "post",
    "path": "/api/send-alert",
    "operationId": "send_alert_api_send_alert_post",
    "tags": [],
    "summary": "Send Alert"
  },
  {
    "method": "get",
    "path": "/api/signal-feed",
    "operationId": "get_signal_feed_api_signal_feed_get",
    "tags": [],
    "summary": "Get Signal Feed"
  },
  {
    "method": "post",
    "path": "/api/signal-feed/alerts",
    "operationId": "create_signal_feed_alert_api_signal_feed_alerts_post",
    "tags": [],
    "summary": "Create Signal Feed Alert"
  },
  {
    "method": "post",
    "path": "/api/signal-feed/refresh",
    "operationId": "refresh_signal_feed_api_signal_feed_refresh_post",
    "tags": [],
    "summary": "Refresh Signal Feed"
  },
  {
    "method": "get",
    "path": "/api/stock-targets",
    "operationId": "get_stock_targets_api_stock_targets_get",
    "tags": [
      "command-center"
    ],
    "summary": "Get Stock Targets"
  },
  {
    "method": "post",
    "path": "/api/swing-trade",
    "operationId": "swing_trade_scan_api_swing_trade_post",
    "tags": [],
    "summary": "Swing Trade Scan"
  },
  {
    "method": "post",
    "path": "/api/test-email",
    "operationId": "send_test_email_api_test_email_post",
    "tags": [],
    "summary": "Send Test Email"
  },
  {
    "method": "get",
    "path": "/api/track-mode",
    "operationId": "get_track_mode_api_track_mode_get",
    "tags": [
      "command-center"
    ],
    "summary": "Get Track Mode"
  },
  {
    "method": "post",
    "path": "/api/track-mode/add",
    "operationId": "post_track_mode_add_api_track_mode_add_post",
    "tags": [
      "command-center"
    ],
    "summary": "Post Track Mode Add"
  },
  {
    "method": "post",
    "path": "/api/track-mode/remove",
    "operationId": "post_track_mode_remove_api_track_mode_remove_post",
    "tags": [
      "command-center"
    ],
    "summary": "Post Track Mode Remove"
  },
  {
    "method": "get",
    "path": "/api/trade-command-center",
    "operationId": "get_trade_command_center_api_trade_command_center_get",
    "tags": [
      "command-center"
    ],
    "summary": "Get Trade Command Center"
  },
  {
    "method": "post",
    "path": "/api/trade-dashboard/story",
    "operationId": "trade_dashboard_story_api_trade_dashboard_story_post",
    "tags": [],
    "summary": "Trade Dashboard Story"
  },
  {
    "method": "get",
    "path": "/api/trade-ideas/{email}",
    "operationId": "list_trade_ideas_api_trade_ideas__email__get",
    "tags": [],
    "summary": "List Trade Ideas"
  },
  {
    "method": "post",
    "path": "/api/trade-ideas/{email}",
    "operationId": "create_trade_idea_api_trade_ideas__email__post",
    "tags": [],
    "summary": "Create Trade Idea"
  },
  {
    "method": "delete",
    "path": "/api/trade-ideas/{email}/{idea_id}",
    "operationId": "delete_trade_idea_endpoint_api_trade_ideas__email___idea_id__delete",
    "tags": [],
    "summary": "Delete Trade Idea Endpoint"
  },
  {
    "method": "patch",
    "path": "/api/trade-ideas/{email}/{idea_id}",
    "operationId": "patch_trade_idea_api_trade_ideas__email___idea_id__patch",
    "tags": [],
    "summary": "Patch Trade Idea"
  },
  {
    "method": "post",
    "path": "/api/trade-worksheet/evaluate",
    "operationId": "trade_worksheet_evaluate_api_trade_worksheet_evaluate_post",
    "tags": [],
    "summary": "Trade Worksheet Evaluate"
  },
  {
    "method": "get",
    "path": "/api/trades/active",
    "operationId": "active_trades_list_api_trades_active_get",
    "tags": [],
    "summary": "Active Trades List"
  },
  {
    "method": "post",
    "path": "/api/trades/enter",
    "operationId": "active_trade_enter_api_trades_enter_post",
    "tags": [],
    "summary": "Active Trade Enter"
  },
  {
    "method": "get",
    "path": "/api/trades/{trade_id}/decision",
    "operationId": "active_trade_decision_one_api_trades__trade_id__decision_get",
    "tags": [],
    "summary": "Active Trade Decision One"
  },
  {
    "method": "post",
    "path": "/api/trades/{trade_id}/exit",
    "operationId": "active_trade_exit_api_api_trades__trade_id__exit_post",
    "tags": [],
    "summary": "Active Trade Exit Api"
  },
  {
    "method": "post",
    "path": "/api/trading/cancel",
    "operationId": "trading_cancel_api_trading_cancel_post",
    "tags": [],
    "summary": "Trading Cancel"
  },
  {
    "method": "post",
    "path": "/api/trading/close",
    "operationId": "trading_close_position_api_trading_close_post",
    "tags": [],
    "summary": "Trading Close Position"
  },
  {
    "method": "post",
    "path": "/api/trading/execute",
    "operationId": "trading_execute_api_trading_execute_post",
    "tags": [],
    "summary": "Trading Execute"
  },
  {
    "method": "get",
    "path": "/api/trading/orders",
    "operationId": "trading_orders_api_trading_orders_get",
    "tags": [],
    "summary": "Trading Orders"
  },
  {
    "method": "get",
    "path": "/api/trading/positions",
    "operationId": "trading_positions_api_trading_positions_get",
    "tags": [],
    "summary": "Trading Positions"
  },
  {
    "method": "get",
    "path": "/api/trading/status",
    "operationId": "trading_status_api_trading_status_get",
    "tags": [],
    "summary": "Trading Status"
  },
  {
    "method": "get",
    "path": "/api/user-data/{email}",
    "operationId": "get_user_data_api_user_data__email__get",
    "tags": [],
    "summary": "Get User Data"
  },
  {
    "method": "put",
    "path": "/api/user-data/{email}",
    "operationId": "save_user_data_api_user_data__email__put",
    "tags": [],
    "summary": "Save User Data"
  },
  {
    "method": "get",
    "path": "/api/user/accent",
    "operationId": "get_user_accent_api_user_accent_get",
    "tags": [],
    "summary": "Get User Accent"
  },
  {
    "method": "put",
    "path": "/api/user/accent",
    "operationId": "set_user_accent_api_user_accent_put",
    "tags": [],
    "summary": "Set User Accent"
  },
  {
    "method": "get",
    "path": "/api/v1/calculation-run-types",
    "operationId": "calculation_run_types_api_v1_calculation_run_types_get",
    "tags": [],
    "summary": "Calculation Run Types"
  },
  {
    "method": "get",
    "path": "/api/v1/calculation-runs",
    "operationId": "calculation_runs_api_v1_calculation_runs_get",
    "tags": [],
    "summary": "Calculation Runs"
  },
  {
    "method": "post",
    "path": "/api/v1/calculation-runs",
    "operationId": "create_calculation_run_v1_api_v1_calculation_runs_post",
    "tags": [],
    "summary": "Create Calculation Run V1"
  },
  {
    "method": "get",
    "path": "/api/v1/calculation-runs/{run_id}",
    "operationId": "calculation_run_api_v1_calculation_runs__run_id__get",
    "tags": [],
    "summary": "Calculation Run"
  },
  {
    "method": "get",
    "path": "/api/v1/calculation-snapshots/{snapshot_id}",
    "operationId": "calculation_snapshot_api_v1_calculation_snapshots__snapshot_id__get",
    "tags": [],
    "summary": "Calculation Snapshot"
  },
  {
    "method": "get",
    "path": "/api/v1/calculation-snapshots/{snapshot_id}/audit-log",
    "operationId": "calculation_snapshot_audit_log_api_v1_calculation_snapshots__snapshot_id__audit_log_get",
    "tags": [],
    "summary": "Calculation Snapshot Audit Log"
  },
  {
    "method": "get",
    "path": "/api/v1/calculation-snapshots/{snapshot_id}/integrity",
    "operationId": "calculation_snapshot_integrity_api_v1_calculation_snapshots__snapshot_id__integrity_get",
    "tags": [],
    "summary": "Calculation Snapshot Integrity"
  },
  {
    "method": "get",
    "path": "/api/v1/metric-definitions",
    "operationId": "metric_definitions_api_v1_metric_definitions_get",
    "tags": [],
    "summary": "Metric Definitions"
  },
  {
    "method": "get",
    "path": "/api/v2/analyze/{ticker}",
    "operationId": "unified_analyze_api_v2_analyze__ticker__get",
    "tags": [],
    "summary": "Unified Analyze"
  },
  {
    "method": "get",
    "path": "/api/v2/analyze/{ticker}/public",
    "operationId": "unified_analyze_public_api_v2_analyze__ticker__public_get",
    "tags": [],
    "summary": "Unified Analyze Public"
  },
  {
    "method": "post",
    "path": "/api/watchlist/add",
    "operationId": "post_watchlist_add_api_watchlist_add_post",
    "tags": [
      "command-center"
    ],
    "summary": "Post Watchlist Add"
  },
  {
    "method": "post",
    "path": "/api/watchlist/remove",
    "operationId": "post_watchlist_remove_api_watchlist_remove_post",
    "tags": [
      "command-center"
    ],
    "summary": "Post Watchlist Remove"
  },
  {
    "method": "post",
    "path": "/backtest",
    "operationId": "backtest_strategy_proxy_alias_backtest_post",
    "tags": [],
    "summary": "Backtest Strategy Proxy Alias"
  }
] as const satisfies readonly ApiOperation[]

export const API_OPERATION_BY_ID = Object.fromEntries(
  API_OPERATIONS.map(operation => [operation.operationId, operation]),
) as unknown as Record<ApiOperationId, ApiOperation>

export const API_PATHS = [
  "/",
  "/api/admin/db-check",
  "/api/admin/flush-cache",
  "/api/admin/set-role",
  "/api/alerts",
  "/api/alerts/clear",
  "/api/alerts/scan",
  "/api/alerts/summary",
  "/api/alerts/{alert_id}/acknowledge",
  "/api/alerts/{alert_id}/note",
  "/api/alerts/{alert_id}/resolve",
  "/api/analyze",
  "/api/auth/activate",
  "/api/auth/forgot-password",
  "/api/auth/google",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/reset-password",
  "/api/backtest",
  "/api/cache/clear",
  "/api/carry-trade",
  "/api/cycle-tracker",
  "/api/dashboard-tickers",
  "/api/day-trade",
  "/api/day-trade-alerts/{email}",
  "/api/day-trade/check",
  "/api/day-trade/overnight-runner",
  "/api/day-trade/workspace",
  "/api/desk/alerts",
  "/api/desk/alerts/count",
  "/api/desk/alerts/history",
  "/api/desk/alerts/{alert_id}",
  "/api/desk/alerts/{alert_id}/fire",
  "/api/desk/analysis/{ticker}",
  "/api/desk/trades",
  "/api/desk/trades/open",
  "/api/desk/trades/stats",
  "/api/desk/trades/{trade_id}",
  "/api/desk/watchlist",
  "/api/desk/watchlist/{ticker}",
  "/api/early-entry-trigger",
  "/api/email-status",
  "/api/eod-journal/{email}/dates",
  "/api/eod-journal/{email}/snapshot",
  "/api/eod-journal/{email}/snapshot/{mode}/{date_key}/{ticker}",
  "/api/exit-signals",
  "/api/exit-signals/acknowledge",
  "/api/health",
  "/api/history-bars",
  "/api/investment-thesis/starter/{ticker}",
  "/api/journal/refresh/{email}",
  "/api/journal/save",
  "/api/journal/{email}",
  "/api/journal/{email}/{entry_id}",
  "/api/journal/{email}/{entry_id}/close",
  "/api/journal/{email}/{entry_id}/notes",
  "/api/journal/{email}/{entry_id}/update",
  "/api/market-position",
  "/api/my-tickers",
  "/api/my-tickers/reorder",
  "/api/my-tickers/{symbol}",
  "/api/my-tickers/{symbol}/type/{trade_type}",
  "/api/option-chain/{ticker}",
  "/api/portfolio/add",
  "/api/portfolio/close",
  "/api/portfolio/remove",
  "/api/portfolio/update",
  "/api/portfolio/update-note",
  "/api/positions-center",
  "/api/premarket-bias",
  "/api/search-tickers",
  "/api/send-alert",
  "/api/signal-feed",
  "/api/signal-feed/alerts",
  "/api/signal-feed/refresh",
  "/api/stock-targets",
  "/api/swing-trade",
  "/api/test-email",
  "/api/track-mode",
  "/api/track-mode/add",
  "/api/track-mode/remove",
  "/api/trade-command-center",
  "/api/trade-dashboard/story",
  "/api/trade-ideas/{email}",
  "/api/trade-ideas/{email}/{idea_id}",
  "/api/trade-worksheet/evaluate",
  "/api/trades/active",
  "/api/trades/enter",
  "/api/trades/{trade_id}/decision",
  "/api/trades/{trade_id}/exit",
  "/api/trading/cancel",
  "/api/trading/close",
  "/api/trading/execute",
  "/api/trading/orders",
  "/api/trading/positions",
  "/api/trading/status",
  "/api/user-data/{email}",
  "/api/user/accent",
  "/api/v1/calculation-run-types",
  "/api/v1/calculation-runs",
  "/api/v1/calculation-runs/{run_id}",
  "/api/v1/calculation-snapshots/{snapshot_id}",
  "/api/v1/calculation-snapshots/{snapshot_id}/audit-log",
  "/api/v1/calculation-snapshots/{snapshot_id}/integrity",
  "/api/v1/metric-definitions",
  "/api/v2/analyze/{ticker}",
  "/api/v2/analyze/{ticker}/public",
  "/api/watchlist/add",
  "/api/watchlist/remove",
  "/backtest"
] as const satisfies readonly ApiPath[]
