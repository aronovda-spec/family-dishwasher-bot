const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
    constructor() {
        // Use the same database file name as the Python bot
        this.dbPath = path.join(__dirname, 'dishwasher_bot.db');
        this.db = null;
        
        // Check if running on Render (ephemeral file system)
        this.isRender = process.env.RENDER === 'true' || process.env.RENDER_EXTERNAL_HOSTNAME;
        
        // In-memory backup for Render free tier
        this.memoryBackup = null;
        
        this.init();
    }

    init() {
        this.db = new sqlite3.Database(this.dbPath, (err) => {
            if (err) {
                console.error('❌ Error opening database:', err.message);
            } else {
                console.log('📊 Connected to SQLite database:', this.dbPath);
                this.createTables();
            }
        });
    }

    createTables() {
        const createTablesSQL = `
            -- Users table
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY,
                username TEXT,
                first_name TEXT,
                last_name TEXT,
                is_admin BOOLEAN DEFAULT FALSE,
                is_authorized BOOLEAN DEFAULT FALSE,
                language TEXT DEFAULT 'en',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Bot state table
            CREATE TABLE IF NOT EXISTS bot_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- User scores table
            CREATE TABLE IF NOT EXISTS user_scores (
                user_name TEXT PRIMARY KEY,
                score INTEGER DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Queue mappings table
            CREATE TABLE IF NOT EXISTS queue_mappings (
                user_name TEXT PRIMARY KEY,
                queue_member TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Monthly statistics table
            CREATE TABLE IF NOT EXISTS monthly_stats (
                month_key TEXT PRIMARY KEY,
                stats_data TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;

        this.db.exec(createTablesSQL, (err) => {
            if (err) {
                console.error('❌ Error creating tables:', err.message);
            } else {
                console.log('✅ Database tables created/verified');
            }
        });
    }

    // Bot state methods
    async saveBotState(key, value) {
        return new Promise((resolve, reject) => {
            const sql = `INSERT OR REPLACE INTO bot_state (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`;
            this.db.run(sql, [key, JSON.stringify(value)], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.changes);
                }
            });
        });
    }

    async getBotState(key) {
        return new Promise((resolve, reject) => {
            const sql = `SELECT value FROM bot_state WHERE key = ?`;
            this.db.get(sql, [key], (err, row) => {
                if (err) {
                    reject(err);
                } else if (row) {
                    try {
                        resolve(JSON.parse(row.value));
                    } catch (parseErr) {
                        resolve(row.value);
                    }
                } else {
                    resolve(null);
                }
            });
        });
    }

    // User management methods
    async addUser(userId, username, firstName, lastName, isAdmin = false, isAuthorized = false) {
        return new Promise((resolve, reject) => {
            const sql = `INSERT OR REPLACE INTO users (user_id, username, first_name, last_name, is_admin, is_authorized) VALUES (?, ?, ?, ?, ?, ?)`;
            this.db.run(sql, [userId, username, firstName, lastName, isAdmin, isAuthorized], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.changes);
                }
            });
        });
    }

    async getUser(userId) {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM users WHERE user_id = ?`;
            this.db.get(sql, [userId], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    async getAllUsers() {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM users`;
            this.db.all(sql, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async getAuthorizedUsers() {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM users WHERE is_authorized = TRUE`;
            this.db.all(sql, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async getAdmins() {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM users WHERE is_admin = TRUE`;
            this.db.all(sql, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // User scores methods
    async setUserScore(userName, score) {
        return new Promise((resolve, reject) => {
            const sql = `INSERT OR REPLACE INTO user_scores (user_name, score, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`;
            this.db.run(sql, [userName, score], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.changes);
                }
            });
        });
    }

    async getUserScore(userName) {
        return new Promise((resolve, reject) => {
            const sql = `SELECT score FROM user_scores WHERE user_name = ?`;
            this.db.get(sql, [userName], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row ? row.score : 0);
                }
            });
        });
    }

    async getAllUserScores() {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM user_scores`;
            this.db.all(sql, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const scores = {};
                    rows.forEach(row => {
                        scores[row.user_name] = row.score;
                    });
                    resolve(scores);
                }
            });
        });
    }

    // Queue mappings methods
    async setQueueMapping(userName, queueMember) {
        return new Promise((resolve, reject) => {
            const sql = `INSERT OR REPLACE INTO queue_mappings (user_name, queue_member, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`;
            this.db.run(sql, [userName, queueMember], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.changes);
                }
            });
        });
    }

    async getQueueMapping(userName) {
        return new Promise((resolve, reject) => {
            const sql = `SELECT queue_member FROM queue_mappings WHERE user_name = ?`;
            this.db.get(sql, [userName], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row ? row.queue_member : null);
                }
            });
        });
    }

    async getAllQueueMappings() {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM queue_mappings`;
            this.db.all(sql, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const mappings = {};
                    rows.forEach(row => {
                        mappings[row.user_name] = row.queue_member;
                    });
                    resolve(mappings);
                }
            });
        });
    }

    // Monthly statistics methods
    async setMonthlyStats(monthKey, statsData) {
        return new Promise((resolve, reject) => {
            const sql = `INSERT OR REPLACE INTO monthly_stats (month_key, stats_data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`;
            this.db.run(sql, [monthKey, JSON.stringify(statsData)], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.changes);
                }
            });
        });
    }

    async getMonthlyStats(monthKey) {
        return new Promise((resolve, reject) => {
            const sql = `SELECT stats_data FROM monthly_stats WHERE month_key = ?`;
            this.db.get(sql, [monthKey], (err, row) => {
                if (err) {
                    reject(err);
                } else if (row) {
                    try {
                        resolve(JSON.parse(row.stats_data));
                    } catch (parseErr) {
                        resolve(row.stats_data);
                    }
                } else {
                    resolve(null);
                }
            });
        });
    }

    async getAllMonthlyStats() {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM monthly_stats`;
            this.db.all(sql, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    const stats = {};
                    rows.forEach(row => {
                        try {
                            stats[row.month_key] = JSON.parse(row.stats_data);
                        } catch (parseErr) {
                            stats[row.month_key] = row.stats_data;
                        }
                    });
                    resolve(stats);
                }
            });
        });
    }

    // In-memory backup methods for Render free tier
    saveToMemory() {
        if (this.isRender) {
            // Create in-memory backup of all data
            this.memoryBackup = {
                timestamp: Date.now(),
                data: {
                    // This will be populated by the bot's saveBotData function
                }
            };
            console.log('💾 Data backed up to memory for Render persistence');
        }
    }
    
    loadFromMemory() {
        if (this.isRender && this.memoryBackup) {
            console.log('📂 Loading data from memory backup');
            return this.memoryBackup.data;
        }
        return null;
    }
    
    // Cleanup methods
    async removeUser(userName) {
        return new Promise((resolve, reject) => {
            const sql = `DELETE FROM user_scores WHERE user_name = ?`;
            this.db.run(sql, [userName], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.changes);
                }
            });
        });
    }

    async clearAllData() {
        return new Promise((resolve, reject) => {
            const sql = `DELETE FROM users; DELETE FROM bot_state; DELETE FROM user_scores; DELETE FROM queue_mappings; DELETE FROM monthly_stats;`;
            this.db.exec(sql, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(true);
                }
            });
        });
    }

    close() {
        if (this.db) {
            this.db.close((err) => {
                if (err) {
                    console.error('❌ Error closing database:', err.message);
                } else {
                    console.log('📊 Database connection closed');
                }
            });
        }
    }
}

module.exports = Database;
