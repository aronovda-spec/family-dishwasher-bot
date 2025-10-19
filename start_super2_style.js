#!/usr/bin/env node
/**
 * Ultra-simple startup script like Super2 - no external dependencies
 * Runs the bot directly in main process with built-in health endpoint
 */

const http = require('http');
const PORT = process.env.HEALTH_PORT || 8000;

// Simple health endpoint (like Super2) - no express needed
const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            service: 'dishwasher-bot',
            version: '1.0.0'
        }));
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// Start health server
server.listen(PORT, () => {
    console.log(`🏥 Health check server running on port ${PORT}`);
});

// Start the bot directly (like Super2)
console.log('🚀 Starting Dishwasher Bot directly (Super2 style)...');
console.log('📅 Started at:', new Date().toISOString());
console.log('🌐 Service type: Web Service (direct process)');

// Set up graceful shutdown handlers
process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, shutting down gracefully...');
    server.close(() => {
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🛑 Received SIGINT, shutting down gracefully...');
    server.close(() => {
        process.exit(0);
    });
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
