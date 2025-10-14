// Simplified Single-Process Version for Render Free Tier
// This combines all functionality into one process to avoid resource conflicts

const { spawn } = require('child_process');

console.log('🚀 Starting Simplified Dishwasher Bot for Render Free Tier');
console.log('📅 Started at:', new Date().toISOString());

// Start only the main bot process (includes health endpoint and keep-alive)
console.log('🤖 Starting main bot with integrated health and keep-alive...');
const mainBot = spawn('node', ['simple-telegram-bot.js'], {
    stdio: 'inherit',
    cwd: __dirname
});

mainBot.on('error', (error) => {
    console.error('❌ Main bot process error:', error);
    console.log('🔄 Attempting to restart main bot in 5 seconds...');
    setTimeout(() => {
        const newBot = spawn('node', ['simple-telegram-bot.js'], {
            stdio: 'inherit',
            cwd: __dirname
        });
        newBot.on('error', (err) => {
            console.error('❌ Restart failed:', err);
        });
    }, 5000);
});

mainBot.on('exit', (code, signal) => {
    console.log(`📤 Main bot process exited with code ${code} and signal ${signal}`);
    if (code !== 0) {
        console.log('🔄 Attempting to restart main bot in 5 seconds...');
        setTimeout(() => {
            const newBot = spawn('node', ['simple-telegram-bot.js'], {
                stdio: 'inherit',
                cwd: __dirname
            });
        }, 5000);
    }
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, shutting down gracefully...');
    mainBot.kill('SIGTERM');
    setTimeout(() => {
        process.exit(0);
    }, 5000);
});

process.on('SIGINT', () => {
    console.log('🛑 Received SIGINT, shutting down gracefully...');
    mainBot.kill('SIGINT');
    setTimeout(() => {
        process.exit(0);
    }, 5000);
});

// Error handling
process.on('uncaughtException', (error) => {
    console.error('❌ Main orchestrator uncaught exception:', error);
    mainBot.kill('SIGTERM');
    setTimeout(() => {
        process.exit(1);
    }, 1000);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Main orchestrator unhandled rejection:', reason);
    mainBot.kill('SIGTERM');
    setTimeout(() => {
        process.exit(1);
    }, 1000);
});

console.log('✅ Simplified bot started successfully!');
console.log('🛑 Graceful shutdown handlers registered');
