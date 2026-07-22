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

export type ApiPath = "/" | "/api/admin/db-check" | "/api/admin/flush-cache" | "/api/admin/set-role" | "/api/alerts" | "/api/alerts/clear" | "/api/alerts/scan" | "/api/alerts/summary" | "/api/alerts/{alert_id}/acknowledge" | "/api/alerts/{alert_id}/note" | "/api/alerts/{alert_id}/resolve" | "/api/analyze" | "/api/auth/activate" | "/api/auth/forgot-password" | "/api/auth/google" | "/api/auth/login" | "/api/auth/register" | "/api/auth/reset-password" | "/api/backtest" | "/api/cache/clear" | "/api/carry-trade" | "/api/cycle-tracker" | "/api/dashboard-tickers" | "/api/day-trade" | "/api/day-trade-alerts/{email}" | "/api/day-trade/check" | "/api/day-trade/overnight-runner" | "/api/day-trade/workspace" | "/api/desk/alerts" | "/api/desk/alerts/count" | "/api/desk/alerts/history" | "/api/desk/alerts/{alert_id}" | "/api/desk/alerts/{alert_id}/fire" | "/api/desk/analysis/{ticker}" | "/api/desk/trades" | "/api/desk/trades/open" | "/api/desk/trades/stats" | "/api/desk/trades/{trade_id}" | "/api/desk/watchlist" | "/api/desk/watchlist/{ticker}" | "/api/early-entry-trigger" | "/api/email-status" | "/api/eod-journal/{email}/dates" | "/api/eod-journal/{email}/snapshot" | "/api/eod-journal/{email}/snapshot/{mode}/{date_key}/{ticker}" | "/api/exit-signals" | "/api/exit-signals/acknowledge" | "/api/health" | "/api/history-bars" | "/api/investment-thesis/starter/{ticker}" | "/api/journal/history-log" | "/api/journal/history-log/auto-generate" | "/api/journal/history-morning-check" | "/api/journal/refresh/{email}" | "/api/journal/save" | "/api/journal/{email}" | "/api/journal/{email}/{entry_id}" | "/api/journal/{email}/{entry_id}/close" | "/api/journal/{email}/{entry_id}/notes" | "/api/journal/{email}/{entry_id}/update" | "/api/market-position" | "/api/my-tickers" | "/api/my-tickers/reorder" | "/api/my-tickers/{symbol}" | "/api/my-tickers/{symbol}/type/{trade_type}" | "/api/option-chain/{ticker}" | "/api/portfolio/add" | "/api/portfolio/close" | "/api/portfolio/parse-contract" | "/api/portfolio/remove" | "/api/portfolio/update" | "/api/portfolio/update-note" | "/api/position-trade/session-chart" | "/api/positions-center" | "/api/premarket-bias" | "/api/search-tickers" | "/api/send-alert" | "/api/signal-feed" | "/api/signal-feed/alerts" | "/api/signal-feed/refresh" | "/api/stock-targets" | "/api/swing-trade" | "/api/test-email" | "/api/track-mode" | "/api/track-mode/add" | "/api/track-mode/remove" | "/api/trade-command-center" | "/api/trade-dashboard/story" | "/api/trade-ideas/{email}" | "/api/trade-ideas/{email}/{idea_id}" | "/api/trade-worksheet/evaluate" | "/api/trades/active" | "/api/trades/enter" | "/api/trades/{trade_id}/decision" | "/api/trades/{trade_id}/exit" | "/api/trading/cancel" | "/api/trading/close" | "/api/trading/execute" | "/api/trading/orders" | "/api/trading/positions" | "/api/trading/status" | "/api/user-data/{email}" | "/api/user/accent" | "/api/v1/calculation-run-types" | "/api/v1/calculation-runs" | "/api/v1/calculation-runs/{run_id}" | "/api/v1/calculation-snapshots/{snapshot_id}" | "/api/v1/calculation-snapshots/{snapshot_id}/audit-log" | "/api/v1/calculation-snapshots/{snapshot_id}/integrity" | "/api/v1/metric-definitions" | "/api/v2/analyze/{ticker}" | "/api/v2/analyze/{ticker}/public" | "/api/watchlist/add" | "/api/watchlist/remove" | "/backtest"

export type ApiOperationId = "acknowledge_exit_signal_api_exit_signals_acknowledge_post" | "active_trade_decision_one_api_trades__trade_id__decision_get" | "active_trade_enter_api_trades_enter_post" | "active_trade_exit_api_api_trades__trade_id__exit_post" | "active_trades_list_api_trades_active_get" | "add_to_watchlist_api_desk_watchlist_post" | "admin_db_check_api_admin_db_check_get" | "admin_flush_cache_api_admin_flush_cache_post" | "admin_set_role_api_admin_set_role_post" | "alert_count_api_desk_alerts_count_get" | "alert_history_api_desk_alerts_history_get" | "analyze_api_analyze_post" | "api_get_dashboard_tickers_api_dashboard_tickers_get" | "api_save_dashboard_tickers_api_dashboard_tickers_post" | "auth_activate_api_auth_activate_get" | "auth_forgot_password_api_auth_forgot_password_post" | "auth_google_api_auth_google_post" | "auth_login_api_auth_login_post" | "auth_register_api_auth_register_post" | "auth_reset_password_api_auth_reset_password_post" | "backtest_strategy_api_backtest_post" | "backtest_strategy_proxy_alias_backtest_post" | "calculation_run_api_v1_calculation_runs__run_id__get" | "calculation_run_types_api_v1_calculation_run_types_get" | "calculation_runs_api_v1_calculation_runs_get" | "calculation_snapshot_api_v1_calculation_snapshots__snapshot_id__get" | "calculation_snapshot_audit_log_api_v1_calculation_snapshots__snapshot_id__audit_log_get" | "calculation_snapshot_integrity_api_v1_calculation_snapshots__snapshot_id__integrity_get" | "carry_trade_scan_api_carry_trade_post" | "clear_all_caches_api_cache_clear_post" | "create_alert_api_desk_alerts_post" | "create_calculation_run_v1_api_v1_calculation_runs_post" | "create_signal_feed_alert_api_signal_feed_alerts_post" | "create_trade_api_desk_trades_post" | "create_trade_idea_api_trade_ideas__email__post" | "day_trade_check_api_day_trade_check_post" | "day_trade_scan_api_day_trade_post" | "day_trade_workspace_api_day_trade_workspace_get" | "delete_alert_api_desk_alerts__alert_id__delete" | "delete_my_ticker_api_my_tickers__symbol__delete" | "delete_my_ticker_type_api_my_tickers__symbol__type__trade_type__delete" | "delete_trade_api_desk_trades__trade_id__delete" | "delete_trade_idea_endpoint_api_trade_ideas__email___idea_id__delete" | "email_status_api_email_status_get" | "eod_journal_dates_api_eod_journal__email__dates_get" | "eod_journal_get_snapshot_api_eod_journal__email__snapshot__mode___date_key___ticker__get" | "eod_journal_save_snapshot_api_eod_journal__email__snapshot_post" | "exit_signals_api_exit_signals_get" | "fire_alert_api_desk_alerts__alert_id__fire_patch" | "get_analysis_api_desk_analysis__ticker__get" | "get_cycle_tracker_api_cycle_tracker_get" | "get_early_entry_trigger_api_early_entry_trigger_get" | "get_history_bars_api_history_bars_get" | "get_market_position_api_market_position_get" | "get_my_tickers_api_my_tickers_get" | "get_positions_center_api_positions_center_get" | "get_premarket_bias_api_premarket_bias_get" | "get_signal_feed_api_signal_feed_get" | "get_stock_targets_api_stock_targets_get" | "get_track_mode_api_track_mode_get" | "get_trade_command_center_api_trade_command_center_get" | "get_trade_stats_api_desk_trades_stats_get" | "get_user_accent_api_user_accent_get" | "get_user_data_api_user_data__email__get" | "get_watchlist_api_desk_watchlist_get" | "health_check_api_health_get" | "investment_thesis_starter_api_investment_thesis_starter__ticker__get" | "journal_close_api_journal__email___entry_id__close_patch" | "journal_delete_api_journal__email___entry_id__delete" | "journal_history_log_api_journal_history_log_get" | "journal_history_log_auto_generate_api_journal_history_log_auto_generate_post" | "journal_history_morning_check_api_journal_history_morning_check_post" | "journal_list_api_journal__email__get" | "journal_notes_api_journal__email___entry_id__notes_patch" | "journal_refresh_api_journal_refresh__email__post" | "journal_save_api_journal_save_post" | "journal_update_api_journal__email___entry_id__update_patch" | "list_alerts_api_desk_alerts_get" | "list_alerts_center_api_alerts_get" | "list_alerts_summary_api_alerts_summary_get" | "list_day_trade_alerts_api_api_day_trade_alerts__email__get" | "list_open_trades_api_desk_trades_open_get" | "list_trade_ideas_api_trade_ideas__email__get" | "list_trades_api_desk_trades_get" | "metric_definitions_api_v1_metric_definitions_get" | "option_chain_liquidity_api_option_chain__ticker__get" | "patch_my_ticker_api_my_tickers__symbol__patch" | "patch_trade_idea_api_trade_ideas__email___idea_id__patch" | "position_trade_session_chart_api_position_trade_session_chart_get" | "post_alert_acknowledge_api_alerts__alert_id__acknowledge_post" | "post_alert_note_api_alerts__alert_id__note_post" | "post_alert_resolve_api_alerts__alert_id__resolve_post" | "post_alerts_clear_api_alerts_clear_post" | "post_my_ticker_api_my_tickers_post" | "post_overnight_runner_api_day_trade_overnight_runner_post" | "post_portfolio_add_api_portfolio_add_post" | "post_portfolio_close_api_portfolio_close_post" | "post_portfolio_parse_contract_api_portfolio_parse_contract_post" | "post_portfolio_remove_api_portfolio_remove_post" | "post_portfolio_update_api_portfolio_update_post" | "post_portfolio_update_note_api_portfolio_update_note_post" | "post_track_mode_add_api_track_mode_add_post" | "post_track_mode_remove_api_track_mode_remove_post" | "post_watchlist_add_api_watchlist_add_post" | "post_watchlist_remove_api_watchlist_remove_post" | "put_my_tickers_reorder_api_my_tickers_reorder_put" | "refresh_signal_feed_api_signal_feed_refresh_post" | "remove_from_watchlist_api_desk_watchlist__ticker__delete" | "root__get" | "save_user_data_api_user_data__email__put" | "scan_alerts_center_api_alerts_scan_post" | "search_tickers_api_search_tickers_get" | "send_alert_api_send_alert_post" | "send_test_email_api_test_email_post" | "set_user_accent_api_user_accent_put" | "swing_trade_scan_api_swing_trade_post" | "trade_dashboard_story_api_trade_dashboard_story_post" | "trade_worksheet_evaluate_api_trade_worksheet_evaluate_post" | "trading_cancel_api_trading_cancel_post" | "trading_close_position_api_trading_close_post" | "trading_execute_api_trading_execute_post" | "trading_orders_api_trading_orders_get" | "trading_positions_api_trading_positions_get" | "trading_status_api_trading_status_get" | "unified_analyze_api_v2_analyze__ticker__get" | "unified_analyze_public_api_v2_analyze__ticker__public_get" | "update_alert_api_desk_alerts__alert_id__patch" | "update_trade_api_desk_trades__trade_id__patch"

export type ApiSchemaName = "ActiveTradeEnterRequest" | "ActiveTradeEnterResponse" | "ActiveTradeListResponse" | "ActiveTradeOut" | "AlertCreate" | "AlertEmailRequest" | "AlertItem" | "AlertNoteBody" | "AnalyzeRequest" | "AnalyzeResponse" | "AuthActivateResponse" | "AuthForgotPasswordResponse" | "AuthRegisterResponse" | "AuthResetPasswordResponse" | "AuthSessionResponse" | "BacktestRequest" | "BrokerContractParseBody" | "CalculationRunCreateRequest" | "CalculationRunCreateResponse" | "CalculationRunResponse" | "CalculationRunTypeResponse" | "CalculationRunTypesResponse" | "CalculationRunsListResponse" | "CalculationSnapshotAuditEventResponse" | "CalculationSnapshotAuditLogResponse" | "CalculationSnapshotIntegrityResponse" | "CalculationSnapshotResponse" | "CarryTradeRequest" | "CarryTradeResponse" | "DayTradeAiCoachView" | "DayTradeChartCandleView" | "DayTradeChartDefaultsView" | "DayTradeChartEventView" | "DayTradeChartLevelView" | "DayTradeChartTradeFocusView" | "DayTradeChartView" | "DayTradeConfidenceView" | "DayTradeCurrentActionView" | "DayTradeCurrentStateView" | "DayTradeDecisionChangeView" | "DayTradeDecisionEngineView" | "DayTradeDecisionHierarchyView" | "DayTradeDecisionView" | "DayTradeDisplayStatus" | "DayTradeDisplayValue" | "DayTradeEngineScoresView" | "DayTradeEvidenceItemView" | "DayTradeExpectedStructureOptionView" | "DayTradeExpectedStructureView" | "DayTradeMarketContextView" | "DayTradeMarketStructureView" | "DayTradeMetricView" | "DayTradeNextOpportunityView" | "DayTradeProfessionalDecisionView" | "DayTradeReasoningEngineView" | "DayTradeRequest" | "DayTradeResponse" | "DayTradeRewardRiskView" | "DayTradeRiskDecisionView" | "DayTradeRiskPlanView" | "DayTradeSelectedContractView" | "DayTradeSessionView" | "DayTradeSetupLifecycleView" | "DayTradeStructurePivotView" | "DayTradeSymbolView" | "DayTradeTimelineEventView" | "DayTradeTrendHealthView" | "DayTradeTriggerRequirementView" | "DayTradeTriggerView" | "DayTradeVwapOverlayView" | "DayTradeVwapPointView" | "DayTradeWorkspaceAction" | "DayTradeWorkspaceResponse" | "EodJournalSnapshotRequest" | "ExitSignalAckBody" | "ForgotPasswordRequest" | "GoogleAuthRequest" | "HTTPValidationError" | "JournalCloseRequest" | "JournalHistoryMorningRequest" | "JournalHistoryMorningRow" | "JournalHistoryScenarioCheck" | "JournalNotesRequest" | "JournalSaveRequest" | "JournalUpdateRequest" | "KeyLevelOut" | "LoginRequest" | "MetricDefinitionOut" | "MetricDefinitionsResponse" | "MyTickerBody" | "MyTickerUpdateBody" | "MyTickersReorderBody" | "OptionChainLiquidityResponse" | "OptionChainLiquidityRow" | "OptionLegOut" | "OptionRowOut" | "OptionsFlowOut" | "OvernightRunnerRequest" | "OvernightRunnerResponse" | "PortfolioAddBody" | "PortfolioCloseBody" | "PortfolioNoteBody" | "PortfolioRemoveBody" | "PortfolioUpdateBody" | "PricePoint" | "QuoteQualitySummary" | "RecommendationOut" | "RegisterRequest" | "ResetPasswordRequest" | "ScoreBreakdown" | "SignalFeedAlertCreateBody" | "SignalsOut" | "SwingTradeRequest" | "SwingTradeResponse" | "TestEmailRequest" | "TrackModeAddBody" | "TrackModeRemoveBody" | "TradeCheckRequest" | "TradeDashboardStoryRequest" | "TradeIdeaCreateRequest" | "TradeIdeaUpdateRequest" | "TradeLogCreate" | "TradeLogUpdate" | "TradeWorksheetEvaluateRequest" | "TradeWorksheetSelectedRow" | "TradingCancelRequest" | "TradingCloseRequest" | "TradingExecuteRequest" | "UserDataRequest" | "UserDataResponse" | "ValidationError" | "WatchlistAddRequest" | "WatchlistTickerBody"

export type ApiSchemas = {
  readonly "ActiveTradeEnterRequest": {
    readonly "contracts"?: number | null
    readonly "entry_price": number
    readonly "entry_underlying_px"?: number | null
    readonly "expiry"?: string | null
    readonly "notes"?: string | null
    readonly "side": string
    readonly "strike"?: number | null
    readonly "ticker": string
    readonly "trade_type"?: string
  }
  readonly "ActiveTradeEnterResponse": {
    readonly "contracts"?: number | null
    readonly "entry_price": number
    readonly "entry_underlying_px"?: number | null
    readonly "expiry"?: string | null
    readonly "id": string
    readonly "notes"?: string
    readonly "opened_at_ms": number
    readonly "side": string
    readonly "strike"?: number | null
    readonly "ticker": string
  }
  readonly "ActiveTradeListResponse": {
    readonly "included_opened_before_today"?: boolean
    readonly "trades": Array<ApiSchemas["ActiveTradeOut"]>
  }
  readonly "ActiveTradeOut": {
    readonly "contracts"?: number | null
    readonly "decision"?: Record<string, unknown>
    readonly "entry_price": number
    readonly "entry_underlying_px"?: number | null
    readonly "exited_at_ms"?: number | null
    readonly "expiry"?: string | null
    readonly "id": string
    readonly "intraday_error"?: string | null
    readonly "metrics"?: Record<string, unknown>
    readonly "notes"?: string
    readonly "opened_at_ms": number
    readonly "side": string
    readonly "strike"?: number | null
    readonly "ticker": string
    readonly "trade_type"?: string
  }
  readonly "AlertCreate": {
    readonly "alert_type": string
    readonly "expires"?: string
    readonly "notify_method"?: string
    readonly "target_signal"?: string
    readonly "threshold_value"?: number | null
    readonly "ticker": string
    readonly "trade_type"?: string
  }
  readonly "AlertEmailRequest": {
    readonly "alerts": Array<ApiSchemas["AlertItem"]>
    readonly "email": string
    readonly "user_name"?: string | null
  }
  readonly "AlertItem": {
    readonly "bias": string
    readonly "company_name": string
    readonly "dte": number
    readonly "ev": number
    readonly "expiry": string
    readonly "max_loss": number
    readonly "max_profit": number
    readonly "net_credit": number
    readonly "pop": number
    readonly "score": number
    readonly "strategy": string
    readonly "ticker": string
    readonly "time_window": string
    readonly "weeks_out": number
  }
  readonly "AlertNoteBody": {
    readonly "text": string
  }
  readonly "AnalyzeRequest": {
    readonly "chain_expiry"?: string | null
    readonly "spread_width"?: number | null
    readonly "strategy_mode"?: string
    readonly "ticker": string
    readonly "weeks_out"?: number
  }
  readonly "AnalyzeResponse": {
    readonly "calls_chain": Array<ApiSchemas["OptionRowOut"]>
    readonly "company_name": string
    readonly "confidence"?: number
    readonly "display_confidence"?: number
    readonly "execution_fields"?: Array<Record<string, unknown>>
    readonly "explanation"?: Record<string, unknown>
    readonly "filters_applied": Record<string, unknown>
    readonly "key_levels"?: Array<ApiSchemas["KeyLevelOut"]>
    readonly "market_bias"?: string
    readonly "market_cap": string
    readonly "missing_confirmations"?: Array<string>
    readonly "options_flow"?: ApiSchemas["OptionsFlowOut"]
    readonly "price_history": Array<ApiSchemas["PricePoint"]>
    readonly "puts_chain": Array<ApiSchemas["OptionRowOut"]>
    readonly "quote_quality_summary"?: ApiSchemas["QuoteQualitySummary"]
    readonly "reason"?: string
    readonly "recommendations": Array<ApiSchemas["RecommendationOut"]>
    readonly "risk_reason"?: string
    readonly "risk_state"?: string
    readonly "sector": string
    readonly "setup_quality"?: string
    readonly "signals": ApiSchemas["SignalsOut"]
    readonly "supporting_factors"?: Array<string>
    readonly "ticker": string
    readonly "verdict"?: string
  }
  readonly "AuthActivateResponse": {
    readonly "email": string
    readonly "message": string
    readonly "ok": boolean
  }
  readonly "AuthForgotPasswordResponse": {
    readonly "dev_reset_token"?: string | null
    readonly "message": string
    readonly "ok": boolean
  }
  readonly "AuthRegisterResponse": {
    readonly "message": string
    readonly "needs_activation": boolean
    readonly "ok": boolean
  }
  readonly "AuthResetPasswordResponse": {
    readonly "message": string
    readonly "ok": boolean
  }
  readonly "AuthSessionResponse": {
    readonly "access_token": string
    readonly "email": string
    readonly "name": string
    readonly "role": string
    readonly "token_type": string
  }
  readonly "BacktestRequest": {
    readonly "end_date": string
    readonly "spread_width"?: number | null
    readonly "start_date": string
    readonly "strategy_mode"?: string
    readonly "ticker": string
    readonly "weeks_out"?: number
  }
  readonly "BrokerContractParseBody": {
    readonly "text": string
    readonly "trade_source"?: string
  }
  readonly "CalculationRunCreateRequest": {
    readonly "input"?: Record<string, unknown>
    readonly "runType": string
  }
  readonly "CalculationRunCreateResponse": {
    readonly "result"?: Record<string, unknown>
    readonly "run": ApiSchemas["CalculationRunResponse"]
    readonly "snapshot": ApiSchemas["CalculationSnapshotResponse"]
  }
  readonly "CalculationRunResponse": {
    readonly "completed_at_ms"?: number | null
    readonly "created_at_ms": number
    readonly "engine_version": string
    readonly "error"?: string
    readonly "formula_pack_version": string
    readonly "input"?: Record<string, unknown>
    readonly "input_hash": string
    readonly "output_hash": string
    readonly "owner_email"?: string
    readonly "run_id": string
    readonly "run_type": string
    readonly "snapshot_id"?: string | null
    readonly "status": string
  }
  readonly "CalculationRunTypeResponse": {
    readonly "description": string
    readonly "engineVersion": string
    readonly "formulaPackVersion": string
    readonly "label": string
    readonly "metricDefinitionsVersion": string
    readonly "runType": string
    readonly "snapshotSupported": boolean
    readonly "status": string
  }
  readonly "CalculationRunTypesResponse": {
    readonly "count"?: number
    readonly "routerVersion": string
    readonly "runTypes"?: Array<ApiSchemas["CalculationRunTypeResponse"]>
  }
  readonly "CalculationRunsListResponse": {
    readonly "count"?: number
    readonly "runs"?: Array<ApiSchemas["CalculationRunResponse"]>
  }
  readonly "CalculationSnapshotAuditEventResponse": {
    readonly "audit_id": string
    readonly "created_at_ms": number
    readonly "event"?: Record<string, unknown>
    readonly "event_type": string
    readonly "snapshot_id": string
  }
  readonly "CalculationSnapshotAuditLogResponse": {
    readonly "count"?: number
    readonly "events"?: Array<ApiSchemas["CalculationSnapshotAuditEventResponse"]>
    readonly "snapshot_id": string
  }
  readonly "CalculationSnapshotIntegrityResponse": {
    readonly "computed_input_hash": string
    readonly "computed_output_hash": string
    readonly "input_hash_matches": boolean
    readonly "mismatches"?: Array<string>
    readonly "output_hash_matches": boolean
    readonly "run_hash_matches": boolean
    readonly "run_id": string
    readonly "snapshot_id": string
    readonly "stored_input_hash": string
    readonly "stored_output_hash": string
    readonly "verified": boolean
    readonly "verified_at_ms": number
  }
  readonly "CalculationSnapshotResponse": {
    readonly "created_at_ms": number
    readonly "engine_version": string
    readonly "formula_pack_version": string
    readonly "frozen_at_ms": number
    readonly "input"?: Record<string, unknown>
    readonly "input_hash": string
    readonly "metric_definitions"?: Array<Record<string, unknown>>
    readonly "metric_definitions_version": string
    readonly "output"?: Record<string, unknown>
    readonly "output_hash": string
    readonly "owner_email"?: string
    readonly "run_id": string
    readonly "run_type": string
    readonly "snapshot_id": string
  }
  readonly "CarryTradeRequest": {
    readonly "force_refresh"?: boolean
    readonly "ticker": string
  }
  readonly "CarryTradeResponse": {
    readonly "active_window"?: boolean
    readonly "bias"?: string
    readonly "blockers"?: Array<string>
    readonly "carry_score"?: number
    readonly "company_name"?: string
    readonly "confidence"?: string
    readonly "entry_window"?: string
    readonly "execution_plan"?: Record<string, unknown>
    readonly "exit_plan"?: Record<string, unknown>
    readonly "expected_hold"?: string
    readonly "frozen"?: boolean
    readonly "metrics"?: Record<string, unknown>
    readonly "reasons"?: Array<string>
    readonly "recommended_dte"?: string
    readonly "risk"?: string
    readonly "score_breakdown"?: Record<string, unknown>
    readonly "ticker": string
    readonly "verdict"?: string
  }
  readonly "DayTradeAiCoachView": {
    readonly "lines"?: Array<string>
  }
  readonly "DayTradeChartCandleView": {
    readonly "close": number
    readonly "high": number
    readonly "low": number
    readonly "open": number
    readonly "time": string
    readonly "volume": number
  }
  readonly "DayTradeChartDefaultsView": {
    readonly "followLive": boolean
    readonly "initialBarSpacing": number
    readonly "initialVisibleBars": number
    readonly "interval": string
    readonly "maxBarSpacing": number
    readonly "minBarSpacing": number
    readonly "rightOffsetBars": number
    readonly "scaleMode": string
    readonly "visibleOverlayIds"?: Array<string>
    readonly "visibleRange": string
  }
  readonly "DayTradeChartEventView": {
    readonly "detail"?: string | null
    readonly "eventType": string
    readonly "id": string
    readonly "price"?: number | null
    readonly "priority": number
    readonly "timestamp": string
    readonly "title": string
    readonly "tone": string
    readonly "visibleByDefault": boolean
  }
  readonly "DayTradeChartLevelView": {
    readonly "active": boolean
    readonly "affectsTradeFocusScale": boolean
    readonly "id": string
    readonly "kind": string
    readonly "label": string
    readonly "lineStyleToken": string
    readonly "offscreenLabel"?: string | null
    readonly "price": number
    readonly "priority": number
    readonly "tone": string
    readonly "visibleByDefault": boolean
  }
  readonly "DayTradeChartTradeFocusView": {
    readonly "levelIdsAllowedToAffectScale"?: Array<string>
    readonly "scalePaddingPercent": number
  }
  readonly "DayTradeChartView": {
    readonly "candles"?: Array<ApiSchemas["DayTradeChartCandleView"]>
    readonly "defaults": ApiSchemas["DayTradeChartDefaultsView"]
    readonly "events"?: Array<ApiSchemas["DayTradeChartEventView"]>
    readonly "levels"?: Array<ApiSchemas["DayTradeChartLevelView"]>
    readonly "marketStructure"?: ApiSchemas["DayTradeMarketStructureView"] | null
    readonly "tradeFocus"?: ApiSchemas["DayTradeChartTradeFocusView"] | null
    readonly "vwapOverlay"?: ApiSchemas["DayTradeVwapOverlayView"] | null
  }
  readonly "DayTradeConfidenceView": {
    readonly "biasConfidence": ApiSchemas["DayTradeMetricView"]
    readonly "entryQuality": ApiSchemas["DayTradeMetricView"]
    readonly "entryTiming": ApiSchemas["DayTradeMetricView"]
    readonly "tradeConfidence": ApiSchemas["DayTradeMetricView"]
  }
  readonly "DayTradeCurrentActionView": {
    readonly "action": string
    readonly "confidence": number
    readonly "reason": string
    readonly "recommendation": string
  }
  readonly "DayTradeCurrentStateView": {
    readonly "explanation": string
    readonly "score": number
    readonly "state": string
  }
  readonly "DayTradeDecisionChangeView": {
    readonly "bearish"?: Array<ApiSchemas["DayTradeMetricView"]>
    readonly "bullish"?: Array<ApiSchemas["DayTradeMetricView"]>
    readonly "invalidation"?: Array<ApiSchemas["DayTradeMetricView"]>
  }
  readonly "DayTradeDecisionEngineView": {
    readonly "confidence": number
    readonly "currentAction": ApiSchemas["DayTradeCurrentActionView"]
    readonly "currentState": ApiSchemas["DayTradeCurrentStateView"]
    readonly "expectedStructure": ApiSchemas["DayTradeExpectedStructureView"]
    readonly "explanation": string
    readonly "nextOpportunity": ApiSchemas["DayTradeNextOpportunityView"]
    readonly "reasoning"?: Array<string>
    readonly "rewardRisk": ApiSchemas["DayTradeRewardRiskView"]
    readonly "setup": ApiSchemas["DayTradeSetupLifecycleView"]
    readonly "trendHealth": ApiSchemas["DayTradeTrendHealthView"]
  }
  readonly "DayTradeDecisionHierarchyView": {
    readonly "currentAction": ApiSchemas["DayTradeMetricView"]
    readonly "currentPhase": ApiSchemas["DayTradeMetricView"]
    readonly "marketContext": ApiSchemas["DayTradeMetricView"]
    readonly "nextOpportunity": ApiSchemas["DayTradeMetricView"]
    readonly "originalEntry"?: ApiSchemas["DayTradeMetricView"] | null
    readonly "setup": ApiSchemas["DayTradeMetricView"]
    readonly "stockBias": ApiSchemas["DayTradeMetricView"]
  }
  readonly "DayTradeDecisionView": {
    readonly "context": ApiSchemas["DayTradeDisplayStatus"]
    readonly "headline": string
    readonly "nextCondition"?: string | null
    readonly "permission": ApiSchemas["DayTradeDisplayStatus"]
    readonly "primaryAction": ApiSchemas["DayTradeWorkspaceAction"]
    readonly "reason": string
    readonly "secondaryActions"?: Array<ApiSchemas["DayTradeWorkspaceAction"]>
    readonly "setupName"?: string | null
  }
  readonly "DayTradeDisplayStatus": {
    readonly "code": string
    readonly "description"?: string | null
    readonly "iconKey"?: string | null
    readonly "label": string
    readonly "tone": string
  }
  readonly "DayTradeDisplayValue": {
    readonly "display": string
    readonly "helpText"?: string | null
    readonly "raw"?: number | string | null
    readonly "tone"?: string | null
  }
  readonly "DayTradeEngineScoresView": {
    readonly "entryScore": ApiSchemas["DayTradeMetricView"]
    readonly "marketScore": ApiSchemas["DayTradeMetricView"]
    readonly "momentumScore": ApiSchemas["DayTradeMetricView"]
    readonly "overallTradeScore": ApiSchemas["DayTradeMetricView"]
    readonly "structureScore": ApiSchemas["DayTradeMetricView"]
    readonly "trendScore": ApiSchemas["DayTradeMetricView"]
    readonly "volumeScore": ApiSchemas["DayTradeMetricView"]
  }
  readonly "DayTradeEvidenceItemView": {
    readonly "detail"?: string | null
    readonly "id": string
    readonly "label": string
    readonly "observedAt"?: string | null
    readonly "order": number
    readonly "result": string
    readonly "ruleId"?: string | null
    readonly "tone": string
  }
  readonly "DayTradeExpectedStructureOptionView": {
    readonly "label": string
    readonly "probability": number
  }
  readonly "DayTradeExpectedStructureView": {
    readonly "current"?: Array<string>
    readonly "expected"?: Array<ApiSchemas["DayTradeExpectedStructureOptionView"]>
    readonly "explanation": string
  }
  readonly "DayTradeMarketContextView": {
    readonly "breadth": ApiSchemas["DayTradeMetricView"]
    readonly "qqq": ApiSchemas["DayTradeMetricView"]
    readonly "relativeStrength": ApiSchemas["DayTradeMetricView"]
    readonly "sector": ApiSchemas["DayTradeMetricView"]
    readonly "spy": ApiSchemas["DayTradeMetricView"]
    readonly "vix": ApiSchemas["DayTradeMetricView"]
  }
  readonly "DayTradeMarketStructureView": {
    readonly "confidence"?: number | null
    readonly "currentPivot"?: string | null
    readonly "currentPivotDetail"?: ApiSchemas["DayTradeStructurePivotView"] | null
    readonly "display": string
    readonly "expectedNext"?: string | null
    readonly "expectedNextPivot"?: string | null
    readonly "explanation"?: string | null
    readonly "id": string
    readonly "invalidation"?: Record<string, unknown> | null
    readonly "invalidationLevel"?: number | null
    readonly "pivots"?: Array<ApiSchemas["DayTradeStructurePivotView"]>
    readonly "sequence"?: Array<string>
    readonly "settings"?: Record<string, unknown> | null
    readonly "showZigZagByDefault"?: boolean
    readonly "sourceTimeframe": string
    readonly "structure": string
    readonly "structureStrength"?: number | null
    readonly "timeframe"?: string | null
    readonly "trend": string
    readonly "visibleByDefault"?: boolean
  }
  readonly "DayTradeMetricView": {
    readonly "confidence"?: number | null
    readonly "display": string
    readonly "formula"?: string | null
    readonly "inputs"?: Array<string>
    readonly "reason"?: string | null
    readonly "source"?: string | null
    readonly "timestamp"?: string | null
    readonly "value"?: unknown
  }
  readonly "DayTradeNextOpportunityView": {
    readonly "explanation": string
    readonly "nextOpportunity": string
    readonly "probability": number
    readonly "trigger": string
  }
  readonly "DayTradeProfessionalDecisionView": {
    readonly "aiCoach": ApiSchemas["DayTradeAiCoachView"]
    readonly "blockers"?: Array<ApiSchemas["DayTradeMetricView"]>
    readonly "changesDecision": ApiSchemas["DayTradeDecisionChangeView"]
    readonly "confidence": ApiSchemas["DayTradeConfidenceView"]
    readonly "hierarchy": ApiSchemas["DayTradeDecisionHierarchyView"]
    readonly "marketContext": ApiSchemas["DayTradeMarketContextView"]
    readonly "risk": ApiSchemas["DayTradeRiskDecisionView"]
    readonly "scores": ApiSchemas["DayTradeEngineScoresView"]
    readonly "timeline"?: Array<ApiSchemas["DayTradeTimelineEventView"]>
    readonly "why": ApiSchemas["DayTradeReasoningEngineView"]
  }
  readonly "DayTradeReasoningEngineView": {
    readonly "negativeFactors"?: Array<ApiSchemas["DayTradeMetricView"]>
    readonly "neutralFactors"?: Array<ApiSchemas["DayTradeMetricView"]>
    readonly "positiveFactors"?: Array<ApiSchemas["DayTradeMetricView"]>
  }
  readonly "DayTradeRequest": {
    readonly "force_refresh"?: boolean
    readonly "ticker": string
  }
  readonly "DayTradeResponse": {
    readonly "ai_coach"?: Record<string, unknown>
    readonly "bear_score": number
    readonly "bias"?: string | null
    readonly "bull_score": number
    readonly "company_name"?: string
    readonly "confidence"?: number
    readonly "display_confidence"?: number
    readonly "entry_guidance"?: Record<string, unknown>
    readonly "execution_fields"?: Array<Record<string, unknown>>
    readonly "explanation"?: Record<string, unknown>
    readonly "final_decision"?: string
    readonly "layered_decision"?: Record<string, unknown>
    readonly "market_bias"?: string
    readonly "metrics": Record<string, unknown>
    readonly "missing_confirmations"?: Array<string>
    readonly "option_risk_context"?: Record<string, unknown>
    readonly "reason"?: string
    readonly "reasons": Array<string>
    readonly "risk_reason"?: string
    readonly "risk_state"?: string
    readonly "setup_quality"?: string
    readonly "supporting_factors"?: Array<string>
    readonly "ticker": string
    readonly "timeframe_state"?: Record<string, unknown>
    readonly "trader_decision"?: Record<string, unknown>
    readonly "verdict": string
  }
  readonly "DayTradeRewardRiskView": {
    readonly "display": string
    readonly "ratio"?: number | null
    readonly "reward": ApiSchemas["DayTradeDisplayValue"]
    readonly "risk": ApiSchemas["DayTradeDisplayValue"]
    readonly "targetUsed"?: string | null
  }
  readonly "DayTradeRiskDecisionView": {
    readonly "entry": ApiSchemas["DayTradeMetricView"]
    readonly "rewardRemaining": ApiSchemas["DayTradeMetricView"]
    readonly "risk": ApiSchemas["DayTradeMetricView"]
    readonly "riskRemaining": ApiSchemas["DayTradeMetricView"]
    readonly "riskReward": ApiSchemas["DayTradeMetricView"]
    readonly "stop": ApiSchemas["DayTradeMetricView"]
    readonly "target": ApiSchemas["DayTradeMetricView"]
    readonly "tradeQuality": ApiSchemas["DayTradeMetricView"]
  }
  readonly "DayTradeRiskPlanView": {
    readonly "entry": ApiSchemas["DayTradeDisplayValue"]
    readonly "positionSize": ApiSchemas["DayTradeDisplayValue"]
    readonly "riskReward": ApiSchemas["DayTradeDisplayValue"]
    readonly "stop": ApiSchemas["DayTradeDisplayValue"]
    readonly "target1": ApiSchemas["DayTradeDisplayValue"]
    readonly "target2": ApiSchemas["DayTradeDisplayValue"]
  }
  readonly "DayTradeSelectedContractView": {
    readonly "ask": ApiSchemas["DayTradeDisplayValue"]
    readonly "bid": ApiSchemas["DayTradeDisplayValue"]
    readonly "dte": ApiSchemas["DayTradeDisplayValue"]
    readonly "expiration": ApiSchemas["DayTradeDisplayValue"]
    readonly "liquidity": ApiSchemas["DayTradeDisplayStatus"]
    readonly "midpoint": ApiSchemas["DayTradeDisplayValue"]
    readonly "optionType": ApiSchemas["DayTradeDisplayValue"]
    readonly "roundTrip": ApiSchemas["DayTradeDisplayValue"]
    readonly "spread": ApiSchemas["DayTradeDisplayValue"]
    readonly "spreadPercent": ApiSchemas["DayTradeDisplayValue"]
    readonly "strike": ApiSchemas["DayTradeDisplayValue"]
  }
  readonly "DayTradeSessionView": {
    readonly "displayDate": string
    readonly "isExecutionAllowed": boolean
    readonly "marketTimeZone": string
    readonly "mode": string
    readonly "reviewCopy"?: string | null
    readonly "sessionDate": string
    readonly "status": ApiSchemas["DayTradeDisplayStatus"]
  }
  readonly "DayTradeSetupLifecycleView": {
    readonly "currentGainPct"?: number | null
    readonly "result"?: string | null
    readonly "setupType": string
    readonly "status": string
    readonly "triggerPrice"?: number | null
    readonly "triggerTime"?: string | null
    readonly "validFrom"?: string | null
    readonly "validUntil"?: string | null
  }
  readonly "DayTradeStructurePivotView": {
    readonly "classification"?: string | null
    readonly "confirmed": boolean
    readonly "explanation"?: string | null
    readonly "id": string
    readonly "label": string
    readonly "latest"?: boolean
    readonly "pivotType": string
    readonly "price": number
    readonly "sourceTimeframe": string
    readonly "status"?: string | null
    readonly "timeframe"?: string | null
    readonly "timestamp": string
    readonly "type"?: string | null
  }
  readonly "DayTradeSymbolView": {
    readonly "change": ApiSchemas["DayTradeDisplayValue"]
    readonly "changeAmount": ApiSchemas["DayTradeDisplayValue"]
    readonly "companyName"?: string | null
    readonly "price": ApiSchemas["DayTradeDisplayValue"]
    readonly "ticker": string
  }
  readonly "DayTradeTimelineEventView": {
    readonly "id": string
    readonly "label": string
    readonly "phase": string
    readonly "price"?: number | null
    readonly "reason"?: string | null
    readonly "status": string
    readonly "timestamp"?: string | null
  }
  readonly "DayTradeTrendHealthView": {
    readonly "explanation": string
    readonly "inputs"?: Record<string, number>
    readonly "label": string
    readonly "score": number
  }
  readonly "DayTradeTriggerRequirementView": {
    readonly "displayValue"?: string | null
    readonly "id": string
    readonly "label": string
    readonly "result": string
    readonly "tone": string
  }
  readonly "DayTradeTriggerView": {
    readonly "requirements"?: Array<ApiSchemas["DayTradeTriggerRequirementView"]>
    readonly "status": ApiSchemas["DayTradeDisplayStatus"]
    readonly "summary": string
  }
  readonly "DayTradeVwapOverlayView": {
    readonly "affectsTradeFocusScale": boolean
    readonly "anchorPolicy": string
    readonly "exchangeTimeZone": string
    readonly "id": string
    readonly "includesExtendedHours": boolean
    readonly "label": string
    readonly "latestAsOfUtc"?: string | null
    readonly "latestValue"?: number | null
    readonly "points"?: Array<ApiSchemas["DayTradeVwapPointView"]>
    readonly "sessionDate": string
    readonly "visibleByDefault": boolean
  }
  readonly "DayTradeVwapPointView": {
    readonly "barStartUtc": string
    readonly "quality": string
    readonly "sourceTimestampUtc": string
    readonly "state": string
    readonly "value"?: number | null
  }
  readonly "DayTradeWorkspaceAction": {
    readonly "disabledReason"?: string | null
    readonly "enabled": boolean
    readonly "id": string
    readonly "label": string
    readonly "payload"?: Record<string, string | number | boolean | null> | null
    readonly "type": string
  }
  readonly "DayTradeWorkspaceResponse": {
    readonly "chart": ApiSchemas["DayTradeChartView"]
    readonly "decision": ApiSchemas["DayTradeDecisionView"]
    readonly "decisionEngine"?: ApiSchemas["DayTradeDecisionEngineView"] | null
    readonly "evidence"?: Array<ApiSchemas["DayTradeEvidenceItemView"]>
    readonly "generatedAt": string
    readonly "professionalDecision"?: ApiSchemas["DayTradeProfessionalDecisionView"] | null
    readonly "provenance"?: Record<string, unknown> | null
    readonly "riskPlan": ApiSchemas["DayTradeRiskPlanView"]
    readonly "schemaVersion": string
    readonly "selectedContract"?: ApiSchemas["DayTradeSelectedContractView"] | null
    readonly "session": ApiSchemas["DayTradeSessionView"]
    readonly "symbol": ApiSchemas["DayTradeSymbolView"]
    readonly "tabs"?: Record<string, unknown>
    readonly "trapDetection"?: Record<string, unknown> | null
    readonly "trigger": ApiSchemas["DayTradeTriggerView"]
  }
  readonly "EodJournalSnapshotRequest": {
    readonly "checks"?: Record<string, unknown>
    readonly "date": string
    readonly "mode"?: string
    readonly "notes"?: Record<string, unknown>
    readonly "snapshot"?: Record<string, unknown>
    readonly "ticker": string
  }
  readonly "ExitSignalAckBody": {
    readonly "code": string
    readonly "ticker": string
  }
  readonly "ForgotPasswordRequest": {
    readonly "email": string
  }
  readonly "GoogleAuthRequest": {
    readonly "credential": string
  }
  readonly "HTTPValidationError": {
    readonly "detail"?: Array<ApiSchemas["ValidationError"]>
  }
  readonly "JournalCloseRequest": {
    readonly "exit_reason"?: string
    readonly "notes"?: string
  }
  readonly "JournalHistoryMorningRequest": {
    readonly "evaluation_date"?: string | null
    readonly "rows"?: Array<ApiSchemas["JournalHistoryMorningRow"]>
  }
  readonly "JournalHistoryMorningRow": {
    readonly "bear"?: ApiSchemas["JournalHistoryScenarioCheck"] | null
    readonly "bias"?: string | null
    readonly "bull"?: ApiSchemas["JournalHistoryScenarioCheck"] | null
    readonly "close"?: number | null
    readonly "date"?: string | null
    readonly "id"?: string
    readonly "mode"?: string
    readonly "ticker": string
  }
  readonly "JournalHistoryScenarioCheck": {
    readonly "entry"?: number | null
    readonly "prob"?: number | null
    readonly "stop"?: number | null
    readonly "t1"?: number | null
    readonly "t2"?: number | null
  }
  readonly "JournalNotesRequest": {
    readonly "notes": string
  }
  readonly "JournalSaveRequest": {
    readonly "bias"?: string
    readonly "company_name"?: string
    readonly "dte_at_entry"?: number
    readonly "engine_signal"?: string
    readonly "engine_state"?: number
    readonly "entry_date": string
    readonly "expected_value"?: number
    readonly "expiry": string
    readonly "legs"?: Array<Record<string, unknown>>
    readonly "max_loss"?: number
    readonly "max_profit"?: number
    readonly "net_credit"?: number
    readonly "notes"?: string
    readonly "prob_of_profit"?: number
    readonly "strategy": string
    readonly "ticker": string
    readonly "total_score"?: number
    readonly "trade_type"?: string
    readonly "underlying_entry"?: number
  }
  readonly "JournalUpdateRequest": {
    readonly "bias"?: string | null
    readonly "company_name"?: string | null
    readonly "engine_signal"?: string | null
    readonly "engine_state"?: number | null
    readonly "entry_date"?: string | null
    readonly "expected_value"?: number | null
    readonly "expiry"?: string | null
    readonly "legs"?: Array<Record<string, unknown>> | null
    readonly "max_loss"?: number | null
    readonly "max_profit"?: number | null
    readonly "net_credit"?: number | null
    readonly "notes"?: string | null
    readonly "prob_of_profit"?: number | null
    readonly "strategy"?: string | null
    readonly "total_score"?: number | null
    readonly "trade_type"?: string | null
    readonly "underlying_entry"?: number | null
  }
  readonly "KeyLevelOut": {
    readonly "kind": string
    readonly "label": string
    readonly "price": number
    readonly "reason": string
  }
  readonly "LoginRequest": {
    readonly "email": string
    readonly "password": string
  }
  readonly "MetricDefinitionOut": {
    readonly "category": string
    readonly "displayRules"?: Record<string, unknown>
    readonly "formulaId": string
    readonly "formulaVersion": string
    readonly "inputsUsed"?: Array<string>
    readonly "label": string
    readonly "longDescription": string
    readonly "metricId": string
    readonly "shortDescription": string
    readonly "unit": string
  }
  readonly "MetricDefinitionsResponse": {
    readonly "formulaPackVersion": string
    readonly "metricDefinitionsVersion": string
    readonly "metrics"?: Array<ApiSchemas["MetricDefinitionOut"]>
  }
  readonly "MyTickerBody": {
    readonly "company_name"?: string
    readonly "symbol": string
    readonly "trade_types"?: Array<string>
  }
  readonly "MyTickerUpdateBody": {
    readonly "trade_types"?: Array<string>
  }
  readonly "MyTickersReorderBody": {
    readonly "symbols": Array<string>
  }
  readonly "OptionChainLiquidityResponse": {
    readonly "calls": Array<ApiSchemas["OptionChainLiquidityRow"]>
    readonly "current_iv"?: number | null
    readonly "current_price": number
    readonly "dte"?: number | null
    readonly "expiries": Array<string>
    readonly "historical_volatility"?: number | null
    readonly "iv_percentile"?: number | null
    readonly "iv_rank"?: number | null
    readonly "price_fetched_at": string
    readonly "price_source": string
    readonly "puts": Array<ApiSchemas["OptionChainLiquidityRow"]>
    readonly "selected_expiry": string
    readonly "ticker": string
  }
  readonly "OptionChainLiquidityRow": {
    readonly "ask": number
    readonly "bid": number
    readonly "in_the_money": boolean
    readonly "is_atm": boolean
    readonly "iv": number
    readonly "mid": number
    readonly "open_interest": number
    readonly "spread": number
    readonly "spread_pct": number
    readonly "strike": number
    readonly "volume": number
  }
  readonly "OptionLegOut": {
    readonly "action": string
    readonly "ask": number
    readonly "bid": number
    readonly "bid_ask_spread_pct": number
    readonly "data_quality"?: string
    readonly "data_quality_reason"?: string
    readonly "delta": number
    readonly "expiry": string
    readonly "iv": number
    readonly "mid_price": number
    readonly "oi": number
    readonly "option_type": string
    readonly "strike": number
    readonly "volume": number
  }
  readonly "OptionRowOut": {
    readonly "ask": number
    readonly "bid": number
    readonly "data_quality"?: string
    readonly "data_quality_reason"?: string
    readonly "delta"?: number | null
    readonly "implied_volatility": string
    readonly "last_price": number
    readonly "open_interest": number
    readonly "strike": number
    readonly "volume": number
  }
  readonly "OptionsFlowOut": {
    readonly "callOpenInterest"?: number
    readonly "callVolume"?: number
    readonly "ivRank"?: number
    readonly "ivSkew"?: number
    readonly "openInterestPutCallRatio"?: number | null
    readonly "putOpenInterest"?: number
    readonly "putVolume"?: number
    readonly "sentiment"?: string
    readonly "summary"?: string
    readonly "volumePutCallRatio"?: number | null
  }
  readonly "OvernightRunnerRequest": {
    readonly "avg_volume_20d"?: number
    readonly "current_price": number
    readonly "intraday_highs"?: Array<number>
    readonly "market_regime"?: string
    readonly "orh": number
    readonly "orl": number
    readonly "qqq_trend_score"?: number
    readonly "spy_trend_score"?: number
    readonly "t1_hit"?: boolean
    readonly "t2_hit"?: boolean
    readonly "ticker": string
    readonly "ticker_trend_score"?: number
    readonly "volume_today"?: number
    readonly "vwap": number
  }
  readonly "OvernightRunnerResponse": {
    readonly "conditions": Record<string, unknown>
    readonly "confidence": string
    readonly "recommended_size_pct"?: number | null
    readonly "recommended_stop"?: number | null
    readonly "runner_score": number
    readonly "verdict": string
  }
  readonly "PortfolioAddBody": {
    readonly "position": Record<string, unknown>
  }
  readonly "PortfolioCloseBody": {
    readonly "close_date"?: string | null
    readonly "close_notes"?: string | null
    readonly "contractsToClose"?: number | null
    readonly "exit_debit_credit"?: number | null
    readonly "exit_price"?: number | null
    readonly "exit_reason"?: string | null
    readonly "id": string
    readonly "mistake_tag"?: string | null
    readonly "pnl_overridden"?: boolean | null
    readonly "pnl_override_reason"?: string | null
    readonly "pnl_pct"?: number | null
    readonly "realized_pnl"?: number | null
    readonly "realized_pnl_percent"?: number | null
  }
  readonly "PortfolioNoteBody": {
    readonly "id": string
    readonly "note": string
  }
  readonly "PortfolioRemoveBody": {
    readonly "id": string
  }
  readonly "PortfolioUpdateBody": {
    readonly "data": Record<string, unknown>
    readonly "id": string
  }
  readonly "PricePoint": {
    readonly "close": number
    readonly "date": string
    readonly "high": number
    readonly "low": number
    readonly "ma20": number
    readonly "ma200": number
    readonly "ma50": number
    readonly "open": number
  }
  readonly "QuoteQualitySummary": {
    readonly "banner_lines"?: Array<string>
    readonly "banner_show"?: boolean
    readonly "chain_rows_total"?: number
    readonly "model_rows"?: number
    readonly "ok_rows"?: number
    readonly "pct_non_ok"?: number
    readonly "stale_rows"?: number
    readonly "underlying_quote_source"?: string
    readonly "unreliable_rows"?: number
  }
  readonly "RecommendationOut": {
    readonly "bias": string
    readonly "breakeven_lower": number
    readonly "breakeven_upper": number
    readonly "credit_pct_of_width": number
    readonly "dte": number
    readonly "edge_ratio"?: number
    readonly "exit_plan": string
    readonly "expected_value": number
    readonly "expiry": string
    readonly "half_kelly_fraction"?: number
    readonly "kelly_fraction"?: number
    readonly "legs": Array<ApiSchemas["OptionLegOut"]>
    readonly "max_loss": number
    readonly "max_profit": number
    readonly "net_credit": number
    readonly "passes_credit_filter": boolean
    readonly "passes_liquidity_filter": boolean
    readonly "passes_rr_filter": boolean
    readonly "prob_of_max_loss": number
    readonly "prob_of_profit": number
    readonly "rank": number
    readonly "rationale": string
    readonly "risk_reward_ratio": number
    readonly "scores": ApiSchemas["ScoreBreakdown"]
    readonly "short_leg_delta": number
    readonly "spread_width": number
    readonly "status"?: string
    readonly "strategy": string
    readonly "warnings": Array<string>
  }
  readonly "RegisterRequest": {
    readonly "email": string
    readonly "name"?: string
    readonly "password": string
  }
  readonly "ResetPasswordRequest": {
    readonly "password": string
    readonly "token": string
  }
  readonly "ScoreBreakdown": {
    readonly "iv_fit_score": number
    readonly "liquidity_score": number
    readonly "signal_score": number
    readonly "structure_score": number
    readonly "total_score": number
  }
  readonly "SignalFeedAlertCreateBody": {
    readonly "agreement_state"?: string
    readonly "message"?: string
    readonly "recommended_action"?: string
    readonly "ticker": string
  }
  readonly "SignalsOut": {
    readonly "above_ma20": boolean
    readonly "above_ma200": boolean
    readonly "above_ma50": boolean
    readonly "bias_confidence": number
    readonly "current_iv": number
    readonly "current_price": number
    readonly "directional_bias": string
    readonly "ext_market_change"?: number
    readonly "ext_market_change_pct"?: number
    readonly "ext_market_price"?: number
    readonly "ext_market_type"?: string
    readonly "hv_20": number
    readonly "hv_60": number
    readonly "iv_environment": string
    readonly "iv_percentile": number
    readonly "iv_rank": number
    readonly "iv_skew": number
    readonly "iv_vs_hv": number
    readonly "ma20": number
    readonly "ma200": number
    readonly "ma200_slope": number
    readonly "ma50": number
    readonly "ma50_slope": number
    readonly "macd": number
    readonly "macd_crossover": string
    readonly "macd_histogram": number
    readonly "macd_signal_line": number
    readonly "pcr_signal": string
    readonly "prev_close": number
    readonly "price_change": number
    readonly "price_change_pct": number
    readonly "put_call_ratio": number
    readonly "rsi": number
    readonly "rsi_signal": string
    readonly "skew_signal": string
    readonly "trend": string
    readonly "trend_strength": string
    readonly "volatility_regime": string
  }
  readonly "SwingTradeRequest": {
    readonly "force_refresh"?: boolean
    readonly "ticker": string
  }
  readonly "SwingTradeResponse": {
    readonly "avoid_reason"?: string | null
    readonly "bear_score": number
    readonly "bias"?: string | null
    readonly "bull_score": number
    readonly "company_name"?: string
    readonly "confidence"?: number
    readonly "confirmation_needed"?: Array<string>
    readonly "decision_label"?: string
    readonly "decision_message"?: string
    readonly "display_confidence"?: number
    readonly "entry_guidance"?: Record<string, unknown>
    readonly "entry_quality"?: string
    readonly "execution_fields"?: Array<Record<string, unknown>>
    readonly "expected_holding_period"?: string
    readonly "explanation"?: Record<string, unknown>
    readonly "final_action"?: string
    readonly "market_bias"?: string
    readonly "metrics": Record<string, unknown>
    readonly "missing_confirmations"?: Array<string>
    readonly "playbook_hint"?: string
    readonly "professional_decision"?: Record<string, unknown>
    readonly "reason"?: string
    readonly "reasons": Array<string>
    readonly "recommended_contract_duration"?: string
    readonly "risk_flags"?: Array<string>
    readonly "risk_level"?: string
    readonly "risk_reason"?: string
    readonly "risk_state"?: string
    readonly "setup_quality"?: string
    readonly "suggested_expiry_window"?: string
    readonly "suggested_strategy"?: string
    readonly "supporting_factors"?: Array<string>
    readonly "swing_bias"?: string
    readonly "ticker": string
    readonly "trade_quality_score"?: number
    readonly "verdict": string
  }
  readonly "TestEmailRequest": {
    readonly "email": string
    readonly "user_name"?: string | null
  }
  readonly "TrackModeAddBody": {
    readonly "notes"?: string
    readonly "ticker": string
  }
  readonly "TrackModeRemoveBody": {
    readonly "ticker": string
  }
  readonly "TradeCheckRequest": {
    readonly "message": string
    readonly "ticker"?: string | null
  }
  readonly "TradeDashboardStoryRequest": {
    readonly "force_refresh"?: boolean
    readonly "ticker": string
  }
  readonly "TradeIdeaCreateRequest": {
    readonly "direction"?: string
    readonly "engine"?: string
    readonly "engine_signal"?: string
    readonly "engine_state"?: number
    readonly "entry_price"?: number
    readonly "notes"?: string
    readonly "reason"?: string
    readonly "status"?: string
    readonly "stop_price"?: number
    readonly "structure"?: string
    readonly "target_price"?: number
    readonly "ticker": string
  }
  readonly "TradeIdeaUpdateRequest": {
    readonly "direction"?: string | null
    readonly "engine"?: string | null
    readonly "engine_signal"?: string | null
    readonly "engine_state"?: number | null
    readonly "entry_price"?: number | null
    readonly "notes"?: string | null
    readonly "reason"?: string | null
    readonly "status"?: string | null
    readonly "stop_price"?: number | null
    readonly "structure"?: string | null
    readonly "target_price"?: number | null
  }
  readonly "TradeLogCreate": {
    readonly "actual_entry"?: number | null
    readonly "confidence_score"?: number
    readonly "contracts"?: number
    readonly "entry_time"?: string | null
    readonly "notes"?: string
    readonly "planned_entry"?: number | null
    readonly "planned_stop"?: number | null
    readonly "planned_t1"?: number | null
    readonly "planned_t2"?: number | null
    readonly "signal_given"?: string
    readonly "structure"?: string
    readonly "ticker": string
    readonly "trade_type"?: string
  }
  readonly "TradeLogUpdate": {
    readonly "actual_entry"?: number | null
    readonly "contracts"?: number | null
    readonly "entry_time"?: string | null
    readonly "exit_price"?: number | null
    readonly "exit_reason"?: string | null
    readonly "exit_time"?: string | null
    readonly "followed_plan"?: string | null
    readonly "notes"?: string | null
    readonly "outcome"?: string | null
    readonly "planned_entry"?: number | null
    readonly "planned_stop"?: number | null
    readonly "planned_t1"?: number | null
    readonly "planned_t2"?: number | null
    readonly "pnl_estimate"?: number | null
    readonly "structure"?: string | null
  }
  readonly "TradeWorksheetEvaluateRequest": {
    readonly "buyExpiration"?: string
    readonly "buyingPower"?: number
    readonly "contracts"?: number
    readonly "daysPassed"?: number
    readonly "direction"?: string
    readonly "expectedHoldDays"?: number
    readonly "expiration"?: string
    readonly "historicalVolatility"?: number
    readonly "ivMove"?: number
    readonly "ivPercentile"?: number
    readonly "ivRank"?: number
    readonly "longCallStrike"?: number
    readonly "longPutStrike"?: number
    readonly "longStrike"?: number
    readonly "premium"?: number
    readonly "priceMove"?: number
    readonly "selectedLegRows"?: Record<string, ApiSchemas["TradeWorksheetSelectedRow"]> | null
    readonly "selectedRow"?: ApiSchemas["TradeWorksheetSelectedRow"] | null
    readonly "sellExpiration"?: string
    readonly "shortCallStrike"?: number
    readonly "shortPutStrike"?: number
    readonly "shortStrike"?: number
    readonly "stockPrice"?: number
    readonly "strategy"?: string
    readonly "strike"?: number
    readonly "targetPrice"?: number
    readonly "ticker"?: string
  }
  readonly "TradeWorksheetSelectedRow": {
    readonly "ask"?: number | null
    readonly "bid"?: number | null
    readonly "in_the_money"?: boolean | null
    readonly "is_atm"?: boolean | null
    readonly "iv"?: number | null
    readonly "mid"?: number | null
    readonly "open_interest"?: number | null
    readonly "spread"?: number | null
    readonly "spread_pct"?: number | null
    readonly "strike"?: number | null
    readonly "volume"?: number | null
  }
  readonly "TradingCancelRequest": {
    readonly "email": string
    readonly "order_id": string
  }
  readonly "TradingCloseRequest": {
    readonly "email": string
    readonly "symbol": string
  }
  readonly "TradingExecuteRequest": {
    readonly "contracts"?: number
    readonly "email": string
    readonly "legs": Array<Record<string, unknown>>
    readonly "strategy": string
    readonly "ticker": string
  }
  readonly "UserDataRequest": {
    readonly "advisory_accepted_at"?: string | null
    readonly "advisory_terms_version"?: string | null
    readonly "alert_email_enabled"?: boolean | null
    readonly "day_trade_watchlist"?: Array<string> | null
    readonly "portfolio": Array<Record<string, unknown>>
    readonly "swing_trade_watchlist"?: Array<string> | null
    readonly "watchlist": Array<Record<string, unknown>>
  }
  readonly "UserDataResponse": {
    readonly "advisory_accepted_at"?: string | null
    readonly "advisory_terms_version"?: string | null
    readonly "alert_email_enabled"?: boolean
    readonly "day_trade_watchlist"?: Array<string>
    readonly "email": string
    readonly "portfolio": Array<Record<string, unknown>>
    readonly "role"?: string
    readonly "swing_trade_watchlist"?: Array<string>
    readonly "watchlist": Array<Record<string, unknown>>
    readonly "watchlist_max"?: number
  }
  readonly "ValidationError": {
    readonly "loc": Array<string | number>
    readonly "msg": string
    readonly "type": string
  }
  readonly "WatchlistAddRequest": {
    readonly "ticker": string
    readonly "trade_type"?: string
  }
  readonly "WatchlistTickerBody": {
    readonly "desired_entry"?: number | null
    readonly "notes"?: string | null
    readonly "source"?: string | null
    readonly "ticker": string
    readonly "watch_reason"?: string | null
  }
}

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
    "method": "get",
    "path": "/api/journal/history-log",
    "operationId": "journal_history_log_api_journal_history_log_get",
    "tags": [],
    "summary": "Journal History Log"
  },
  {
    "method": "post",
    "path": "/api/journal/history-log/auto-generate",
    "operationId": "journal_history_log_auto_generate_api_journal_history_log_auto_generate_post",
    "tags": [],
    "summary": "Journal History Log Auto Generate"
  },
  {
    "method": "post",
    "path": "/api/journal/history-morning-check",
    "operationId": "journal_history_morning_check_api_journal_history_morning_check_post",
    "tags": [],
    "summary": "Journal History Morning Check"
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
    "path": "/api/portfolio/parse-contract",
    "operationId": "post_portfolio_parse_contract_api_portfolio_parse_contract_post",
    "tags": [
      "command-center"
    ],
    "summary": "Post Portfolio Parse Contract"
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
    "path": "/api/position-trade/session-chart",
    "operationId": "position_trade_session_chart_api_position_trade_session_chart_get",
    "tags": [],
    "summary": "Position Trade Session Chart"
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
  "/api/journal/history-log",
  "/api/journal/history-log/auto-generate",
  "/api/journal/history-morning-check",
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
  "/api/portfolio/parse-contract",
  "/api/portfolio/remove",
  "/api/portfolio/update",
  "/api/portfolio/update-note",
  "/api/position-trade/session-chart",
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
