class TelegramCommandHandler {
    constructor(queueManager, punishmentManager, bot) {
        this.queueManager = queueManager;
        this.punishmentManager = punishmentManager;
        this.bot = bot;
        
        // Register commands
        this.commands = {
            'start': this.handleStart.bind(this),
            'help': this.handleHelp.bind(this),
            'helphelp': this.handleDetailedHelp.bind(this),
            'status': this.handleStatus.bind(this),
            'done': this.handleDone.bind(this),
            'swap': this.handleSwap.bind(this),
            'approve': this.handleApprove.bind(this),
            'reject': this.handleReject.bind(this),
            'skip': this.handleSkip.bind(this),
            'punish': this.handlePunish.bind(this),
            'punishments': this.handlePunishments.bind(this),
            'addadmin': this.handleAddAdmin.bind(this),
            'removeadmin': this.handleRemoveAdmin.bind(this),
            'authorize': this.handleAuthorize.bind(this),
            'unauthorize': this.handleUnauthorize.bind(this)
        };
    }
    
    async handleMessage(chatId, userId, userName, text) {
        try {
            const command = text.toLowerCase().trim();
            
            console.log(`🔍 Processing command: "${command}" from text: "${text}"`);
            
            // Handle callback data (button presses)
            if (command.startsWith('callback_')) {
                return await this.handleCallback(chatId, userId, userName, command);
            }
            
            // Check if it's a registered command
            if (this.commands[command]) {
                console.log(`✅ Found command: ${command}`);
                await this.commands[command](chatId, userId, userName, text);
            } else {
                console.log(`⏭️ No command found for: "${command}"`);
                await this.bot.sendMessage(chatId, '❌ Unknown command. Type /help to see available commands.');
            }
            
        } catch (error) {
            console.log('❌ Error in handleMessage:', error.message);
            await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }
    
    async handleCallback(chatId, userId, userName, data) {
        try {
            console.log(`🔘 Processing callback: "${data}"`);
            
            if (data === 'callback_done') {
                await this.handleDone(chatId, userId, userName, 'done');
            } else if (data === 'callback_status') {
                await this.handleStatus(chatId, userId, userName, 'status');
            } else if (data === 'callback_swap') {
                await this.showSwapOptions(chatId, userId, userName);
            } else if (data === 'callback_punish') {
                await this.showPunishOptions(chatId, userId, userName);
            } else if (data === 'callback_punishments') {
                await this.handlePunishments(chatId, userId, userName, 'punishments');
            } else if (data.startsWith('callback_swap_')) {
                const targetName = data.replace('callback_swap_', '');
                await this.handleSwap(chatId, userId, userName, `swap @${targetName}`);
            } else if (data.startsWith('callback_punish_')) {
                const targetName = data.replace('callback_punish_', '');
                await this.showPunishReasons(chatId, userId, userName, targetName);
            } else if (data.startsWith('callback_punish_reason_')) {
                const parts = data.replace('callback_punish_reason_', '').split('_');
                const targetName = parts[0];
                const reason = parts[1];
                await this.handlePunish(chatId, userId, userName, `punish @${targetName} +3 ${reason}`);
            } else if (data.startsWith('callback_approve_')) {
                const requestId = data.replace('callback_approve_', '');
                await this.handleApprove(chatId, userId, userName, `approve ${requestId}`);
            } else if (data.startsWith('callback_reject_')) {
                const requestId = data.replace('callback_reject_', '');
                await this.handleReject(chatId, userId, userName, `reject ${requestId}`);
            }
            
        } catch (error) {
            console.log('❌ Error in handleCallback:', error.message);
            await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }
    
    async handleStart(chatId, userId, userName, text) {
        const welcomeMessage = `🤖 **Welcome to the Dishwasher Bot!**\n\n` +
            `👋 Hi ${userName}! This bot helps manage your dishwasher queue.\n\n` +
            `📋 **Fixed Queue:** Eden → Adele → Emma → (repeating)\n\n` +
            `🎯 **Quick Actions:**`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '📋 Status', callback_data: 'callback_status' },
                    { text: '✅ Done', callback_data: 'callback_done' }
                ],
                [
                    { text: '🔄 Swap', callback_data: 'callback_swap' },
                    { text: '⚡ Punish', callback_data: 'callback_punish' }
                ],
                [
                    { text: '📊 Punishments', callback_data: 'callback_punishments' },
                    { text: '❓ Help', callback_data: 'callback_help' }
                ]
            ]
        };
        
        await this.bot.sendMessage(chatId, welcomeMessage, { 
            parse_mode: 'Markdown',
            reply_markup: keyboard 
        });
    }
    
    async handleHelp(chatId, userId, userName, text) {
        const helpMessage = `🤖 **Dishwasher Bot - Simple Commands**\n\n` +
            `📋 **Queue Commands:**\n` +
            `• \`/done\` - Complete your turn\n` +
            `• \`/status\` - Show current queue\n\n` +
            `🔄 **Swap Commands:**\n` +
            `• \`/swap @user\` - Request to swap positions\n` +
            `• \`/approve <id>\` - Approve swap request\n` +
            `• \`/reject <id>\` - Reject swap request\n\n` +
            `⚡ **Punishment:**\n` +
            `• \`/punish @user +3 reason\` - Submit punishment request\n\n` +
            `🎯 **Fixed Queue:** Eden → Adele → Emma → (repeating)\n\n` +
            `❓ Type \`/helphelp\` for detailed admin commands`;
        
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '📋 Status', callback_data: 'callback_status' },
                    { text: '✅ Done', callback_data: 'callback_done' }
                ],
                [
                    { text: '🔄 Swap', callback_data: 'callback_swap' },
                    { text: '⚡ Punish', callback_data: 'callback_punish' }
                ],
                [
                    { text: '❓ Detailed Help', callback_data: 'callback_helphelp' }
                ]
            ]
        };
        
        await this.bot.sendMessage(chatId, helpMessage, { 
            parse_mode: 'Markdown',
            reply_markup: keyboard 
        });
    }
    
    async handleDetailedHelp(chatId, userId, userName, text) {
        const helpMessage = `🤖 **Dishwasher Bot - Complete Commands**\n\n` +
            `📋 **Fixed Queue System:**\n` +
            `• \`/done\` - Complete your turn (moves to next person)\n` +
            `• \`/status\` - Show current queue status\n\n` +
            `🎯 **Fixed Queue Order:** Eden → Adele → Emma → (repeating)\n\n` +
            `🔄 **Turn Flexibility:**\n` +
            `• \`/swap @user\` - Request to swap positions\n` +
            `• \`/approve <id>\` - Approve swap request\n` +
            `• \`/reject <id>\` - Reject swap request\n` +
            `• \`/skip [reason]\` - Request to skip turn\n\n` +
            `⚡ **Punishments:**\n` +
            `• \`/punish @user +3 reason\` - Submit punishment request\n` +
            `• \`/punishments\` - View punishment history\n` +
            `• \`/punishments stats\` - View punishment statistics\n\n` +
            `👨‍💼 **Admin Commands:**\n` +
            `• \`/addadmin @user\` - Add admin\n` +
            `• \`/removeadmin @user\` - Remove admin\n` +
            `• \`/authorize @user\` - Authorize queue user\n` +
            `• \`/unauthorize @user\` - Unauthorize queue user\n` +
            `• \`/approve punishment <id>\` - Approve punishment\n` +
            `• \`/reject punishment <id>\` - Reject punishment\n` +
            `• \`/approve skip <user>\` - Approve skip request\n` +
            `• \`/reject skip <user>\` - Reject skip request\n\n` +
            `❓ **Help Commands:**\n` +
            `• \`/help\` - Simple user commands\n` +
            `• \`/helphelp\` - Complete admin commands`;
        
        await this.bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
    }
    
    async handleStatus(chatId, userId, userName, text) {
        try {
            const status = this.queueManager.getStatus();
            await this.bot.sendMessage(chatId, status, { parse_mode: 'Markdown' });
        } catch (error) {
            await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }
    
    async handleDone(chatId, userId, userName, text) {
        try {
            const result = this.queueManager.completeTurn(userId, userName);
            await this.bot.sendMessage(chatId, result, { parse_mode: 'Markdown' });
        } catch (error) {
            await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }
    
    async showSwapOptions(chatId, userId, userName) {
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🔄 Swap with Eden', callback_data: 'callback_swap_Eden Aronov' },
                    { text: '🔄 Swap with Adele', callback_data: 'callback_swap_Adele Aronov' }
                ],
                [
                    { text: '🔄 Swap with Emma', callback_data: 'callback_swap_Emma Aronov' }
                ]
            ]
        };
        
        await this.bot.sendMessage(chatId, '🔄 **Choose who you want to swap with:**', { 
            parse_mode: 'Markdown',
            reply_markup: keyboard 
        });
    }
    
    async handleSwap(chatId, userId, userName, text) {
        try {
            const result = this.queueManager.requestSwap(userId, userName, text);
            await this.bot.sendMessage(chatId, result, { parse_mode: 'Markdown' });
        } catch (error) {
            await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }
    
    async handleApprove(chatId, userId, userName, text) {
        try {
            const result = this.queueManager.approveSwap(userId, userName, text);
            await this.bot.sendMessage(chatId, result, { parse_mode: 'Markdown' });
        } catch (error) {
            await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }
    
    async handleReject(chatId, userId, userName, text) {
        try {
            const result = this.queueManager.rejectSwap(userId, userName, text);
            await this.bot.sendMessage(chatId, result, { parse_mode: 'Markdown' });
        } catch (error) {
            await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }
    
    async handleSkip(chatId, userId, userName, text) {
        try {
            const result = this.queueManager.requestSkip(userId, userName, text);
            await this.bot.sendMessage(chatId, result, { parse_mode: 'Markdown' });
        } catch (error) {
            await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }
    
    async showPunishOptions(chatId, userId, userName) {
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '⚡ Punish Eden', callback_data: 'callback_punish_Eden Aronov' },
                    { text: '⚡ Punish Adele', callback_data: 'callback_punish_Adele Aronov' }
                ],
                [
                    { text: '⚡ Punish Emma', callback_data: 'callback_punish_Emma Aronov' }
                ]
            ]
        };
        
        await this.bot.sendMessage(chatId, '⚡ **Choose who you want to punish:**', { 
            parse_mode: 'Markdown',
            reply_markup: keyboard 
        });
    }
    
    async showPunishReasons(chatId, userId, userName, targetName) {
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '🍽️ Forgot dishes', callback_data: `callback_punish_reason_${targetName}_forgot_dishes` },
                    { text: '⏰ Late', callback_data: `callback_punish_reason_${targetName}_late` }
                ],
                [
                    { text: '🚫 Skipped turn', callback_data: `callback_punish_reason_${targetName}_skipped_turn` },
                    { text: '😴 Lazy', callback_data: `callback_punish_reason_${targetName}_lazy` }
                ],
                [
                    { text: '🤷 Other reason', callback_data: `callback_punish_reason_${targetName}_other` }
                ]
            ]
        };
        
        await this.bot.sendMessage(chatId, `⚡ **Choose reason for punishing ${targetName}:**`, { 
            parse_mode: 'Markdown',
            reply_markup: keyboard 
        });
    }
    
    async handlePunish(chatId, userId, userName, text) {
        try {
            const result = this.punishmentManager.submitPunishment(userId, userName, text);
            await this.bot.sendMessage(chatId, result, { parse_mode: 'Markdown' });
        } catch (error) {
            await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }
    
    async handlePunishments(chatId, userId, userName, text) {
        try {
            const result = this.punishmentManager.getPunishmentHistory();
            await this.bot.sendMessage(chatId, result, { parse_mode: 'Markdown' });
        } catch (error) {
            await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }
    
    async handleAddAdmin(chatId, userId, userName, text) {
        try {
            const result = this.punishmentManager.addAdmin(userId, userName, text);
            await this.bot.sendMessage(chatId, result, { parse_mode: 'Markdown' });
        } catch (error) {
            await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }
    
    async handleRemoveAdmin(chatId, userId, userName, text) {
        try {
            const result = this.punishmentManager.removeAdmin(userId, userName, text);
            await this.bot.sendMessage(chatId, result, { parse_mode: 'Markdown' });
        } catch (error) {
            await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }
    
    async handleAuthorize(chatId, userId, userName, text) {
        try {
            const result = this.queueManager.authorizeUser(userId, userName, text);
            await this.bot.sendMessage(chatId, result, { parse_mode: 'Markdown' });
        } catch (error) {
            await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }
    
    async handleUnauthorize(chatId, userId, userName, text) {
        try {
            const result = this.queueManager.unauthorizeUser(userId, userName, text);
            await this.bot.sendMessage(chatId, result, { parse_mode: 'Markdown' });
        } catch (error) {
            await this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }
}

module.exports = TelegramCommandHandler;
