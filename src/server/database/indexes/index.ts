/**
 * Ordered list of `CREATE INDEX IF NOT EXISTS` statements applied as part of
 * the baseline. The SQL is identical between Postgres and SQLite for every
 * one of these, so we don't need a per-dialect split.
 *
 * Order matches the original `init.ts`:
 *   core -> events/teams -> brackets -> queue -> score submissions ->
 *   misc -> documentation -> awards.
 */
export const BASELINE_INDEXES: readonly string[] = [
  // Core indexes
  `CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)`,
  `CREATE INDEX IF NOT EXISTS idx_spreadsheet_configs_user ON spreadsheet_configs(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_score_submissions_user ON score_submissions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_messages_spreadsheet ON chat_messages(spreadsheet_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at)`,

  // Event/team indexes
  `CREATE INDEX IF NOT EXISTS idx_teams_event ON teams(event_id)`,
  `CREATE INDEX IF NOT EXISTS idx_teams_status ON teams(event_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_seeding_scores_team ON seeding_scores(team_id)`,
  `CREATE INDEX IF NOT EXISTS idx_seeding_rankings_rank ON seeding_rankings(seed_rank)`,

  // Bracket indexes
  `CREATE INDEX IF NOT EXISTS idx_brackets_event ON brackets(event_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bracket_entries_bracket ON bracket_entries(bracket_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bracket_games_bracket ON bracket_games(bracket_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bracket_games_status ON bracket_games(bracket_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_bracket_games_team1 ON bracket_games(team1_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bracket_games_team2 ON bracket_games(team2_id)`,

  // Bracket revert traversal indexes (team source lookups)
  `CREATE INDEX IF NOT EXISTS idx_bracket_games_team1_source ON bracket_games(bracket_id, team1_source)`,
  `CREATE INDEX IF NOT EXISTS idx_bracket_games_team2_source ON bracket_games(bracket_id, team2_source)`,

  // Queue indexes
  `CREATE INDEX IF NOT EXISTS idx_game_queue_event ON game_queue(event_id)`,
  `CREATE INDEX IF NOT EXISTS idx_game_queue_position ON game_queue(event_id, queue_position)`,
  `CREATE INDEX IF NOT EXISTS idx_game_queue_status ON game_queue(status)`,

  // Score submissions event-scoped indexes
  `CREATE INDEX IF NOT EXISTS idx_score_submissions_event_status ON score_submissions(event_id, status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_score_submissions_event_type ON score_submissions(event_id, score_type, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_score_submissions_game_queue ON score_submissions(game_queue_id)`,
  `CREATE INDEX IF NOT EXISTS idx_score_submissions_bracket_game ON score_submissions(bracket_game_id)`,
  `CREATE INDEX IF NOT EXISTS idx_score_submissions_seeding_score ON score_submissions(seeding_score_id)`,

  // Other indexes
  `CREATE INDEX IF NOT EXISTS idx_score_details_submission ON score_details(score_submission_id)`,
  `CREATE INDEX IF NOT EXISTS idx_bracket_templates_size ON bracket_templates(bracket_size)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_event ON audit_log(event_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)`,

  // Documentation score indexes
  `CREATE INDEX IF NOT EXISTS idx_event_doc_categories_event ON event_documentation_categories(event_id)`,
  `CREATE INDEX IF NOT EXISTS idx_event_doc_categories_category ON event_documentation_categories(category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_doc_scores_event ON documentation_scores(event_id)`,
  `CREATE INDEX IF NOT EXISTS idx_doc_scores_team ON documentation_scores(team_id)`,
  `CREATE INDEX IF NOT EXISTS idx_doc_sub_scores_doc ON documentation_sub_scores(documentation_score_id)`,

  // Awards indexes
  `CREATE INDEX IF NOT EXISTS idx_event_awards_event_sort ON event_awards(event_id, sort_order)`,
  `CREATE INDEX IF NOT EXISTS idx_event_awards_template ON event_awards(template_award_id)`,
  `CREATE INDEX IF NOT EXISTS idx_event_award_recipients_award ON event_award_recipients(event_award_id)`,
  `CREATE INDEX IF NOT EXISTS idx_event_award_recipients_team ON event_award_recipients(team_id)`,
];
