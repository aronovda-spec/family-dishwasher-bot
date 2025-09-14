// Simple Telegram bot test without dependencies
const https = require('https');

const token = '8488813166:AAEk3G5Qe8Yw0B3OlAfLLYq8qszdPL0obUI';
const botUrl = `https://api.telegram.org/bot${token}`;

console.log('🤖 Testing Telegram Bot Connection...');
console.log(`📱 Bot Token: ${token.substring(0, 10)}...`);

// Test bot connection
function testBot() {
    const url = `${botUrl}/getMe`;
    
    https.get(url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            try {
                const response = JSON.parse(data);
                if (response.ok) {
                    console.log('✅ Bot connection successful!');
                    console.log(`🤖 Bot Name: ${response.result.first_name}`);
                    console.log(`👤 Bot Username: @${response.result.username}`);
                    console.log(`🆔 Bot ID: ${response.result.id}`);
                    console.log('\n🎉 Your bot is ready!');
                    console.log('📱 Search for your bot on Telegram and send /start');
                } else {
                    console.log('❌ Bot connection failed:', response.description);
                }
            } catch (error) {
                console.log('❌ Error parsing response:', error.message);
            }
        });
    }).on('error', (error) => {
        console.log('❌ Connection error:', error.message);
    });
}

testBot();
