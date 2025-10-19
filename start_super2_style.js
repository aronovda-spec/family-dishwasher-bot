#!/usr/bin/env node
/**
 * Simple startup script like Super2 - direct and stable
 * Runs the bot directly in main process with health endpoint
 */

const express = require('express');
const app = express();
const PORT = process.env.HEALTH_PORT || 8000;

// Simple health endpoint (like Super2)
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'dishwasher-bot',
        version: '1.0.0'
    });
});

// Start health server
app.listen(PORT, () => {
    console.log(`🏥 Health check server running on port ${PORT}`);
});

// Start the bot directly (like Super2)
console.log('🚀 Starting Dishwasher Bot directly (Super2 style)...');
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
