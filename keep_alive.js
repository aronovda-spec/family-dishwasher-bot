// Dedicated Keep-Alive Process for Render Deployment
// Runs independently to ping the health server and prevent sleep

const https = require('https');
const http = require('http');

const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000; // 5 minutes
const INITIAL_DELAY = 30 * 1000; // 30 seconds initial delay
const TIMEOUT = 10000; // 10 second timeout

const instanceId = `keepalive-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

console.log(`🔄 Starting dedicated keep-alive process (instance: ${instanceId})`);

function keepAlive() {
    if (!process.env.RENDER_EXTERNAL_HOSTNAME) {
        console.log('🏠 Keep-alive skipped - running locally');
        return;
    }
    
    const keepAliveUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/health`;
    console.log(`🔄 Sending keep-alive ping to: ${keepAliveUrl}`);
    
    const startTime = Date.now();
    
    const request = https.get(keepAliveUrl, {
        timeout: TIMEOUT,
        headers: {
            'User-Agent': `DishwasherBot-KeepAlive/1.0 (${instanceId})`,
            'Accept': 'application/json'
        }
    }, (res) => {
        const responseTime = Date.now() - startTime;
        let data = '';
        
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            if (res.statusCode === 200) {
                try {
                    const healthData = JSON.parse(data);
                    console.log(`✅ Keep-alive ping successful: ${res.statusCode} (${responseTime}ms) - ${healthData.status} - ${healthData.instance}`);
                } catch (e) {
                    console.log(`✅ Keep-alive ping successful: ${res.statusCode} (${responseTime}ms) - ${data.substring(0, 100)}`);
                }
            } else {
                console.log(`⚠️ Keep-alive ping returned: ${res.statusCode} (${responseTime}ms) - ${data.substring(0, 100)}`);
            }
        });
    });
    
    request.on('error', (err) => {
        const responseTime = Date.now() - startTime;
        console.log(`❌ Keep-alive ping failed (${responseTime}ms): ${err.message}`);
        
        // Try to restart the keep-alive mechanism if it fails repeatedly
        setTimeout(() => {
            console.log('🔄 Attempting to restart keep-alive mechanism...');
            keepAlive();
        }, 60000); // Retry in 1 minute
    });
    
    request.on('timeout', () => {
        const responseTime = Date.now() - startTime;
        console.log(`⏰ Keep-alive ping timed out (${responseTime}ms)`);
        request.destroy();
    });
    
    // Ensure request is cleaned up
    request.setTimeout(TIMEOUT);
}

// Start keep-alive mechanism
console.log(`🔄 Starting keep-alive mechanism (every ${KEEP_ALIVE_INTERVAL / 1000} seconds)`);

// Initial keep-alive after delay to ensure server is ready
setTimeout(() => {
    console.log('🔄 Initial keep-alive ping...');
    keepAlive();
}, INITIAL_DELAY);

// Then every 5 minutes
setInterval(keepAlive, KEEP_ALIVE_INTERVAL);

// Graceful shutdown handling
process.on('SIGTERM', () => {
    console.log('🛑 Keep-alive process received SIGTERM, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 Keep-alive process received SIGINT, shutting down gracefully...');
    process.exit(0);
});

// Error handling - keep-alive should be resilient
process.on('uncaughtException', (error) => {
    console.error('❌ Keep-alive uncaught exception:', error);
    console.log('🔄 Attempting to continue keep-alive...');
    // Don't exit - try to continue
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Keep-alive unhandled rejection:', reason);
    console.log('🔄 Attempting to continue keep-alive...');
    // Don't exit - try to continue
});

console.log(`🔄 Keep-alive process ready! (PID: ${process.pid})`);
console.log(`🔄 Will ping every ${KEEP_ALIVE_INTERVAL / 1000} seconds`);
