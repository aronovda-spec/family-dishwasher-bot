const fs = require('fs');
const path = require('path');

class DataManager {
    constructor() {
        this.dataDir = path.join(__dirname, '..', 'data');
        this.queueFile = path.join(this.dataDir, 'queue.json');
        this.punishmentFile = path.join(this.dataDir, 'punishments.json');
        
        // Ensure data directory exists
        this.ensureDataDirectory();
    }

    ensureDataDirectory() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
            console.log('Created data directory:', this.dataDir);
        }
    }

    // Save queue data
    async saveQueueData(queueData) {
        try {
            const data = {
                ...queueData,
                lastSaved: new Date().toISOString()
            };
            
            fs.writeFileSync(this.queueFile, JSON.stringify(data, null, 2));
            return true;
        } catch (error) {
            console.error('Error saving queue data:', error);
            return false;
        }
    }

    // Load queue data
    async loadQueueData() {
        try {
            if (!fs.existsSync(this.queueFile)) {
                return null;
            }
            
            const data = fs.readFileSync(this.queueFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Error loading queue data:', error);
            return null;
        }
    }

    // Save punishment data
    async savePunishmentData(punishmentData) {
        try {
            const data = {
                ...punishmentData,
                lastSaved: new Date().toISOString()
            };
            
            fs.writeFileSync(this.punishmentFile, JSON.stringify(data, null, 2));
            return true;
        } catch (error) {
            console.error('Error saving punishment data:', error);
            return false;
        }
    }

    // Load punishment data
    async loadPunishmentData() {
        try {
            if (!fs.existsSync(this.punishmentFile)) {
                return null;
            }
            
            const data = fs.readFileSync(this.punishmentFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('Error loading punishment data:', error);
            return null;
        }
    }

    // Backup all data
    async backupData() {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupDir = path.join(this.dataDir, 'backups');
            
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }

            const queueBackup = path.join(backupDir, `queue-${timestamp}.json`);
            const punishmentBackup = path.join(backupDir, `punishments-${timestamp}.json`);

            if (fs.existsSync(this.queueFile)) {
                fs.copyFileSync(this.queueFile, queueBackup);
            }

            if (fs.existsSync(this.punishmentFile)) {
                fs.copyFileSync(this.punishmentFile, punishmentBackup);
            }

            console.log('Data backup created:', timestamp);
            return true;
        } catch (error) {
            console.error('Error creating backup:', error);
            return false;
        }
    }

    // Get backup files
    getBackups() {
        try {
            const backupDir = path.join(this.dataDir, 'backups');
            if (!fs.existsSync(backupDir)) {
                return [];
            }

            const files = fs.readdirSync(backupDir)
                .filter(file => file.endsWith('.json'))
                .map(file => {
                    const filePath = path.join(backupDir, file);
                    const stats = fs.statSync(filePath);
                    return {
                        name: file,
                        path: filePath,
                        size: stats.size,
                        created: stats.birthtime
                    };
                })
                .sort((a, b) => b.created - a.created);

            return files;
        } catch (error) {
            console.error('Error getting backups:', error);
            return [];
        }
    }

    // Clean old backups (keep last 10)
    async cleanOldBackups(keepCount = 10) {
        try {
            const backups = this.getBackups();
            if (backups.length <= keepCount) {
                return 0;
            }

            const toDelete = backups.slice(keepCount);
            let deletedCount = 0;

            toDelete.forEach(backup => {
                try {
                    fs.unlinkSync(backup.path);
                    deletedCount++;
                } catch (error) {
                    console.error('Error deleting backup:', backup.name, error);
                }
            });

            console.log(`Cleaned ${deletedCount} old backups`);
            return deletedCount;
        } catch (error) {
            console.error('Error cleaning backups:', error);
            return 0;
        }
    }

    // Get data directory info
    getDataInfo() {
        try {
            const info = {
                dataDir: this.dataDir,
                queueFile: this.queueFile,
                punishmentFile: this.punishmentFile,
                queueExists: fs.existsSync(this.queueFile),
                punishmentExists: fs.existsSync(this.punishmentFile),
                backups: this.getBackups().length
            };

            if (info.queueExists) {
                const queueStats = fs.statSync(this.queueFile);
                info.queueSize = queueStats.size;
                info.queueModified = queueStats.mtime;
            }

            if (info.punishmentExists) {
                const punishmentStats = fs.statSync(this.punishmentFile);
                info.punishmentSize = punishmentStats.size;
                info.punishmentModified = punishmentStats.mtime;
            }

            return info;
        } catch (error) {
            console.error('Error getting data info:', error);
            return null;
        }
    }
}

module.exports = DataManager;
