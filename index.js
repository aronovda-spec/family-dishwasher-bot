const TelegramBot = require('node-telegram-bot-api');
const QueueManager = require('./src/QueueManager');
const PunishmentManager = require('./src/PunishmentManager');
const TelegramCommandHandler = require('./src/TelegramCommandHandler');
const fs = require('fs');

// Bot token - you'll need to get this from @BotFather on Telegram
const token = process.env.TELEGRAM_BOT_TOKEN || '8488813166:AAEk3G5Qe8Yw0B3OlAfLLYq8qszdPL0obUI';

// Create bot instance
const bot = new TelegramBot(token, { polling: true });

// Initialize managers
const queueManager = new QueueManager();
const punishmentManager = new PunishmentManager();

// Load saved data
function loadData() {
    try {
        if (fs.existsSync('data/queue.json')) {
            const queueData = JSON.parse(fs.readFileSync('data/queue.json', 'utf8'));
            queueManager.loadFromData(queueData);
            console.log('✅ Queue data loaded successfully');
        }
        
        if (fs.existsSync('data/punishments.json')) {
            const punishmentData = JSON.parse(fs.readFileSync('data/punishments.json', 'utf8'));
            punishmentManager.loadFromData(punishmentData);
            console.log('✅ Punishment data loaded successfully');
        }
    } catch (error) {
        console.log('⚠️ Error loading data:', error.message);
    }
}

// Save data function
function saveData() {
    try {
        // Ensure data directory exists
        if (!fs.existsSync('data')) {
            fs.mkdirSync('data');
        }
        
        // Save queue data
        fs.writeFileSync('data/queue.json', JSON.stringify(queueManager.getData(), null, 2));
        
        // Save punishment data
        fs.writeFileSync('data/punishments.json', JSON.stringify(punishmentManager.getData(), null, 2));
        
        console.log('💾 Data saved successfully');
    } catch (error) {
        console.log('❌ Error saving data:', error.message);
    }
}

// Initialize command handler
const commandHandler = new TelegramCommandHandler(queueManager, punishmentManager, bot);

// Load data on startup
loadData();

console.log('🤖 Telegram Dishwasher Bot is ready!');
console.log('📱 Bot is now listening for commands...');

// Handle text messages
bot.on('message', async (msg) => {
    try {
        const chatId = msg.chat.id;
        const userId = msg.from.id.toString();
        const userName = msg.from.first_name + (msg.from.last_name ? ' ' + msg.from.last_name : '');
        const text = msg.text;
        
        console.log(`📤 Message received: { from: ${userId}, body: '${text}', userName: '${userName}' }`);
        
        // Skip if no text
        if (!text || text.trim() === '') {
            return;
        }
        
        // Process command
        await commandHandler.handleMessage(chatId, userId, userName, text);
        
        // Save data after each command
        saveData();
        
    } catch (error) {
        console.log('❌ Error processing message:', error.message);
    }
});

// Handle callback queries (button presses)
bot.on('callback_query', async (callbackQuery) => {
    try {
        const chatId = callbackQuery.message.chat.id;
        const userId = callbackQuery.from.id.toString();
        const userName = callbackQuery.from.first_name + (callbackQuery.from.last_name ? ' ' + callbackQuery.from.last_name : '');
        const data = callbackQuery.data;
        
        console.log(`🔘 Callback received: { from: ${userId}, data: '${data}', userName: '${userName}' }`);
        
        // Process callback
        await commandHandler.handleCallback(chatId, userId, userName, data);
        
        // Answer callback query
        await bot.answerCallbackQuery(callbackQuery.id);
        
        // Save data after each callback
        saveData();
        
    } catch (error) {
        console.log('❌ Error processing callback:', error.message);
    }
});

// Handle errors
bot.on('error', (error) => {
    console.log('❌ Bot error:', error.message);
});

bot.on('polling_error', (error) => {
    console.log('❌ Polling error:', error.message);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down bot...');
    saveData();
    bot.stopPolling();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down bot...');
    saveData();
    bot.stopPolling();
    process.exit(0);
});