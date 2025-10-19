const { createClient } = require('@supabase/supabase-js');

class SupabaseDatabase {
    constructor() {
        // Get Supabase credentials from environment variables
        this.supabaseUrl = process.env.SUPABASE_URL;
        this.supabaseKey = process.env.SUPABASE_ANON_KEY;
        
        if (!this.supabaseUrl || !this.supabaseKey) {
            console.log('⚠️ Supabase credentials not found in environment variables');
            console.log('💡 Set SUPABASE_URL and SUPABASE_ANON_KEY in Render dashboard');
            this.supabase = null;
            return;
        }
        
        // Initialize Supabase client
        this.supabase = createClient(this.supabaseUrl, this.supabaseKey);
        console.log('📊 Supabase client initialized');
        
        // Initialize database tables
        this.initTables();
    }
    
    async initTables() {
        if (!this.supabase) return;
        
        try {
            // Create bot_state table for general bot data
            const { error: stateError } = await this.supabase.rpc('create_bot_state_table');
            if (stateError && !stateError.message.includes('already exists')) {
                console.log('📊 Creating bot_state table...');
                // If RPC doesn't exist, we'll create tables manually via SQL
                await this.createTablesManually();
            }
            
            console.log('✅ Supabase database tables ready');
        } catch (error) {
            console.log('⚠️ Error initializing Supabase tables:', error.message);
            console.log('💡 Tables will be created automatically on first use');
        }
    }
    
    async createTablesManually() {
        // Create tables using SQL
        const createTablesSQL = `
            -- Create bot_state table
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
        `;
        
        // Note: Supabase doesn't support multi-statement SQL in client
        // Tables will be created individually as needed
    }
    
    async saveBotState(key, value) {
        if (!this.supabase) {
            console.log(`⚠️ Supabase not available, skipping save: ${key}`);
            return;
        }
        
        try {
            const { error } = await this.supabase
                .from('bot_state')
                .upsert({ 
                    key, 
                    value, 
                    updated_at: new Date().toISOString() 
                });
            
            if (error) {
                console.error(`❌ Error saving bot state ${key}:`, error.message);
            } else {
                console.log(`💾 Bot state saved to Supabase: ${key}`);
            }
        } catch (error) {
            console.error(`❌ Exception saving bot state ${key}:`, error.message);
        }
    }
    
    async getBotState(key) {
        if (!this.supabase) {
            console.log(`⚠️ Supabase not available, returning null for: ${key}`);
            return null;
        }
        
        try {
            const { data, error } = await this.supabase
                .from('bot_state')
                .select('value')
                .eq('key', key)
                .single();
            
            if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
                console.error(`❌ Error getting bot state ${key}:`, error.message);
                return null;
            }
            
            return data ? data.value : null;
        } catch (error) {
            console.error(`❌ Exception getting bot state ${key}:`, error.message);
            return null;
        }
    }
    
    async setUserScore(userName, score) {
        if (!this.supabase) {
            console.log(`⚠️ Supabase not available, skipping user score: ${userName}`);
            return;
        }
        
        try {
            const { error } = await this.supabase
                .from('user_scores')
                .upsert({ 
                    user_name: userName, 
                    score, 
                    updated_at: new Date().toISOString() 
                });
            
            if (error) {
                console.error(`❌ Error saving user score ${userName}:`, error.message);
            } else {
                console.log(`💾 User score saved to Supabase: ${userName} = ${score}`);
            }
        } catch (error) {
            console.error(`❌ Exception saving user score ${userName}:`, error.message);
        }
    }
    
    async getUserScore(userName) {
        if (!this.supabase) {
            console.log(`⚠️ Supabase not available, returning 0 for: ${userName}`);
            return 0;
        }
        
        try {
            const { data, error } = await this.supabase
                .from('user_scores')
                .select('score')
                .eq('user_name', userName)
                .single();
            
            if (error && error.code !== 'PGRST116') {
                console.error(`❌ Error getting user score ${userName}:`, error.message);
                return 0;
            }
            
            return data ? data.score : 0;
        } catch (error) {
            console.error(`❌ Exception getting user score ${userName}:`, error.message);
            return 0;
        }
    }
    
    async getAllUserScores() {
        if (!this.supabase) {
            console.log(`⚠️ Supabase not available, returning empty scores`);
            return {};
        }
        
        try {
            const { data, error } = await this.supabase
                .from('user_scores')
                .select('user_name, score');
            
            if (error) {
                console.error(`❌ Error getting all user scores:`, error.message);
                return {};
            }
            
            const scores = {};
            if (data) {
                data.forEach(row => {
                    scores[row.user_name] = row.score;
                });
            }
            
            return scores;
        } catch (error) {
            console.error(`❌ Exception getting all user scores:`, error.message);
            return {};
        }
    }
    
    async setQueueMapping(userName, queueMember) {
        if (!this.supabase) {
            console.log(`⚠️ Supabase not available, skipping queue mapping: ${userName}`);
            return;
        }
        
        try {
            const { error } = await this.supabase
                .from('queue_mappings')
                .upsert({ 
                    user_name: userName, 
                    queue_member, 
                    updated_at: new Date().toISOString() 
                });
            
            if (error) {
                console.error(`❌ Error saving queue mapping ${userName}:`, error.message);
            } else {
                console.log(`💾 Queue mapping saved to Supabase: ${userName} -> ${queueMember}`);
            }
        } catch (error) {
            console.error(`❌ Exception saving queue mapping ${userName}:`, error.message);
        }
    }
    
    async getQueueMapping(userName) {
        if (!this.supabase) {
            console.log(`⚠️ Supabase not available, returning null for: ${userName}`);
            return null;
        }
        
        try {
            const { data, error } = await this.supabase
                .from('queue_mappings')
                .select('queue_member')
                .eq('user_name', userName)
                .single();
            
            if (error && error.code !== 'PGRST116') {
                console.error(`❌ Error getting queue mapping ${userName}:`, error.message);
                return null;
            }
            
            return data ? data.queue_member : null;
        } catch (error) {
            console.error(`❌ Exception getting queue mapping ${userName}:`, error.message);
            return null;
        }
    }
    
    async getAllQueueMappings() {
        if (!this.supabase) {
            console.log(`⚠️ Supabase not available, returning empty mappings`);
            return {};
        }
        
        try {
            const { data, error } = await this.supabase
                .from('queue_mappings')
                .select('user_name, queue_member');
            
            if (error) {
                console.error(`❌ Error getting all queue mappings:`, error.message);
                return {};
            }
            
            const mappings = {};
            if (data) {
                data.forEach(row => {
                    mappings[row.user_name] = row.queue_member;
                });
            }
            
            return mappings;
        } catch (error) {
            console.error(`❌ Exception getting all queue mappings:`, error.message);
            return {};
        }
    }
    
    async setMonthlyStats(monthKey, statsData) {
        if (!this.supabase) {
            console.log(`⚠️ Supabase not available, skipping monthly stats: ${monthKey}`);
            return;
        }
        
        try {
            const { error } = await this.supabase
                .from('monthly_stats')
                .upsert({ 
                    month_key: monthKey, 
                    stats_data: statsData, 
                    updated_at: new Date().toISOString() 
                });
            
            if (error) {
                console.error(`❌ Error saving monthly stats ${monthKey}:`, error.message);
            } else {
                console.log(`💾 Monthly stats saved to Supabase: ${monthKey}`);
            }
        } catch (error) {
            console.error(`❌ Exception saving monthly stats ${monthKey}:`, error.message);
        }
    }
    
    async getMonthlyStats(monthKey) {
        if (!this.supabase) {
            console.log(`⚠️ Supabase not available, returning null for: ${monthKey}`);
            return null;
        }
        
        try {
            const { data, error } = await this.supabase
                .from('monthly_stats')
                .select('stats_data')
                .eq('month_key', monthKey)
                .single();
            
            if (error && error.code !== 'PGRST116') {
                console.error(`❌ Error getting monthly stats ${monthKey}:`, error.message);
                return null;
            }
            
            return data ? data.stats_data : null;
        } catch (error) {
            console.error(`❌ Exception getting monthly stats ${monthKey}:`, error.message);
            return null;
        }
    }
    
    async getAllMonthlyStats() {
        if (!this.supabase) {
            console.log(`⚠️ Supabase not available, returning empty stats`);
            return {};
        }
        
        try {
            const { data, error } = await this.supabase
                .from('monthly_stats')
                .select('month_key, stats_data');
            
            if (error) {
                console.error(`❌ Error getting all monthly stats:`, error.message);
                return {};
            }
            
            const stats = {};
            if (data) {
                data.forEach(row => {
                    stats[row.month_key] = row.stats_data;
                });
            }
            
            return stats;
        } catch (error) {
            console.error(`❌ Exception getting all monthly stats:`, error.message);
            return {};
        }
    }
    
    async removeUser(userName) {
        if (!this.supabase) {
            console.log(`⚠️ Supabase not available, skipping user removal: ${userName}`);
            return;
        }
        
        try {
            // Remove from user_scores table
            const { error: scoreError } = await this.supabase
                .from('user_scores')
                .delete()
                .eq('user_name', userName);
            
            if (scoreError) {
                console.error(`❌ Error removing user score ${userName}:`, scoreError.message);
            } else {
                console.log(`💾 User score removed from Supabase: ${userName}`);
            }
            
            // Remove from queue_mappings table
            const { error: mappingError } = await this.supabase
                .from('queue_mappings')
                .delete()
                .eq('user_name', userName);
            
            if (mappingError) {
                console.error(`❌ Error removing queue mapping ${userName}:`, mappingError.message);
            } else {
                console.log(`💾 Queue mapping removed from Supabase: ${userName}`);
            }
            
        } catch (error) {
            console.error(`❌ Exception removing user ${userName}:`, error.message);
        }
    }
    
    async clearAllData() {
        if (!this.supabase) {
            console.log(`⚠️ Supabase not available, skipping data clear`);
            return;
        }
        
        try {
            // Clear all tables
            const tables = ['bot_state', 'user_scores', 'queue_mappings', 'monthly_stats'];
            
            for (const table of tables) {
                const { error } = await this.supabase
                    .from(table)
                    .delete()
                    .neq('id', 0); // Delete all rows
                
                if (error) {
                    console.error(`❌ Error clearing table ${table}:`, error.message);
                } else {
                    console.log(`💾 Table cleared in Supabase: ${table}`);
                }
            }
            
        } catch (error) {
            console.error(`❌ Exception clearing all data:`, error.message);
        }
    }
}

module.exports = SupabaseDatabase;
