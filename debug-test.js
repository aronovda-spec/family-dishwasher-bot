const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "debug-test"
    }),
    puppeteer: {
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log('🔗 QR Code received, scan it with your WhatsApp app:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ Debug Bot is ready!');
    console.log('📱 This bot will show EVERYTHING it receives');
});

// Listen to ALL events
client.on('message', async (message) => {
    console.log('\n📱 === MESSAGE EVENT ===');
    console.log('From:', message.from);
    console.log('Body:', `"${message.body}"`);
    console.log('FromMe:', message.fromMe);
    console.log('Type:', message.type);
    console.log('Has Media:', message.hasMedia);
    console.log('Timestamp:', new Date(message.timestamp * 1000));
    console.log('Raw message object keys:', Object.keys(message));
    console.log('========================\n');
});

client.on('message_create', async (message) => {
    console.log('\n📤 === MESSAGE CREATE EVENT ===');
    console.log('From:', message.from);
    console.log('Body:', `"${message.body}"`);
    console.log('FromMe:', message.fromMe);
    console.log('Type:', message.type);
    console.log('========================\n');
});

client.on('message_ack', async (message, ack) => {
    console.log('\n✅ === MESSAGE ACK EVENT ===');
    console.log('From:', message.from);
    console.log('Body:', `"${message.body}"`);
    console.log('Ack:', ack);
    console.log('========================\n');
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

console.log('🚀 Starting Debug Bot...');
client.initialize();
