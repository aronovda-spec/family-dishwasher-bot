#!/usr/bin/env node
/**
 * Direct startup script for Render deployment
 * Runs the bot directly in the main process (like Python bot)
 * This ensures SQLite database connections persist
 */

console.log('🚀 Starting Dishwasher Bot directly for Render...');
console.log('📅 Started at:', new Date().toISOString());
console.log('🌐 Service type: Web Service (direct process)');

// Set up graceful shutdown handlers
process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 Received SIGINT, shutting down gracefully...');
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled rejection:', reason);
    process.exit(1);
});

// Start the bot directly
console.log('🤖 Starting bot directly in main process...');
require('./simple-telegram-bot.js');
