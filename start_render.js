// Main Startup Orchestrator for Render Deployment
// Runs health server, keep-alive, and main bot simultaneously

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Dishwasher Bot with Multi-Process Architecture');
console.log('📅 Started at:', new Date().toISOString());

const processes = {};
let isShuttingDown = false;

// Function to start a child process
function startProcess(name, script, args = [], options = {}) {
    console.log(`🔄 Starting ${name}...`);
    
    const child = spawn('node', [script, ...args], {
        stdio: 'inherit',
        cwd: __dirname,
        ...options
    });
    
    processes[name] = child;
    
    child.on('error', (error) => {
        console.error(`❌ ${name} process error:`, error);
        if (!isShuttingDown) {
            console.log(`🔄 Attempting to restart ${name} in 5 seconds...`);
            setTimeout(() => {
                if (!isShuttingDown) {
                    startProcess(name, script, args, options);
                }
            }, 5000);
        }
    });
    
    child.on('exit', (code, signal) => {
        console.log(`📤 ${name} process exited with code ${code} and signal ${signal}`);
        delete processes[name];
        
        if (!isShuttingDown && code !== 0) {
            console.log(`🔄 Attempting to restart ${name} in 5 seconds...`);
            setTimeout(() => {
                if (!isShuttingDown) {
                    startProcess(name, script, args, options);
                }
            }, 5000);
        }
    });
    
    return child;
}

// Start all processes
console.log('🏥 Starting health server...');
startProcess('health-server', 'health_server.js');

console.log('🔄 Starting keep-alive process...');
startProcess('keep-alive', 'keep_alive.js');

console.log('🤖 Starting main bot...');
startProcess('main-bot', 'simple-telegram-bot.js');

// Monitor process health
setInterval(() => {
    const runningProcesses = Object.keys(processes);
    console.log(`📊 Running processes: ${runningProcesses.join(', ')} (${runningProcesses.length}/3)`);
    
    // Check if any critical process is missing
    const criticalProcesses = ['health-server', 'main-bot'];
    const missingCritical = criticalProcesses.filter(p => !processes[p]);
    
    if (missingCritical.length > 0 && !isShuttingDown) {
        console.log(`⚠️ Missing critical processes: ${missingCritical.join(', ')}`);
    }
}, 60000); // Check every minute

// Graceful shutdown handling
function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    
    console.log(`🛑 Received ${signal}, initiating graceful shutdown...`);
    isShuttingDown = true;
    
    const shutdownPromises = Object.entries(processes).map(([name, process]) => {
        return new Promise((resolve) => {
            console.log(`🔄 Stopping ${name}...`);
            
            const timeout = setTimeout(() => {
                console.log(`⏰ Force killing ${name} after timeout`);
                process.kill('SIGKILL');
                resolve();
            }, 10000); // 10 second timeout
            
            process.on('exit', () => {
                clearTimeout(timeout);
                console.log(`✅ ${name} stopped gracefully`);
                resolve();
            });
            
            process.kill('SIGTERM');
        });
    });
    
    Promise.all(shutdownPromises).then(() => {
        console.log('✅ All processes stopped gracefully');
        process.exit(0);
    });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Error handling
process.on('uncaughtException', (error) => {
    console.error('❌ Main orchestrator uncaught exception:', error);
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Main orchestrator unhandled rejection:', reason);
    gracefulShutdown('unhandledRejection');
});

console.log('✅ All processes started successfully!');
console.log('📊 Process monitoring active');
console.log('🛑 Graceful shutdown handlers registered');
