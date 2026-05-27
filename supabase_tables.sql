-- Create bot_state table for general bot data
CREATE TABLE IF NOT EXISTS bot_state (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create user_scores table
CREATE TABLE IF NOT EXISTS user_scores (
    user_name TEXT PRIMARY KEY,
    score INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create queue_mappings table
CREATE TABLE IF NOT EXISTS queue_mappings (
    user_name TEXT PRIMARY KEY,
    queue_member TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create monthly_stats table
CREATE TABLE IF NOT EXISTS monthly_stats (
    month_key TEXT PRIMARY KEY,
    stats_data JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security (RLS) for better security
ALTER TABLE bot_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_stats ENABLE ROW LEVEL SECURITY;

-- Create policies to allow all operations (for bot use)
CREATE POLICY "Allow all operations on bot_state" ON bot_state FOR ALL USING (true);
CREATE POLICY "Allow all operations on user_scores" ON user_scores FOR ALL USING (true);
CREATE POLICY "Allow all operations on queue_mappings" ON queue_mappings FOR ALL USING (true);
CREATE POLICY "Allow all operations on monthly_stats" ON monthly_stats FOR ALL USING (true);

-- Explicit Data API grants (required for new Supabase projects from May 2026,
-- and for new tables in existing projects from Oct 2026).
-- The bot uses supabase-js with the anon key (PostgREST / Data API).
GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bot_state TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_scores TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.queue_mappings TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.monthly_stats TO anon, authenticated;

-- Apply the same grants to any future tables you add in public (run as table owner).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
