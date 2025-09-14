// Simple Telegram Dishwasher Bot (no external dependencies)
const https = require('https');
const fs = require('fs');

const token = '8488813166:AAEk3G5Qe8Yw0B3OlAfLLYq8qszdPL0obUI';
const botUrl = `https://api.telegram.org/bot${token}`;

// Simple queue management
let currentTurn = 0;
const queue = ['Eden Aronov', 'Adele Aronov', 'Emma Aronov'];

// User management
const admins = new Set(); // Set of admin user IDs
const authorizedUsers = new Set(); // Set of authorized user IDs (max 3)

// Link Telegram users to queue names
const userQueueMapping = new Map(); // Map: Telegram user ID -> Queue name
const queueUserMapping = new Map(); // Map: Queue name -> Telegram user ID

// Swap request tracking
const pendingSwaps = new Map(); // Map: requestId -> {fromUser, toUser, fromUserId, toUserId, timestamp}
let swapRequestCounter = 0;

// Punishment system (simplified - no strike counting)
const userPunishments = new Map(); // Map: userName -> {punishmentCount, extraTurns, endDate}
const pendingPunishments = new Map(); // Map: requestId -> {fromUser, targetUser, reason, fromUserId, timestamp}
const punishmentTurns = new Map(); // Map: userName -> number of punishment turns remaining
let punishmentRequestCounter = 0;

// Send message to Telegram
function sendMessage(chatId, text) {
    const url = `${botUrl}/sendMessage`;
    const data = JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
    });
    
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };
    
    const req = https.request(url, options, (res) => {
        console.log(`📤 Sent message to ${chatId}`);
    });
    
    req.write(data);
    req.end();
}

// Send message with buttons
function sendMessageWithButtons(chatId, text, buttons) {
    const url = `${botUrl}/sendMessage`;
    const data = JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: buttons
        }
    });
    
    console.log(`🔘 Sending buttons to ${chatId}:`, JSON.stringify(buttons, null, 2));
    console.log(`🔘 Full request data:`, data);
    
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };
    
    const req = https.request(url, options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
            responseData += chunk;
        });
        res.on('end', () => {
            console.log(`📤 Button response:`, responseData);
            try {
                const response = JSON.parse(responseData);
                if (response.ok) {
                    console.log(`✅ Buttons sent successfully!`);
                } else {
                    console.log(`❌ Button error:`, response.description);
                }
            } catch (e) {
                console.log(`❌ Error parsing button response:`, e.message);
            }
        });
    });
    
    req.write(data);
    req.end();
}

// Handle commands
function handleCommand(chatId, userId, userName, text) {
    const command = text.toLowerCase().trim();
    
    console.log(`🔍 Processing: "${command}" from ${userName}`);
    
    if (command === '/start') {
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        const isAuthorized = authorizedUsers.has(userName);
        
        let text = `Dishwasher Bot Menu`;
        let buttons = [];
        
        if (isAdmin) {
            text += `Admin Menu - Full Access`;
            buttons = [
                [
                    { text: "Status", callback_data: "status" },
                    { text: "Done", callback_data: "done" }
                ],
                [
                    { text: "Users", callback_data: "users" },
                    { text: "Admins", callback_data: "admins" }
                ],
                [
                    { text: "Authorize", callback_data: "authorize_menu" },
                    { text: "Add Admin", callback_data: "addadmin_menu" }
                ],
                [
                    { text: "Force Swap", callback_data: "force_swap_menu" },
                    { text: "Apply Punishment", callback_data: "apply_punishment_menu" }
                ]
            ];
        } else if (isAuthorized) {
            text += `User Menu - Queue Access`;
            buttons = [
                [
                    { text: "Status", callback_data: "status" },
                    { text: "Done", callback_data: "done" }
                ],
                [
                    { text: "Swap", callback_data: "swap_menu" },
                    { text: "Request Punishment", callback_data: "request_punishment_menu" }
                ],
                [
                    { text: "Help", callback_data: "help" }
                ]
            ];
        } else {
            text += `Guest Menu - Limited Access`;
            buttons = [
                [
                    { text: "Status", callback_data: "status" },
                    { text: "Help", callback_data: "help" }
                ],
                [
                    { text: "Request Access", callback_data: "request_access" }
                ]
            ];
        }
        
        const url = `${botUrl}/sendMessage`;
        const data = JSON.stringify({
            chat_id: chatId,
            text: text,
            reply_markup: {
                inline_keyboard: buttons
            }
        });
        
        console.log(`🔘 Sending role-based buttons:`, JSON.stringify(buttons, null, 2));
        
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
            }
        };
        
        const req = https.request(url, options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            res.on('end', () => {
                console.log(`📤 Role-based response:`, responseData);
                try {
                    const response = JSON.parse(responseData);
                    if (response.ok) {
                        console.log(`✅ Buttons sent successfully!`);
                        if (response.result.reply_markup) {
                            console.log(`🔘 Reply markup present:`, JSON.stringify(response.result.reply_markup, null, 2));
                        } else {
                            console.log(`❌ No reply_markup in response!`);
                        }
                    } else {
                        console.log(`❌ Button error:`, response.description);
                    }
                } catch (e) {
                    console.log(`❌ Error parsing response:`, e.message);
                }
            });
        });
        
        req.write(data);
        req.end();
        
    } else if (command === '/status' || command === 'status') {
        let statusMessage = `📋 **Dishwasher Queue Status:**\n\n`;
        
        // Debug: Show current queue state
        console.log(`🔍 DEBUG - Current queue: [${queue.join(', ')}]`);
        console.log(`🔍 DEBUG - Current turn: ${currentTurn}`);
        console.log(`🔍 DEBUG - Queue length: ${queue.length}`);
        
        // Show only the next 3 consecutive turns (current + next 2)
        for (let i = 0; i < 3; i++) {
            const turnIndex = (currentTurn + i) % queue.length;
            const name = queue[turnIndex];
            const isCurrentTurn = i === 0;
            const turnIcon = isCurrentTurn ? '🔄' : '⏳';
            const turnText = isCurrentTurn ? ' - **CURRENT TURN**' : '';
            
            // Check if this queue member is authorized
            const authorizedUser = queueUserMapping.get(name);
            const authText = authorizedUser ? ` (${authorizedUser})` : ' (Not authorized)';
            
            statusMessage += `${turnIcon} ${i + 1}. ${name}${turnText}${authText}\n`;
        }
        
        statusMessage += `\n👥 **Authorized Users:** ${authorizedUsers.size}/3`;
        
        // Show punishment information
        const usersWithPunishments = Array.from(punishmentTurns.entries()).filter(([user, turns]) => turns > 0);
        if (usersWithPunishments.length > 0) {
            statusMessage += `\n\n⚡ **Active Punishments:**`;
            usersWithPunishments.forEach(([user, turns]) => {
                statusMessage += `\n• ${user}: ${turns} punishment turn${turns > 1 ? 's' : ''} remaining`;
            });
        }
        
        sendMessage(chatId, statusMessage);
        
    } else if (command === '/done' || command === 'done') {
        // Check if user is admin
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        
        if (isAdmin) {
            // Admin "Done" - Admin takes over dishwasher duty
            const currentUser = queue[currentTurn];
            
            // Check if this was a punishment turn and remove it BEFORE advancing
            const punishmentTurnsRemaining = punishmentTurns.get(currentUser) || 0;
            if (punishmentTurnsRemaining > 0) {
                punishmentTurns.set(currentUser, punishmentTurnsRemaining - 1);
                
                // Remove the FIRST occurrence of the punished user (always the punishment turn)
                const punishmentIndex = queue.indexOf(currentUser);
                if (punishmentIndex !== -1) {
                    queue.splice(punishmentIndex, 1);
                    console.log(`⚡ Punishment turn completed for ${currentUser}. Removed from queue. Remaining: ${punishmentTurnsRemaining - 1}`);
                }
                
                // For punishment turns, don't advance currentTurn since queue has already shifted
                // currentTurn stays the same because we removed the current position
            } else {
                // Only advance currentTurn for normal turns
                currentTurn = (currentTurn + 1) % queue.length;
            }
            
            // Check for temporary swap reversion
            if (global.tempSwaps && global.tempSwaps.has('current')) {
                const tempSwap = global.tempSwaps.get('current');
                if (tempSwap.isActive) {
                    // Revert the temporary swap
                    const firstIndex = queue.indexOf(tempSwap.firstUser);
                    const secondIndex = queue.indexOf(tempSwap.secondUser);
                    
                    if (firstIndex !== -1 && secondIndex !== -1) {
                        [queue[firstIndex], queue[secondIndex]] = [queue[secondIndex], queue[firstIndex]];
                        console.log(`🔄 Temporary swap reverted: ${tempSwap.firstUser} ↔ ${tempSwap.secondUser}`);
                        console.log(`🔍 DEBUG - After reversion: [${queue.join(', ')}]`);
                    }
                    
                    // Mark swap as inactive
                    tempSwap.isActive = false;
                    global.tempSwaps.delete('current');
                }
            }
            
            const nextUser = queue[currentTurn];
            
            const adminDoneMessage = `✅ **ADMIN INTERVENTION!**\n\n` +
                `👨‍💼 **Admin:** ${userName} completed dishwasher duty\n` +
                `👤 **Helped user:** ${currentUser}\n` +
                `🔄 **Next turn:** ${nextUser}` +
                (punishmentTurnsRemaining > 0 ? `\n⚡ **Punishment turns remaining:** ${punishmentTurnsRemaining - 1}` : '') +
                `\n\n💡 **Admin can manually apply punishment to ${currentUser} if needed**`;
            
            // Send confirmation to admin
            sendMessage(chatId, adminDoneMessage);
            
            // Notify all authorized users and admins
            [...authorizedUsers, ...admins].forEach(user => {
                const userChatId = userQueueMapping.get(user) ? queueUserMapping.get(userQueueMapping.get(user)) : null;
                if (userChatId) {
                    sendMessage(userChatId, adminDoneMessage);
                }
            });
            
        } else {
            // Regular user "Done" - Check if user is authorized
            if (!authorizedUsers.has(userName)) {
                sendMessage(chatId, `❌ **Not authorized!**\n\n👤 ${userName} is not authorized to use queue commands.\n\n💡 **Ask an admin to authorize you:**\n\`/authorize ${userName}\``);
                return;
            }
            
            const currentUser = queue[currentTurn];
            const userQueueName = userQueueMapping.get(userName);
            
            // Check if it's actually their turn
            if (userQueueName !== currentUser) {
                sendMessage(chatId, `❌ **Not your turn!**\n\n🔄 **Current turn:** ${currentUser}\n👤 **Your queue position:** ${userQueueName}\n\n⏳ Please wait for your turn.`);
                return;
            }
            
            // Check if this was a punishment turn and remove it BEFORE advancing
            const punishmentTurnsRemaining = punishmentTurns.get(currentUser) || 0;
            if (punishmentTurnsRemaining > 0) {
                punishmentTurns.set(currentUser, punishmentTurnsRemaining - 1);
                
                // Remove the FIRST occurrence of the punished user (always the punishment turn)
                const punishmentIndex = queue.indexOf(currentUser);
                if (punishmentIndex !== -1) {
                    queue.splice(punishmentIndex, 1);
                    console.log(`⚡ Punishment turn completed for ${currentUser}. Removed from queue. Remaining: ${punishmentTurnsRemaining - 1}`);
                }
                
                // For punishment turns, don't advance currentTurn since queue has already shifted
                // currentTurn stays the same because we removed the current position
            } else {
                // Only advance currentTurn for normal turns
                currentTurn = (currentTurn + 1) % queue.length;
            }
            
            // Check for temporary swap reversion
            if (global.tempSwaps && global.tempSwaps.has('current')) {
                const tempSwap = global.tempSwaps.get('current');
                if (tempSwap.isActive) {
                    // Revert the temporary swap
                    const firstIndex = queue.indexOf(tempSwap.firstUser);
                    const secondIndex = queue.indexOf(tempSwap.secondUser);
                    
                    if (firstIndex !== -1 && secondIndex !== -1) {
                        [queue[firstIndex], queue[secondIndex]] = [queue[secondIndex], queue[firstIndex]];
                        console.log(`🔄 Temporary swap reverted: ${tempSwap.firstUser} ↔ ${tempSwap.secondUser}`);
                        console.log(`🔍 DEBUG - After reversion: [${queue.join(', ')}]`);
                    }
                    
                    // Mark swap as inactive
                    tempSwap.isActive = false;
                    global.tempSwaps.delete('current');
                }
            }
            
            const nextUser = queue[currentTurn];
            
            const doneMessage = `✅ **TURN COMPLETED!**\n\n` +
                `👤 **Completed by:** ${currentUser}\n` +
                `🔄 **Next turn:** ${nextUser}` +
                (punishmentTurnsRemaining > 0 ? `\n⚡ **Punishment turns remaining:** ${punishmentTurnsRemaining - 1}` : '');
            
            // Notify all authorized users and admins
            [...authorizedUsers, ...admins].forEach(user => {
                const userChatId = userQueueMapping.get(user) ? queueUserMapping.get(userQueueMapping.get(user)) : null;
                if (userChatId) {
                    sendMessage(userChatId, doneMessage);
                }
            });
        }
        
    } else if (command === '/help' || command === 'help') {
        const helpMessage = `🤖 **Dishwasher Bot Commands:**\n\n` +
            `📋 **Queue Commands:**\n` +
            `• \`/status\` - Show current queue\n` +
            `• \`/done\` - Complete your turn\n\n` +
            `🔄 **Swap Features:**\n` +
            `• **Swap** - Request to swap with another user (requires approval)\n` +
            `• **Force Swap** - Admin can force swap any two users (no approval needed)\n\n` +
            `⚡ **Punishment System:**\n` +
            `• **Request Punishment** - Report another user (notifies admins)\n` +
            `• **Apply Punishment** - Admin can punish directly (3 EXTRA turns)\n` +
            `• **Simple & Direct** (no strike counting needed!)\n\n` +
            `👥 **User Management:**\n` +
            `• \`/admins\` - Show current admins\n` +
            `• \`/users\` - Show authorized users\n` +
            `• \`/addadmin <user>\` - Add admin\n` +
            `• \`/removeadmin <user>\` - Remove admin\n` +
            `• \`/authorize <user>\` - Authorize user\n\n` +
            `🎯 **Fixed Queue:** Eden → Adele → Emma → (repeating)\n\n` +
            `💡 **Tip:** Use the buttons for easier mobile interaction!`;
        
        sendMessage(chatId, helpMessage);
        
    } else if (command === '/admins' || command === 'admins') {
        if (admins.size === 0) {
            sendMessage(chatId, '👨‍💼 **No admins set yet.**\n\nUse `/addadmin <user>` to add an admin.');
        } else {
            const adminList = Array.from(admins).map(id => {
                // Check if it's a numeric ID or username
                if (/^\d+$/.test(id)) {
                    return `• User ID: ${id}`;
                } else {
                    return `• Username: ${id}`;
                }
            }).join('\n');
            sendMessage(chatId, `👨‍💼 **Current Admins:**\n\n${adminList}\n\n📊 **Total admins:** ${admins.size}`);
        }
        
    } else if (command === '/users' || command === 'users') {
        if (authorizedUsers.size === 0) {
            sendMessage(chatId, '👥 **No authorized users set yet.**\n\nUse `/authorize <user>` to authorize a user.\n\n📋 **Available queue members:**\n• Eden Aronov\n• Adele Aronov\n• Emma Aronov');
        } else {
            let userList = '👥 **Authorized Users:**\n\n';
            authorizedUsers.forEach(user => {
                const queueName = userQueueMapping.get(user);
                userList += `• ${user} → ${queueName}\n`;
            });
            userList += `\n📝 **Note:** Maximum 3 authorized users allowed.`;
            sendMessage(chatId, userList);
        }
        
    } else if (command.startsWith('/addadmin ')) {
        // Check if user is already an admin (allow first admin to be added)
        if (admins.size > 0 && !admins.has(userName) && !admins.has(userName.toLowerCase()) && !admins.has(userId.toString())) {
            sendMessage(chatId, `❌ **Admin access required!**\n\n👤 ${userName} is not an admin.\n\n💡 **Ask an existing admin to add you:**\n\`/addadmin ${userName}\``);
            return;
        }
        
        const userToAdd = command.replace('/addadmin ', '').trim();
        if (userToAdd) {
            // Allow first admin to add themselves, but prevent self-promotion for existing admins
            if (admins.size > 0 && (userToAdd.toLowerCase() === userName.toLowerCase() || userToAdd === userId.toString())) {
                sendMessage(chatId, `❌ **Cannot add yourself as admin!**\n\n🛡️ **Security protection:** Only other admins can promote you.\n\n💡 **Ask another admin to add you:**\n\`/addadmin ${userName}\``);
                return;
            }
            
            // Add both username and user ID for flexibility
            admins.add(userToAdd);
            admins.add(userToAdd.toLowerCase()); // Add lowercase version for case-insensitive matching
            admins.add(userId.toString()); // Add user ID for the person adding the admin
            sendMessage(chatId, `✅ **Admin Added!**\n\n👨‍💼 ${userToAdd} is now an admin.\n\n🔑 **Admin privileges:**\n• Manage queue\n• Authorize users\n• Add/remove admins\n• Force swaps\n• Apply punishments`);
        } else {
            sendMessage(chatId, '❌ **Usage:** `/addadmin <username>`\n\nExample: `/addadmin Dani`');
        }
        
    } else if (command.startsWith('/removeadmin ')) {
        // Check if user is already an admin
        if (!admins.has(userName) && !admins.has(userName.toLowerCase()) && !admins.has(userId.toString())) {
            sendMessage(chatId, `❌ **Admin access required!**\n\n👤 ${userName} is not an admin.`);
            return;
        }
        
        const userToRemove = command.replace('/removeadmin ', '').trim();
        if (userToRemove) {
            // Prevent self-removal (security protection)
            if (userToRemove.toLowerCase() === userName.toLowerCase() || userToRemove === userId.toString()) {
                sendMessage(chatId, `❌ **Cannot remove yourself as admin!**\n\n🛡️ **Security protection:** Only other admins can remove you.\n\n💡 **Ask another admin to remove you:**\n\`/removeadmin ${userName}\``);
                return;
            }
            
            // Check if user exists in admins
            if (admins.has(userToRemove)) {
                admins.delete(userToRemove);
                sendMessage(chatId, `✅ **Admin Removed!**\n\n👤 ${userToRemove} is no longer an admin.\n\n🔒 **Admin privileges revoked.**`);
            } else {
                sendMessage(chatId, `❌ **User not found!**\n\n👤 ${userToRemove} is not an admin.\n\n💡 **Use \`/admins\` to see current admins.**`);
            }
        } else {
            sendMessage(chatId, '❌ **Usage:** `/removeadmin <username>`\n\nExample: `/removeadmin Dani`');
        }
        
    } else if (command.startsWith('punishment_reason_')) {
        // Handle punishment reason input
        const parts = command.split(' ');
        const requestId = parseInt(parts[0].replace('punishment_reason_', ''));
        const reason = parts.slice(1).join(' ');
        
        const punishmentRequest = pendingPunishments.get(requestId);
        if (!punishmentRequest) {
            sendMessage(chatId, '❌ **Punishment request not found or expired!**');
            return;
        }
        
        if (punishmentRequest.fromUserId !== userId) {
            sendMessage(chatId, '❌ **This punishment request is not yours!**');
            return;
        }
        
        // Update the request with reason
        punishmentRequest.reason = reason;
        
        // Notify all admins
        const adminMessage = `⚡ **Punishment Request**\n\n👤 **From:** ${userName}\n🎯 **Target:** ${punishmentRequest.targetUser}\n📝 **Reason:** ${reason}\n\n⏰ **Request expires in 10 minutes**`;
        
        const buttons = [
            [
                { text: "✅ Approve", callback_data: `punishment_approve_${requestId}` },
                { text: "❌ Reject", callback_data: `punishment_reject_${requestId}` }
            ]
        ];
        
        // Send to all admins
        admins.forEach(admin => {
            const adminChatId = userQueueMapping.get(admin) ? queueUserMapping.get(userQueueMapping.get(admin)) : null;
            if (adminChatId) {
                sendMessageWithButtons(adminChatId, adminMessage, buttons);
            }
        });
        
        sendMessage(chatId, `✅ **Punishment request sent to admins!**\n\n🎯 **Target:** ${punishmentRequest.targetUser}\n📝 **Reason:** ${reason}\n⏰ **Waiting for admin approval...**`);
        
    } else if (command.startsWith('admin_punishment_reason_')) {
        // Handle admin punishment reason input
        const parts = command.split(' ');
        const requestId = parseInt(parts[0].replace('admin_punishment_reason_', ''));
        const reason = parts.slice(1).join(' ');
        
        const punishmentRequest = pendingPunishments.get(requestId);
        if (!punishmentRequest) {
            sendMessage(chatId, '❌ **Punishment request not found or expired!**');
            return;
        }
        
        if (punishmentRequest.fromUserId !== userId) {
            sendMessage(chatId, '❌ **This punishment request is not yours!**');
            return;
        }
        
        // Apply punishment directly (admin doesn't need approval)
        applyPunishment(punishmentRequest.targetUser, reason, userName);
        
        sendMessage(chatId, `✅ **Punishment Applied!**\n\n🎯 **Target:** ${punishmentRequest.targetUser}\n📝 **Reason:** ${reason}\n👨‍💼 **Applied by:** ${userName}`);
        
        // Remove request
        pendingPunishments.delete(requestId);
        
    } else if (command.startsWith('/authorize ')) {
        // Check if user is an admin
        if (!admins.has(userName) && !admins.has(userName.toLowerCase()) && !admins.has(userId.toString())) {
            sendMessage(chatId, `❌ **Admin access required!**\n\n👤 ${userName} is not an admin.\n\n💡 **Only admins can authorize users.**`);
            return;
        }
        
        const userToAuth = command.replace('/authorize ', '').trim();
        if (userToAuth) {
            if (authorizedUsers.size >= 3) {
                sendMessage(chatId, '❌ **Maximum 3 authorized users reached!**\n\nRemove a user first before adding another.');
            } else {
                // Check if user is one of the queue members
                const queueMember = queue.find(name => 
                    name.toLowerCase().includes(userToAuth.toLowerCase()) ||
                    userToAuth.toLowerCase().includes(name.toLowerCase())
                );
                
                if (queueMember) {
                    authorizedUsers.add(userToAuth);
                    userQueueMapping.set(userToAuth, queueMember);
                    queueUserMapping.set(queueMember, userToAuth);
                    sendMessage(chatId, `✅ **User Authorized!**\n\n👥 ${userToAuth} → ${queueMember}\n\n📊 **Total authorized users:** ${authorizedUsers.size}/3`);
                } else {
                    sendMessage(chatId, `❌ **User not in queue!**\n\n👥 **Available queue members:**\n• Eden Aronov\n• Adele Aronov\n• Emma Aronov\n\n💡 **Usage:** \`/authorize Eden\` or \`/authorize Eden Aronov\``);
                }
            }
        } else {
            sendMessage(chatId, '❌ **Usage:** `/authorize <username>`\n\nExample: `/authorize Eden`');
        }
        
    } else {
        sendMessage(chatId, '❌ Unknown command. Type /help to see available commands.');
    }
}

// Apply punishment to a user (ONLY called by admin approval or admin direct action)
function applyPunishment(targetUser, reason, appliedBy) {
    // Apply punishment: 3 EXTRA turns IMMEDIATELY
    const punishmentCount = (userPunishments.get(targetUser)?.punishmentCount || 0) + 1;
    const extraTurns = 3;
    const endDate = new Date(Date.now() + (extraTurns * 24 * 60 * 60 * 1000)); // 3 days from now
    
    userPunishments.set(targetUser, {
        punishmentCount: punishmentCount,
        extraTurns: extraTurns,
        endDate: endDate
    });
    
    // Track punishment turns remaining
    const currentPunishmentTurns = punishmentTurns.get(targetUser) || 0;
    punishmentTurns.set(targetUser, currentPunishmentTurns + extraTurns);
    
    // Apply punishment IMMEDIATELY by adding 3 extra turns to the queue
    console.log(`🔍 DEBUG - Before punishment: queue=[${queue.join(', ')}], currentTurn=${currentTurn}`);
    
    // Insert the punished user 3 times consecutively at the current position (immediately)
    for (let i = 0; i < extraTurns; i++) {
        queue.splice(currentTurn, 0, targetUser);
        console.log(`🔍 DEBUG - After inserting turn ${i + 1}: queue=[${queue.join(', ')}]`);
    }
    
    console.log(`🔍 DEBUG - After punishment: queue=[${queue.join(', ')}], currentTurn=${currentTurn}`);
    
    // Notify all users
    const message = `⚡ **PUNISHMENT APPLIED IMMEDIATELY!**\n\n🎯 **Target:** ${targetUser}\n📝 **Reason:** ${reason}\n👨‍💼 **Applied by:** ${appliedBy}\n\n🚫 **Punishment:** ${extraTurns} EXTRA turns added RIGHT NOW!\n📊 **Total punishment turns:** ${currentPunishmentTurns + extraTurns}\n📅 **Ends:** ${endDate.toLocaleDateString()}`;
    
    // Send to all authorized users and admins
    [...authorizedUsers, ...admins].forEach(user => {
        const userChatId = userQueueMapping.get(user) ? queueUserMapping.get(userQueueMapping.get(user)) : null;
        if (userChatId) {
            sendMessage(userChatId, message);
        }
    });
    
    console.log(`⚡ Punishment applied IMMEDIATELY to ${targetUser}: ${reason} (by ${appliedBy}) - ${extraTurns} extra turns added to queue`);
}

// Report user for punishment (NO strike counting)
function reportUser(targetUser, reason, reportedBy) {
    // Just notify admins about the report
    const message = `📢 **PUNISHMENT REQUEST!**\n\n🎯 **Target:** ${targetUser}\n📝 **Reason:** ${reason}\n👨‍💼 **Reported by:** ${reportedBy}\n\n⚡ **Action:** Admin can use "Apply Punishment" button if needed`;
    
    // Send to all admins
    admins.forEach(admin => {
        const adminChatId = userQueueMapping.get(admin) ? queueUserMapping.get(userQueueMapping.get(admin)) : null;
        if (adminChatId) {
            sendMessage(adminChatId, message);
        }
    });
    
    console.log(`📢 Punishment request for ${targetUser}: ${reason} (by ${reportedBy})`);
}

// Execute approved swap
function executeSwap(swapRequest, requestId, status) {
    const { fromUser, toUser, fromUserId, toUserId } = swapRequest;
    
    // Find queue positions
    const fromIndex = queue.indexOf(userQueueMapping.get(fromUser));
    const toIndex = queue.indexOf(toUser);
    
    if (fromIndex !== -1 && toIndex !== -1) {
        // Swap positions in queue
        [queue[fromIndex], queue[toIndex]] = [queue[toIndex], queue[fromIndex]];
        
        // Update current turn if needed
        if (currentTurn === fromIndex) {
            currentTurn = toIndex;
        } else if (currentTurn === toIndex) {
            currentTurn = fromIndex;
        }
        
        // Notify both users
        const message = `✅ **Swap Approved!**\n\n🔄 **${fromUser} ↔ ${toUser}**\n\n📋 **New queue order:**\n${queue.map((name, index) => `${index + 1}. ${name}${index === currentTurn ? ' (CURRENT TURN)' : ''}`).join('\n')}`;
        
        sendMessage(fromUserId, message);
        sendMessage(toUserId, message);
        
        // Notify all other authorized users
        [...authorizedUsers, ...admins].forEach(user => {
            if (user !== fromUser && user !== toUser) {
                const userChatId = userQueueMapping.get(user) ? queueUserMapping.get(userQueueMapping.get(user)) : null;
                if (userChatId) {
                    sendMessage(userChatId, `🔄 **Queue Update:** ${fromUser} ↔ ${toUser} swapped positions!`);
                }
            }
        });
    }
    
    // Remove the request
    pendingSwaps.delete(requestId);
}

// Handle callback queries (button presses)
function handleCallback(chatId, userId, userName, data) {
    console.log(`🔘 Button pressed: "${data}" by ${userName}`);
    
    if (data === 'test') {
        sendMessage(chatId, `🧪 **Test Button Works!**\n\n✅ Inline buttons are working correctly!\n\n👤 **Pressed by:** ${userName}\n🆔 **User ID:** ${userId}\n🔘 **Button data:** ${data}`);
    } else if (data === 'status') {
        handleCommand(chatId, userId, userName, 'status');
    } else if (data === 'done') {
        handleCommand(chatId, userId, userName, 'done');
    } else if (data === 'users') {
        handleCommand(chatId, userId, userName, 'users');
    } else if (data === 'admins') {
        handleCommand(chatId, userId, userName, 'admins');
    } else if (data === 'help') {
        handleCommand(chatId, userId, userName, 'help');
    } else if (data === 'authorize_menu') {
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        if (isAdmin) {
            const message = `🔧 **Authorize Users**\n\n` +
                `📋 **Available queue members:**\n` +
                `• Eden Aronov\n` +
                `• Adele Aronov\n` +
                `• Emma Aronov\n\n` +
                `💡 **Usage:** Type \`/authorize Eden\` to authorize Eden`;
            sendMessage(chatId, message);
        } else {
            sendMessage(chatId, '❌ **Admin access required!**');
        }
    } else if (data === 'addadmin_menu') {
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        if (isAdmin) {
            const message = `➕ **Add Admin**\n\n` +
                `💡 **Usage:** Type \`/addadmin <username>\`\n\n` +
                `**Example:** \`/addadmin Marianna\``;
            sendMessage(chatId, message);
        } else {
            sendMessage(chatId, '❌ **Admin access required!**');
        }
    } else if (data === 'request_access') {
        const message = `🔐 **Request Access**\n\n` +
            `👤 ${userName}, you need to be authorized to use queue commands.\n\n` +
            `💡 **Ask an admin to authorize you:**\n` +
            `\`/authorize ${userName}\`\n\n` +
            `📋 **Available queue positions:**\n` +
            `• Eden Aronov\n` +
            `• Adele Aronov\n` +
            `• Emma Aronov`;
        sendMessage(chatId, message);
        
        // Notify all admins about the authorization request
        const adminNotification = `🔔 **New Authorization Request**\n\n` +
            `👤 **User:** ${userName}\n` +
            `🆔 **User ID:** ${userId}\n` +
            `📅 **Time:** ${new Date().toLocaleString()}\n\n` +
            `💡 **To authorize:** \`/authorize ${userName}\``;
        
        // Send notification to all admins
        for (const adminId of admins) {
            if (adminId !== userId) { // Don't notify the user themselves
                sendMessage(adminId, adminNotification);
            }
        }
    } else if (data === 'swap_menu') {
        const isAuthorized = authorizedUsers.has(userName);
        if (!isAuthorized) {
            sendMessage(chatId, '❌ **Not authorized!** You need to be authorized to use swap features.');
            return;
        }
        
        const currentUserQueueName = userQueueMapping.get(userName);
        const availableUsers = queue.filter(name => name !== currentUserQueueName);
        
        if (availableUsers.length === 0) {
            sendMessage(chatId, '❌ **No users available to swap with!**');
            return;
        }
        
        const buttons = availableUsers.map(name => [{ text: name, callback_data: `swap_request_${name}` }]);
        
        sendMessageWithButtons(chatId, 
            `🔄 **Request Swap**\n\n👤 **Your position:** ${currentUserQueueName}\n\n🎯 **Select user to swap with:**`, 
            buttons
        );
        
    } else if (data.startsWith('swap_request_')) {
        const targetUser = data.replace('swap_request_', '');
        const currentUserQueueName = userQueueMapping.get(userName);
        
        if (!currentUserQueueName) {
            sendMessage(chatId, '❌ **Error:** Could not find your queue position.');
            return;
        }
        
        // Create swap request
        const requestId = ++swapRequestCounter;
        const targetUserId = queueUserMapping.get(targetUser);
        
        pendingSwaps.set(requestId, {
            fromUser: userName,
            toUser: targetUser,
            fromUserId: userId,
            toUserId: targetUserId,
            timestamp: Date.now()
        });
        
        // Notify the target user
        if (targetUserId) {
            const buttons = [
                [
                    { text: "✅ Approve", callback_data: `swap_approve_${requestId}` },
                    { text: "❌ Reject", callback_data: `swap_reject_${requestId}` }
                ]
            ];
            
            sendMessageWithButtons(targetUserId, 
                `🔄 **Swap Request**\n\n👤 **From:** ${userName} (${currentUserQueueName})\n🎯 **Wants to swap with:** ${targetUser}\n\n⏰ **Request expires in 5 minutes**`, 
                buttons
            );
        }
        
        sendMessage(chatId, `✅ **Swap request sent!**\n\n🎯 **Requested swap with:** ${targetUser}\n⏰ **Waiting for approval...**`);
        
    } else if (data.startsWith('swap_approve_')) {
        const requestId = parseInt(data.replace('swap_approve_', ''));
        const swapRequest = pendingSwaps.get(requestId);
        
        if (!swapRequest) {
            sendMessage(chatId, '❌ **Swap request not found or expired!**');
            return;
        }
        
        // Check if this is the correct user approving
        if (swapRequest.toUserId !== userId) {
            sendMessage(chatId, '❌ **This swap request is not for you!**');
            return;
        }
        
        // Execute the swap
        executeSwap(swapRequest, requestId, 'approved');
        
    } else if (data.startsWith('swap_reject_')) {
        const requestId = parseInt(data.replace('swap_reject_', ''));
        const swapRequest = pendingSwaps.get(requestId);
        
        if (!swapRequest) {
            sendMessage(chatId, '❌ **Swap request not found or expired!**');
            return;
        }
        
        // Check if this is the correct user rejecting
        if (swapRequest.toUserId !== userId) {
            sendMessage(chatId, '❌ **This swap request is not for you!**');
            return;
        }
        
        // Notify the requester
        sendMessage(swapRequest.fromUserId, `❌ **Swap request rejected!**\n\n👤 ${userName} declined your swap request.`);
        sendMessage(chatId, `❌ **Swap request rejected!**\n\n👤 You declined ${swapRequest.fromUser}'s swap request.`);
        
        // Remove the request
        pendingSwaps.delete(requestId);
        
    } else if (data === 'force_swap_menu') {
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        if (!isAdmin) {
            sendMessage(chatId, '❌ **Admin access required!**');
            return;
        }
        
        console.log(`🔍 Queue contents:`, queue);
        // Get unique users from the queue to avoid duplicate buttons
        const uniqueUsers = [...new Set(queue)];
        const buttons = uniqueUsers.map(name => [{ text: name, callback_data: `force_swap_select_${name}` }]);
        console.log(`🔍 Generated buttons:`, buttons);
        
        console.log(`🔍 About to send Force Swap buttons with text: "⚡ **Force Swap** - Select first user:"`);
        // Test with simple text first
        sendMessageWithButtons(chatId, 
            `Force Swap - Select first user:`, 
            buttons
        );
        
    } else if (data.startsWith('force_swap_select_')) {
        const firstUser = data.replace('force_swap_select_', '');
        const remainingUsers = queue.filter(name => name !== firstUser);
        
        const buttons = remainingUsers.map(name => [{ text: name, callback_data: `force_swap_execute_${firstUser}_${name}` }]);
        
        sendMessageWithButtons(chatId, 
            `Force Swap - First user: ${firstUser} - Select second user:`, 
            buttons
        );
        
    } else if (data.startsWith('force_swap_execute_')) {
        const dataWithoutPrefix = data.replace('force_swap_execute_', '');
        const lastUnderscoreIndex = dataWithoutPrefix.lastIndexOf('_');
        const firstUser = dataWithoutPrefix.substring(0, lastUnderscoreIndex);
        const secondUser = dataWithoutPrefix.substring(lastUnderscoreIndex + 1);
        
        // Execute immediate swap
        const firstIndex = queue.indexOf(firstUser);
        const secondIndex = queue.indexOf(secondUser);
        
        console.log(`🔍 DEBUG - Force swap: ${firstUser} ↔ ${secondUser}`);
        console.log(`🔍 DEBUG - Current queue: [${queue.join(', ')}]`);
        console.log(`🔍 DEBUG - First user "${firstUser}" found at index: ${firstIndex}`);
        console.log(`🔍 DEBUG - Second user "${secondUser}" found at index: ${secondIndex}`);
        
        if (firstIndex !== -1 && secondIndex !== -1) {
            // Swap positions in queue
            console.log(`🔍 DEBUG - Before swap: queue[${firstIndex}] = "${queue[firstIndex]}", queue[${secondIndex}] = "${queue[secondIndex]}"`);
            [queue[firstIndex], queue[secondIndex]] = [queue[secondIndex], queue[firstIndex]];
            console.log(`🔍 DEBUG - After swap: queue[${firstIndex}] = "${queue[firstIndex]}", queue[${secondIndex}] = "${queue[secondIndex]}"`);
            console.log(`🔍 DEBUG - After swap: [${queue.join(', ')}]`);
            
            // Verify the swap actually happened
            console.log(`🔍 DEBUG - Queue reference check: queue === global queue? ${queue === global.queue || 'No global.queue'}`);
            
            // Check if queue is being reset somewhere
            setTimeout(() => {
                console.log(`🔍 DEBUG - Queue after 100ms: [${queue.join(', ')}]`);
            }, 100);
            
            // Update current turn if needed
            // If currentTurn was pointing to one of the swapped positions, update it
            if (currentTurn === firstIndex) {
                currentTurn = secondIndex;
            } else if (currentTurn === secondIndex) {
                currentTurn = firstIndex;
            }
            // Note: If currentTurn was not involved in the swap, it stays the same
            // This means the current turn person remains the same, just their position in queue changes
            
            console.log(`🔍 DEBUG - After currentTurn update: currentTurn=${currentTurn}`);
            
            // FIX: Always reset currentTurn to 0 after a swap to ensure status shows from the beginning
            currentTurn = 0;
            console.log(`🔍 DEBUG - After currentTurn reset: currentTurn=${currentTurn}`);
            
            // TEMPORARY SWAP: Mark this as a temporary swap that will revert after current turn
            // We'll store the original positions to restore them later
            const tempSwap = {
                firstUser: firstUser,
                secondUser: secondUser,
                firstOriginalIndex: secondIndex, // Where first user should be after swap
                secondOriginalIndex: firstIndex,  // Where second user should be after swap
                isActive: true
            };
            
            // Store the temporary swap info
            if (!global.tempSwaps) global.tempSwaps = new Map();
            global.tempSwaps.set('current', tempSwap);
            
            console.log(`🔍 DEBUG - Temporary swap stored: ${firstUser}↔${secondUser} (will revert after current turn)`);
            
            // Notify all users
            const message = `⚡ **Admin Force Swap Executed!**\n\n🔄 **${firstUser} ↔ ${secondUser}**\n\n📋 **New queue order:**\n${queue.map((name, index) => `${index + 1}. ${name}${index === currentTurn ? ' (CURRENT TURN)' : ''}`).join('\n')}`;
            
            // Send to all authorized users and admins
            [...authorizedUsers, ...admins].forEach(user => {
                const userChatId = userQueueMapping.get(user) ? queueUserMapping.get(userQueueMapping.get(user)) : null;
                if (userChatId) {
                    sendMessage(userChatId, message);
                }
            });
            
            sendMessage(chatId, `✅ **Force swap completed!**\n\n🔄 **${firstUser} ↔ ${secondUser}**`);
        } else {
            sendMessage(chatId, '❌ **Error:** Could not find users in queue.');
        }
        
    } else if (data === 'request_punishment_menu') {
        const isAuthorized = authorizedUsers.has(userName);
        if (!isAuthorized) {
            sendMessage(chatId, '❌ **Not authorized!** You need to be authorized to request punishments.');
            return;
        }
        
        const availableUsers = queue.filter(name => name !== userQueueMapping.get(userName));
        
        if (availableUsers.length === 0) {
            sendMessage(chatId, '❌ **No users available to report!**');
            return;
        }
        
        const buttons = availableUsers.map(name => [{ text: name, callback_data: `punishment_target_${name}` }]);
        
        sendMessageWithButtons(chatId, 
            `⚡ **Request Punishment**\n\n👤 **Select user to report:**`, 
            buttons
        );
        
    } else if (data.startsWith('punishment_target_')) {
        const targetUser = data.replace('punishment_target_', '');
        
        // Submit punishment request immediately with default reason (no reason input required)
        const reason = 'User request (no reason provided)';
        reportUser(targetUser, reason, userName);
        sendMessage(chatId, `✅ **Punishment Request Submitted!**\n\n🎯 **Target:** ${targetUser}\n📝 **Reason:** ${reason}\n👤 **Requested by:** ${userName}\n\n📢 **Admins have been notified!**`);
        
    } else if (data.startsWith('punishment_reason_')) {
        const parts = data.replace('punishment_reason_', '').split(' ');
        const requestId = parseInt(parts[0]);
        const reason = parts.slice(1).join(' ');
        
        const punishmentRequest = pendingPunishments.get(requestId);
        if (!punishmentRequest) {
            sendMessage(chatId, '❌ **Punishment request not found or expired!**');
            return;
        }
        
        if (punishmentRequest.fromUserId !== userId) {
            sendMessage(chatId, '❌ **This punishment request is not yours!**');
            return;
        }
        
        // Update the request with reason
        punishmentRequest.reason = reason;
        
        // Notify all admins
        const adminMessage = `⚡ **Punishment Request**\n\n👤 **From:** ${userName}\n🎯 **Target:** ${punishmentRequest.targetUser}\n📝 **Reason:** ${reason}\n\n⏰ **Request expires in 10 minutes**`;
        
        const buttons = [
            [
                { text: "✅ Approve", callback_data: `punishment_approve_${requestId}` },
                { text: "❌ Reject", callback_data: `punishment_reject_${requestId}` }
            ]
        ];
        
        // Send to all admins
        admins.forEach(admin => {
            const adminChatId = userQueueMapping.get(admin) ? queueUserMapping.get(userQueueMapping.get(admin)) : null;
            if (adminChatId) {
                sendMessageWithButtons(adminChatId, adminMessage, buttons);
            }
        });
        
        sendMessage(chatId, `✅ **Punishment request sent to admins!**\n\n🎯 **Target:** ${punishmentRequest.targetUser}\n📝 **Reason:** ${reason}\n⏰ **Waiting for admin approval...**`);
        
    } else if (data.startsWith('punishment_approve_')) {
        const requestId = parseInt(data.replace('punishment_approve_', ''));
        const punishmentRequest = pendingPunishments.get(requestId);
        
        if (!punishmentRequest) {
            sendMessage(chatId, '❌ **Punishment request not found or expired!**');
            return;
        }
        
        // Check if this is an admin
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        if (!isAdmin) {
            sendMessage(chatId, '❌ **Admin access required!**');
            return;
        }
        
        // Apply punishment
        applyPunishment(punishmentRequest.targetUser, punishmentRequest.reason, userName);
        
        // Notify requester
        sendMessage(punishmentRequest.fromUserId, `✅ **Punishment Approved!**\n\n🎯 **Target:** ${punishmentRequest.targetUser}\n📝 **Reason:** ${punishmentRequest.reason}\n👨‍💼 **Approved by:** ${userName}`);
        
        // Remove request
        pendingPunishments.delete(requestId);
        
    } else if (data.startsWith('punishment_reject_')) {
        const requestId = parseInt(data.replace('punishment_reject_', ''));
        const punishmentRequest = pendingPunishments.get(requestId);
        
        if (!punishmentRequest) {
            sendMessage(chatId, '❌ **Punishment request not found or expired!**');
            return;
        }
        
        // Check if this is an admin
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        if (!isAdmin) {
            sendMessage(chatId, '❌ **Admin access required!**');
            return;
        }
        
        // Notify requester
        sendMessage(punishmentRequest.fromUserId, `❌ **Punishment Request Rejected!**\n\n👨‍💼 ${userName} declined your punishment request for ${punishmentRequest.targetUser}.`);
        sendMessage(chatId, `❌ **Punishment request rejected!**\n\n👤 You declined ${punishmentRequest.fromUser}'s punishment request.`);
        
        // Remove request
        pendingPunishments.delete(requestId);
        
    } else if (data === 'apply_punishment_menu') {
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        if (!isAdmin) {
            sendMessage(chatId, '❌ **Admin access required!**');
            return;
        }
        
        // Get unique users from the queue to avoid duplicate buttons
        const uniqueUsers = [...new Set(queue)];
        const buttons = uniqueUsers.map(name => [{ text: name, callback_data: `admin_punish_${name}` }]);
        
        sendMessageWithButtons(chatId, 
            `Apply Punishment - Select user to punish:`, 
            buttons
        );
        
    } else if (data.startsWith('admin_punish_')) {
        const targetUser = data.replace('admin_punish_', '');
        
        // Apply punishment immediately with default reason (no reason input required)
        const reason = 'Admin direct punishment (no reason provided)';
        applyPunishment(targetUser, reason, userName);
        sendMessage(chatId, `✅ **Punishment Applied!**\n\n👤 **Target:** ${targetUser}\n📝 **Reason:** ${reason}\n👨‍💼 **Applied by:** ${userName}\n\n⚡ **3 extra turns added immediately!**`);
        
    } else if (data.startsWith('admin_punishment_reason_')) {
        const parts = data.replace('admin_punishment_reason_', '').split(' ');
        const requestId = parseInt(parts[0]);
        const reason = parts.slice(1).join(' ');
        
        const punishmentRequest = pendingPunishments.get(requestId);
        if (!punishmentRequest) {
            sendMessage(chatId, '❌ **Punishment request not found or expired!**');
            return;
        }
        
        if (punishmentRequest.fromUserId !== userId) {
            sendMessage(chatId, '❌ **This punishment request is not yours!**');
            return;
        }
        
        // Apply punishment directly (admin doesn't need approval)
        applyPunishment(punishmentRequest.targetUser, reason, userName);
        
        sendMessage(chatId, `✅ **Punishment Applied!**\n\n🎯 **Target:** ${punishmentRequest.targetUser}\n📝 **Reason:** ${reason}\n👨‍💼 **Applied by:** ${userName}`);
        
        // Remove request
        pendingPunishments.delete(requestId);
        
    } else {
        sendMessage(chatId, '❌ Unknown button action. Please use the main menu.');
    }
}

// Get updates from Telegram
function getUpdates(offset = 0) {
    const url = `${botUrl}/getUpdates?offset=${offset}&timeout=30`;
    
    https.get(url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            try {
                const response = JSON.parse(data);
                
                if (response.ok && response.result.length > 0) {
                    let lastUpdateId = 0;
                    
                    response.result.forEach(update => {
                        lastUpdateId = update.update_id;
                        
                        if (update.message) {
                            const chatId = update.message.chat.id;
                            const userId = update.message.from.id;
                            const userName = update.message.from.first_name + 
                                (update.message.from.last_name ? ' ' + update.message.from.last_name : '');
                            const text = update.message.text;
                            
                            handleCommand(chatId, userId, userName, text);
                        }
                        
                        if (update.callback_query) {
                            const chatId = update.callback_query.message.chat.id;
                            const userId = update.callback_query.from.id;
                            const userName = update.callback_query.from.first_name + 
                                (update.callback_query.from.last_name ? ' ' + update.callback_query.from.last_name : '');
                            const data = update.callback_query.data;
                            
                            handleCallback(chatId, userId, userName, data);
                            
                            // Answer callback query
                            const answerUrl = `${botUrl}/answerCallbackQuery`;
                            const answerData = JSON.stringify({
                                callback_query_id: update.callback_query.id
                            });
                            
                            const answerOptions = {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Content-Length': answerData.length
                                }
                            };
                            
                            const answerReq = https.request(answerUrl, answerOptions);
                            answerReq.write(answerData);
                            answerReq.end();
                        }
                    });
                    
                    // Continue polling
                    setTimeout(() => getUpdates(lastUpdateId + 1), 1000);
                } else {
                    // No updates, continue polling
                    setTimeout(() => getUpdates(offset), 1000);
                }
            } catch (error) {
                console.log('❌ Error processing updates:', error.message);
                setTimeout(() => getUpdates(offset), 5000);
            }
        });
    }).on('error', (error) => {
        console.log('❌ Error getting updates:', error.message);
        setTimeout(() => getUpdates(offset), 5000);
    });
}

// Cleanup expired requests every minute
function cleanupExpiredRequests() {
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000; // 5 minutes in milliseconds
    const tenMinutes = 10 * 60 * 1000; // 10 minutes in milliseconds
    
    // Cleanup expired swap requests
    for (const [requestId, request] of pendingSwaps.entries()) {
        if (now - request.timestamp > fiveMinutes) {
            // Notify the requester that the request expired
            sendMessage(request.fromUserId, `⏰ **Swap request expired!**\n\n🎯 Your swap request with ${request.toUser} has expired after 5 minutes.`);
            
            // Remove expired request
            pendingSwaps.delete(requestId);
            console.log(`🧹 Cleaned up expired swap request ${requestId}`);
        }
    }
    
    // Cleanup expired punishment requests
    for (const [requestId, request] of pendingPunishments.entries()) {
        if (now - request.timestamp > tenMinutes) {
            // Notify the requester that the request expired
            sendMessage(request.fromUserId, `⏰ **Punishment request expired!**\n\n🎯 Your punishment request for ${request.targetUser} has expired after 10 minutes.`);
            
            // Remove expired request
            pendingPunishments.delete(requestId);
            console.log(`🧹 Cleaned up expired punishment request ${requestId}`);
        }
    }
}

console.log('🤖 Simple Telegram Dishwasher Bot is ready!');
console.log('📱 Bot is now listening for commands...');
console.log('🔍 Search for: @aronov_dishwasher_bot');

// Start cleanup timer (every minute)
setInterval(cleanupExpiredRequests, 60000);

// Start polling for updates
getUpdates();
