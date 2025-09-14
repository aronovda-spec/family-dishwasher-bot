# 🤖 Telegram Dishwasher Bot Setup Guide

## 🚀 **Quick Setup Steps:**

### **1. Create Telegram Bot**
1. Open Telegram and search for `@BotFather`
2. Send `/newbot` command
3. Choose a name: `Dishwasher Bot`
4. Choose a username: `your_dishwasher_bot` (must end with 'bot')
5. **Copy the bot token** (looks like: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### **2. Install Dependencies**
```bash
# Stop any running WhatsApp bot first
# Then install Telegram dependencies:
npm install node-telegram-bot-api
```

### **3. Configure Bot Token**
Edit `index.js` and replace `YOUR_BOT_TOKEN_HERE` with your actual token:

```javascript
const token = process.env.TELEGRAM_BOT_TOKEN || 'YOUR_ACTUAL_BOT_TOKEN_HERE';
```

### **4. Run the Bot**
```bash
npm start
```

### **5. Test the Bot**
1. Open Telegram and search for your bot username
2. Send `/start` to begin
3. Use the buttons for easy mobile interaction!

## 📱 **Mobile-Friendly Features:**

### **Button Interface:**
- **📋 Status** - Check current queue
- **✅ Done** - Complete your turn
- **🔄 Swap** - Choose who to swap with
- **⚡ Punish** - Select person and reason
- **📊 Punishments** - View history

### **Easy Commands:**
- `/start` - Welcome message with buttons
- `/help` - Simple commands
- `/helphelp` - Admin commands
- `/status` - Current queue status
- `/done` - Complete turn

## 🎯 **Key Benefits:**

### **✅ Mobile Optimized:**
- **Tap buttons** instead of typing commands
- **Instant notifications** on your phone
- **Works offline** - bot continues running
- **No browser needed** - pure Telegram app

### **✅ Better User Experience:**
- **Visual interface** with emojis and buttons
- **Quick actions** - one tap to complete turn
- **Smart menus** - guided punishment selection
- **Real-time updates** - instant queue changes

### **✅ Reliable:**
- **Official Telegram API** - no browser dependencies
- **Persistent data** - queue and punishments saved
- **Error handling** - graceful error messages
- **Cross-platform** - works on all devices

## 🔧 **Advanced Setup:**

### **Environment Variables:**
Create a `.env` file:
```
TELEGRAM_BOT_TOKEN=your_bot_token_here
```

### **Running on Phone (Android):**
1. Install **Termux** from Google Play
2. Install Node.js: `pkg install nodejs`
3. Copy bot files to phone
4. Run: `npm install && npm start`

### **Running on Server:**
1. Upload files to your server
2. Install dependencies: `npm install`
3. Set environment variable: `export TELEGRAM_BOT_TOKEN=your_token`
4. Run: `npm start`

## 🎉 **Ready to Use!**

Your Telegram dishwasher bot is now ready with:
- ✅ Mobile-friendly button interface
- ✅ Fixed queue: Eden → Adele → Emma → (repeating)
- ✅ Swap requests with approval system
- ✅ Punishment system with admin controls
- ✅ Data persistence across restarts
- ✅ Real-time notifications

**Enjoy your new mobile dishwasher bot!** 📱✨
