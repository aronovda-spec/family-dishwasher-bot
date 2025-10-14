// Dedicated Health Server for Render Deployment
// Runs independently of the main bot to ensure health checks always work

const http = require('http');
const url = require('url');

const PORT = process.env.HEALTH_PORT || 8000;
const instanceId = `health-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

console.log(`🏥 Starting dedicated health server (instance: ${instanceId})`);

// Health check endpoint
const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    
    // Health check endpoint
    if (parsedUrl.pathname === '/health') {
        res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache'
        });
        
        const healthData = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            instance: instanceId,
            service: 'dishwasher-bot-health',
            uptime: process.uptime(),
            memory: {
                rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
                heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
                heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
            }
        };
        
        res.end(JSON.stringify(healthData, null, 2));
        console.log(`✅ Health check responded: ${new Date().toISOString()}`);
        
    } else if (parsedUrl.pathname === '/status') {
        // Extended status endpoint
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            service: 'dishwasher-bot-health',
            status: 'running',
            timestamp: new Date().toISOString(),
            instance: instanceId,
            version: '1.0.0'
        }));
        
    } else {
        // 404 for other paths
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found', path: parsedUrl.pathname }));
    }
});

// Start the health server
server.listen(PORT, () => {
    console.log(`🏥 Health server running on port ${PORT}`);
    console.log(`🌐 Health check: http://localhost:${PORT}/health`);
    console.log(`📊 Status check: http://localhost:${PORT}/status`);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
    console.log('🛑 Health server received SIGTERM, shutting down gracefully...');
    server.close(() => {
        console.log('✅ Health server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🛑 Health server received SIGINT, shutting down gracefully...');
    server.close(() => {
        console.log('✅ Health server closed');
        process.exit(0);
    });
});

// Error handling
server.on('error', (error) => {
    console.error('❌ Health server error:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Health server uncaught exception:', error);
    // Don't exit - health server should stay running
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Health server unhandled rejection:', reason);
    // Don't exit - health server should stay running
});

console.log(`🏥 Health server ready! (PID: ${process.pid})`);
