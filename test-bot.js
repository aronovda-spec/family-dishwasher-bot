const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log('QR Code received, scan it with your WhatsApp app:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ WhatsApp Test Bot is ready!');
    console.log('📱 Send any message to test...');
});

client.on('message', async (message) => {
    console.log('📱 MESSAGE DETECTED:');
    console.log('  From:', message.from);
    console.log('  Body:', message.body);
    console.log('  FromMe:', message.fromMe);
    console.log('  Type:', message.type);
    console.log('  Timestamp:', message.timestamp);
    console.log('---');
    
    // Reply to any message
    if (!message.fromMe && message.body) {
        await message.reply(`🤖 Bot received: "${message.body}"`);
    }
});

client.on('disconnected', (reason) => {
    console.log('❌ Client disconnected:', reason);
});

console.log('🚀 Starting WhatsApp Test Bot...');
client.initialize();
