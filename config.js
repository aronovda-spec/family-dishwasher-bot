module.exports = {
    // Bot configuration
    bot: {
        name: 'WhatsApp Dishwasher Bot',
        version: '1.0.0',
        saveInterval: 5 * 60 * 1000, // Save data every 5 minutes
        maxAuthorizedUsers: 3,
        maxAdmins: 2
    },

    // WhatsApp client configuration
    whatsapp: {
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        }
    },

    // Data management configuration
    data: {
        backupRetentionDays: 30,
        maxBackups: 10,
        autoBackup: true
    },

    // Command configuration
    commands: {
        prefix: '/', // Commands can start with / or be used directly
        caseSensitive: false,
        timeout: 30000 // 30 seconds timeout for commands
    },

    // Queue configuration
    queue: {
        maxQueueSize: 10,
        allowSelfRemoval: true,
        autoRotate: true
    },

    // Punishment configuration
    punishment: {
        maxTurnsPerRequest: 10,
        minTurnsPerRequest: 1,
        requireReason: true,
        autoCleanupDays: 30
    }
};
