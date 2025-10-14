// Test script for the new multi-process architecture
// Run with: node test_architecture.js

const { spawn } = require('child_process');

console.log('🧪 Testing Multi-Process Architecture');
console.log('=====================================');

// Test health server
console.log('\n🏥 Testing Health Server...');
const healthServer = spawn('node', ['health_server.js'], { stdio: 'pipe' });

healthServer.stdout.on('data', (data) => {
    console.log('Health Server:', data.toString().trim());
});

healthServer.stderr.on('data', (data) => {
    console.log('Health Server Error:', data.toString().trim());
});

// Wait a bit then test health endpoint
setTimeout(() => {
    const http = require('http');
    
    const req = http.get('http://localhost:8000/health', (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            console.log('✅ Health endpoint test:', res.statusCode);
            console.log('📊 Response:', JSON.parse(data));
            
            // Clean up
            healthServer.kill();
            console.log('\n✅ Architecture test completed successfully!');
            process.exit(0);
        });
    });
    
    req.on('error', (err) => {
        console.log('❌ Health endpoint test failed:', err.message);
        healthServer.kill();
        process.exit(1);
    });
    
}, 2000);

// Timeout after 10 seconds
setTimeout(() => {
    console.log('⏰ Test timeout - cleaning up...');
    healthServer.kill();
    process.exit(1);
}, 10000);
