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
