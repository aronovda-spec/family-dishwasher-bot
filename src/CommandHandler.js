class CommandHandler {
    constructor(bot) {
        this.bot = bot;
        this.commands = new Map();
        this.setupCommands();
    }

    setupCommands() {
        // Queue management commands
        // Fixed queue - users can't add/remove themselves
        this.commands.set('done', this.handleDone.bind(this));
        this.commands.set('status', this.handleStatus.bind(this));
        this.commands.set('queue', this.handleStatus.bind(this));

        // Turn flexibility commands
        this.commands.set('swap', this.handleSwap.bind(this));
        this.commands.set('approve', this.handleApprove.bind(this));
        this.commands.set('reject', this.handleReject.bind(this));
        this.commands.set('skip', this.handleSkip.bind(this));

        // Punishment commands
        this.commands.set('punish', this.handlePunish.bind(this));
        this.commands.set('punishments', this.handlePunishments.bind(this));
        this.commands.set('punishment', this.handlePunishments.bind(this));

        // Admin commands
        this.commands.set('addadmin', this.handleAddAdmin.bind(this));
        this.commands.set('removeadmin', this.handleRemoveAdmin.bind(this));
        this.commands.set('admins', this.handleAdmins.bind(this));
        this.commands.set('authorize', this.handleAuthorize.bind(this));
        this.commands.set('unauthorize', this.handleUnauthorize.bind(this));

        // Help command
        this.commands.set('help', this.handleHelp.bind(this));
        this.commands.set('helphelp', this.handleDetailedHelp.bind(this));
        this.commands.set('commands', this.handleHelp.bind(this));
    }

    async handleMessage(message) {
        const text = message.body.trim();
        const userId = message.from;
        const userName = message._data.notifyName || 'Unknown User';

        console.log('🔍 CommandHandler processing:', {
            text: text,
            userId: userId,
            userName: userName,
            fromMe: message.fromMe
        });

        // Temporarily allow all messages for testing
        const isGroup = message.from.includes('@g.us');
        console.log(`📱 Processing message from: ${isGroup ? 'GROUP' : 'INDIVIDUAL'} chat`);
        
        // TODO: Re-enable group restriction after testing
        // if (!isGroup) {
        //     console.log('⏭️ Ignoring individual chat message - bot only works in dishwasher groups');
        //     return;
        // }

        // Note: We'll process all messages, including your own
        // The bot won't reply to its own messages in the command handlers

        // Ignore empty messages (system messages like member changes)
        if (!text || text.trim() === '') {
            console.log('⏭️ Ignoring empty message');
            return;
        }

        // Parse command
        const parts = text.split(' ');
        const command = parts[0].toLowerCase();

        console.log(`🔍 Processing command: "${command}" from text: "${text}"`);

        if (this.commands.has(command)) {
            console.log(`✅ Found command: ${command}`);
            try {
                const response = await this.commands.get(command)(parts, userId, userName, message);
                if (response) {
                    console.log(`📤 Sending response: ${response.substring(0, 50)}...`);
                    // Always reply to commands (including your own messages)
                    await message.reply(response);
                }
            } catch (error) {
                console.error(`Error handling command ${command}:`, error);
                await message.reply(`❌ Error: ${error.message}`);
            }
        } else if (text.startsWith('/')) {
            // Unknown command
            console.log(`❌ Unknown command: ${command}`);
            await message.reply('❌ Unknown command. Type "help" to see available commands.');
        } else {
            console.log(`⏭️ No command found for: "${text}"`);
        }
    }

    // Queue Management Commands
    // Fixed queue system - users can't add/remove themselves

    async handleDone(parts, userId, userName, message) {
        const queueManager = this.bot.getQueueManager();
        return queueManager.completeTurn(userId);
    }

    async handleStatus(parts, userId, userName, message) {
        const queueManager = this.bot.getQueueManager();
        return queueManager.getStatus();
    }

    // Turn Flexibility Commands
    async handleSwap(parts, userId, userName, message) {
        if (parts.length < 2) {
            return '❌ Usage: swap @username or swap phone_number';
        }

        const target = parts[1];
        const queueManager = this.bot.getQueueManager();
        
        // Extract user ID from mention or use as-is
        const targetUserId = this.extractUserId(target);
        
        const result = queueManager.requestSwap(userId, targetUserId);
        return result.message;
    }

    async handleApprove(parts, userId, userName, message) {
        if (parts.length < 2) {
            return '❌ Usage: approve <request_id>';
        }

        const requestId = parseInt(parts[1]);
        if (isNaN(requestId)) {
            return '❌ Invalid request ID';
        }

        const queueManager = this.bot.getQueueManager();
        return queueManager.approveSwap(requestId, userId);
    }

    async handleReject(parts, userId, userName, message) {
        if (parts.length < 2) {
            return '❌ Usage: reject <request_id>';
        }

        const requestId = parseInt(parts[1]);
        if (isNaN(requestId)) {
            return '❌ Invalid request ID';
        }

        const queueManager = this.bot.getQueueManager();
        return queueManager.rejectSwap(requestId, userId);
    }

    async handleSkip(parts, userId, userName, message) {
        const reason = parts.slice(1).join(' ') || '';
        const queueManager = this.bot.getQueueManager();
        return queueManager.requestSkip(userId, reason);
    }

    // Punishment Commands
    async handlePunish(parts, userId, userName, message) {
        if (parts.length < 3) {
            return '❌ Usage: punish @username +3 reason for punishment';
        }

        const target = parts[1];
        const turnsStr = parts[2];
        const reason = parts.slice(3).join(' ') || 'No reason provided';

        // Parse turns (e.g., +3, +1, etc.)
        if (!turnsStr.startsWith('+')) {
            return '❌ Turns must be specified as +number (e.g., +3)';
        }

        const turns = parseInt(turnsStr.substring(1));
        if (isNaN(turns) || turns <= 0) {
            return '❌ Invalid number of turns';
        }

        const targetUserId = this.extractUserId(target);
        const punishmentManager = this.bot.getPunishmentManager();
        
        const result = punishmentManager.submitPunishmentRequest(
            userId, 
            targetUserId, 
            target, 
            turns, 
            reason
        );
        
        return result.message;
    }

    async handlePunishments(parts, userId, userName, message) {
        const punishmentManager = this.bot.getPunishmentManager();
        
        if (parts.length > 1 && parts[1] === 'stats') {
            return punishmentManager.getPunishmentStats();
        }
        
        return punishmentManager.getPunishmentHistory();
    }

    // Admin Commands
    async handleAddAdmin(parts, userId, userName, message) {
        if (parts.length < 2) {
            return '❌ Usage: addadmin @username or addadmin phone_number';
        }

        const target = parts[1];
        const targetUserId = this.extractUserId(target);
        const punishmentManager = this.bot.getPunishmentManager();
        
        punishmentManager.addAdmin(targetUserId);
        return `✅ ${target} added as admin!`;
    }

    async handleRemoveAdmin(parts, userId, userName, message) {
        if (parts.length < 2) {
            return '❌ Usage: removeadmin @username or removeadmin phone_number';
        }

        const target = parts[1];
        const targetUserId = this.extractUserId(target);
        const punishmentManager = this.bot.getPunishmentManager();
        
        punishmentManager.removeAdmin(targetUserId);
        return `✅ ${target} removed from admins!`;
    }

    async handleAdmins(parts, userId, userName, message) {
        const punishmentManager = this.bot.getPunishmentManager();
        const admins = punishmentManager.getAdmins();
        
        if (admins.length === 0) {
            return '👨‍💼 No admins configured.';
        }
        
        return `👨‍💼 **Admins:**\n${admins.map(admin => `• ${admin}`).join('\n')}`;
    }

    async handleAuthorize(parts, userId, userName, message) {
        if (parts.length < 2) {
            return '❌ Usage: authorize @username or authorize phone_number';
        }

        const target = parts[1];
        const targetUserId = this.extractUserId(target);
        const queueManager = this.bot.getQueueManager();
        
        queueManager.addAuthorizedUser(targetUserId);
        return `✅ ${target} authorized to use queue commands!`;
    }

    async handleUnauthorize(parts, userId, userName, message) {
        if (parts.length < 2) {
            return '❌ Usage: unauthorize @username or unauthorize phone_number';
        }

        const target = parts[1];
        const targetUserId = this.extractUserId(target);
        const queueManager = this.bot.getQueueManager();
        
        queueManager.removeAuthorizedUser(targetUserId);
        return `✅ ${target} unauthorized from queue commands!`;
    }

    // Simple Help Command for Users
    async handleHelp(parts, userId, userName, message) {
        return `🤖 **Dishwasher Bot - Simple Commands**\n\n` +
               `📋 **Queue Commands:**\n` +
               `• \`done\` - Complete your turn\n` +
               `• \`status\` - Show current queue\n\n` +
               `🔄 **Swap Commands:**\n` +
               `• \`swap @user\` - Request to swap positions\n` +
               `• \`approve <id>\` - Approve swap request\n` +
               `• \`reject <id>\` - Reject swap request\n\n` +
               `⚡ **Punishment:**\n` +
               `• \`punish @user +3 reason\` - Submit punishment request\n\n` +
               `🎯 **Fixed Queue:** Eden → Adele → Emma → (repeating)`;
    }

    // Detailed Help Command for Admins
    async handleDetailedHelp(parts, userId, userName, message) {
        return `🤖 **WhatsApp Dishwasher Bot - Complete Commands**\n\n` +
               `📍 **Note:** This bot only works in groups with "dishwasher" in the name!\n\n` +
               `📋 **Fixed Queue System:**\n` +
               `• \`done\` - Complete your turn (moves to next person)\n` +
               `• \`status\` - Show current queue status\n\n` +
               `🎯 **Fixed Queue Order:** Eden → Adele → Emma → (repeating)\n\n` +
               `🔄 **Turn Flexibility:**\n` +
               `• \`swap @user\` - Request to swap positions\n` +
               `• \`approve <id>\` - Approve swap request\n` +
               `• \`reject <id>\` - Reject swap request\n` +
               `• \`skip [reason]\` - Request to skip turn\n\n` +
               `⚡ **Punishments:**\n` +
               `• \`punish @user +3 reason\` - Submit punishment request\n` +
               `• \`punishments\` - View punishment history\n` +
               `• \`punishments stats\` - View punishment statistics\n\n` +
               `👨‍💼 **Admin Commands:**\n` +
               `• \`addadmin @user\` - Add admin\n` +
               `• \`removeadmin @user\` - Remove admin\n` +
               `• \`authorize @user\` - Authorize queue user\n` +
               `• \`unauthorize @user\` - Unauthorize queue user\n` +
               `• \`approve punishment <id>\` - Approve punishment\n` +
               `• \`reject punishment <id>\` - Reject punishment\n` +
               `• \`approve skip <user>\` - Approve skip request\n` +
               `• \`reject skip <user>\` - Reject skip request\n\n` +
               `❓ **Help Commands:**\n` +
               `• \`help\` - Simple user commands\n` +
               `• \`helphelp\` - Complete admin commands`;
    }

    // Utility method to extract user ID from mention or phone number
    extractUserId(input) {
        // If it's a mention (@username), extract the username
        if (input.startsWith('@')) {
            return input.substring(1);
        }
        
        // If it's a phone number, clean it up
        if (input.match(/^\d+$/)) {
            return input.includes('@') ? input : `${input}@c.us`;
        }
        
        // If it already contains @c.us, return as-is
        if (input.includes('@c.us')) {
            return input;
        }
        
        // Otherwise, assume it's a phone number and add @c.us
        return `${input}@c.us`;
    }
}

module.exports = CommandHandler;
