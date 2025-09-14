const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "test-bot"
    }),
    puppeteer: {
        headless: false, // Show browser window for debugging
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
});

client.on('qr', (qr) => {
    console.log('🔗 QR Code received, scan it with your WhatsApp app:');
    qrcode.generate(qr, { small: true });
    console.log('📱 Open WhatsApp → Settings → Linked Devices → Link a Device');
});

client.on('ready', () => {
    console.log('✅ WhatsApp Test Bot V2 is ready!');
    console.log('📱 Bot is connected and listening for messages...');
    console.log('💬 Send any message in WhatsApp to test');
});

client.on('message', async (message) => {
    console.log('\n📱 === MESSAGE RECEIVED ===');
    console.log('From:', message.from);
    console.log('Body:', `"${message.body}"`);
    console.log('FromMe:', message.fromMe);
    console.log('Type:', message.type);
    console.log('Has Media:', message.hasMedia);
    console.log('Timestamp:', new Date(message.timestamp * 1000));
    console.log('========================\n');
    
    // Reply to ANY message (including your own) for testing
    if (message.body && message.body.trim()) {
        console.log('📤 Sending reply...');
        await message.reply(`🤖 Bot received: "${message.body}"`);
        console.log('✅ Reply sent!');
    }
});

client.on('disconnected', (reason) => {
    console.log('❌ Client disconnected:', reason);
});

client.on('auth_failure', (msg) => {
    console.log('❌ Authentication failed:', msg);
});

client.on('change_state', (state) => {
    console.log('🔄 State changed:', state);
});

console.log('🚀 Starting WhatsApp Test Bot V2...');
console.log('🔧 This version shows the browser window for debugging');
client.initialize();
