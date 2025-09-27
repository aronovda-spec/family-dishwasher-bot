// Simple Telegram Dishwasher Bot (no external dependencies)
const https = require('https');
const fs = require('fs');

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
    console.error('Error: TELEGRAM_BOT_TOKEN environment variable is required');
    console.error('Please set your bot token: set TELEGRAM_BOT_TOKEN=your_bot_token_here');
    process.exit(1);
}
const botUrl = `https://api.telegram.org/bot${token}`;

// Simple queue management
let currentTurn = 0;
const queue = ['Eden', 'Adele', 'Emma'];

// Debt/Credit system for swaps
const debts = new Map(); // Map: creditor -> Array of debtors (FIFO)
const debtHistory = new Map(); // Map: debtor -> Array of {creditor, timestamp, completed}
const activeDebtFavors = new Map(); // Map: debtor -> creditor (tracks active debt favors)

// User management
const admins = new Set(); // Set of admin user IDs
const adminChatIds = new Set(); // Set of admin chat IDs for notifications
const authorizedUsers = new Set(); // Set of authorized user IDs (max 3)
const userChatIds = new Map(); // Map: userName -> chatId for notifications

// Link Telegram users to queue names
const userQueueMapping = new Map(); // Map: Telegram user ID -> Queue name

// Messaging system state management
const userStates = new Map(); // userId -> current state
const pendingAnnouncements = new Map(); // userId -> announcement data
const pendingMessages = new Map(); // userId -> message data
const queueUserMapping = new Map(); // Map: Queue name -> Telegram user ID

// Queue management system
const suspendedUsers = new Map(); // userName -> { suspendedUntil: Date, reason: string, originalPosition: number }
const queueStatistics = new Map(); // userName -> { totalCompletions: number, monthlyCompletions: number, lastCompleted: Date }
const originalQueueOrder = ['Eden', 'Adele', 'Emma']; // Default queue order for reset

// Monthly report tracking
const monthlyStats = new Map(); // month-year -> { users: {}, admins: {}, totals: {} }

// Helper function to get current month key
function getCurrentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Helper function to initialize user stats for current month
function initializeMonthlyStats(monthKey) {
    if (!monthlyStats.has(monthKey)) {
        monthlyStats.set(monthKey, {
            users: {
                'Eden': { completions: 0, punishments: 0, daysSuspended: 0, swapsRequested: 0, punishmentRequests: 0 },
                'Adele': { completions: 0, punishments: 0, daysSuspended: 0, swapsRequested: 0, punishmentRequests: 0 },
                'Emma': { completions: 0, punishments: 0, daysSuspended: 0, swapsRequested: 0, punishmentRequests: 0 }
            },
            admins: {},
            totals: {
                dishesCompleted: 0,
                adminInterventions: 0,
                queueReorders: 0
            }
        });
    }
}

// Helper function to get all positions of a user in queue (including punishment turns)
function getAllUserPositions(userName) {
    return queue.map((user, index) => user === userName ? index : -1)
              .filter(index => index !== -1);
}

// Helper function to remove all occurrences of a user from queue
function removeAllUserOccurrences(userName) {
    const positions = getAllUserPositions(userName);
    // Remove from end to beginning to preserve indices
    for (let i = positions.length - 1; i >= 0; i--) {
        queue.splice(positions[i], 1);
    }
    console.log(`🗑️ Removed all ${positions.length} occurrences of ${userName} from queue`);
    return positions.length;
}

// Helper function to adjust currentTurn after queue modifications
function adjustCurrentTurnAfterRemoval(removedPositions) {
    if (removedPositions.length === 0) return;
    
    // Count how many positions were removed before currentTurn
    const removedBeforeCurrent = removedPositions.filter(pos => pos < currentTurn).length;
    
    // Adjust currentTurn
    currentTurn -= removedBeforeCurrent;
    
    // Ensure currentTurn is within bounds
    if (currentTurn >= queue.length && queue.length > 0) {
        currentTurn = 0;
    } else if (currentTurn < 0) {
        currentTurn = 0;
    }
}

// Helper function to check if user is currently suspended (and auto-reactivate if expired)
function checkAndCleanExpiredSuspensions() {
    const now = new Date();
    const expiredUsers = [];
    
    suspendedUsers.forEach((suspension, userName) => {
        if (now >= suspension.suspendedUntil) {
            expiredUsers.push(userName);
        }
    });
    
    // Auto-reactivate expired users
    expiredUsers.forEach(userName => {
        console.log(`⏰ Auto-reactivating ${userName} - suspension expired`);
        reactivateUser(userName);
    });
}

// Helper function to suspend user (remove from queue, preserve punishment debt)
function suspendUser(userName, days, reason = null) {
    const userPositions = getAllUserPositions(userName);
    if (userPositions.length === 0) {
        console.log(`⚠️ Cannot suspend ${userName} - not in queue`);
        return false;
    }
    
    // Calculate punishment debt
    const normalTurns = 1; // Every user has 1 normal turn
    const punishmentTurnsInQueue = userPositions.length - normalTurns;
    const punishmentTurnsInCounter = punishmentTurns.get(userName) || 0;
    
    // Total punishment debt is the maximum of what's in queue vs counter
    const totalPunishmentDebt = Math.max(punishmentTurnsInQueue, punishmentTurnsInCounter);
    
    // Store suspension data with punishment debt
    const suspendUntil = new Date();
    suspendUntil.setDate(suspendUntil.getDate() + days);
    
    suspendedUsers.set(userName, {
        suspendedUntil: suspendUntil,
        reason: reason || `Suspended for ${days} day${days > 1 ? 's' : ''}`,
        originalPosition: userPositions[0], // Store first position
        punishmentDebt: totalPunishmentDebt
    });
    
    // Remove all occurrences from queue
    const removedCount = removeAllUserOccurrences(userName);
    
    // Clear punishment counter (debt is now stored in suspension)
    punishmentTurns.delete(userName);
    
    // Adjust currentTurn
    adjustCurrentTurnAfterRemoval(userPositions);
    
    console.log(`✈️ ${userName} suspended with ${totalPunishmentDebt} punishment debt preserved. Removed ${removedCount} turns. New queue: [${queue.join(', ')}]`);
    return true;
}

// Helper function to reactivate user (add back to queue with punishment debt)
function reactivateUser(userName) {
    if (!suspendedUsers.has(userName)) {
        console.log(`⚠️ Cannot reactivate ${userName} - not suspended`);
        return false;
    }
    
    const suspension = suspendedUsers.get(userName);
    const punishmentDebt = suspension.punishmentDebt || 0;
    
    // Add user back to queue (normal turn)
    queue.push(userName);
    
    // Restore punishment debt if any
    if (punishmentDebt > 0) {
        punishmentTurns.set(userName, punishmentDebt);
        
        // Add punishment turns to queue
        for (let i = 0; i < punishmentDebt; i++) {
            queue.push(userName);
        }
        
        console.log(`✅ ${userName} reactivated with ${punishmentDebt} punishment turns restored. New queue: [${queue.join(', ')}]`);
    } else {
        console.log(`✅ ${userName} reactivated with no punishment debt. New queue: [${queue.join(', ')}]`);
    }
    
    // Clear suspension
    suspendedUsers.delete(userName);
    return true;
}

// Helper function to advance to next user (no need to skip anyone now)
function advanceToNextUser() {
    currentTurn = (currentTurn + 1) % queue.length;
    return queue[currentTurn];
}

// Debt management functions
function addDebt(debtor, creditor) {
    if (!debts.has(creditor)) {
        debts.set(creditor, []);
    }
    debts.get(creditor).push(debtor);
    
    // Track debt history
    if (!debtHistory.has(debtor)) {
        debtHistory.set(debtor, []);
    }
    debtHistory.get(debtor).push({
        creditor: creditor,
        timestamp: new Date(),
        completed: false
    });
    
    console.log(`💳 Debt created: ${debtor} owes ${creditor} (1 turn). Total debts for ${creditor}: ${debts.get(creditor).length}`);
}

function repayDebt(debtor, creditor) {
    if (!debts.has(creditor)) return false;
    
    const creditorDebts = debts.get(creditor);
    const debtorIndex = creditorDebts.indexOf(debtor);
    
    if (debtorIndex === -1) return false;
    
    // Remove the debt (FIFO - first in, first out)
    creditorDebts.splice(debtorIndex, 1);
    
    // Mark debt as completed in history
    if (debtHistory.has(debtor)) {
        const history = debtHistory.get(debtor);
        const debtRecord = history.find(record => 
            record.creditor === creditor && !record.completed
        );
        if (debtRecord) {
            debtRecord.completed = true;
        }
    }
    
    console.log(`✅ Debt repaid: ${debtor} repaid ${creditor}. Remaining debts for ${creditor}: ${creditorDebts.length}`);
    return true;
}

function getDebtStatus() {
    const status = {};
    for (const [creditor, debtors] of debts.entries()) {
        if (debtors.length > 0) {
            status[creditor] = debtors.slice(); // Copy array
        }
    }
    return status;
}

function hasDebtsOwedTo(creditor) {
    return debts.has(creditor) && debts.get(creditor).length > 0;
}

function getNextDebtorFor(creditor) {
    if (!hasDebtsOwedTo(creditor)) return null;
    return debts.get(creditor)[0]; // FIFO - first debtor
}

// Active debt favor management functions
function addActiveDebtFavor(debtor, creditor) {
    activeDebtFavors.set(debtor, creditor);
    console.log(`💳 Active debt favor: ${creditor} performing ${debtor}'s turn`);
}

function clearActiveDebtFavor(debtor) {
    const creditor = activeDebtFavors.get(debtor);
    if (creditor) {
        activeDebtFavors.delete(debtor);
        console.log(`✅ Active debt favor cleared: ${creditor} completed ${debtor}'s turn`);
        return creditor;
    }
    return null;
}

function hasActiveDebtFavor(debtor) {
    return activeDebtFavors.has(debtor);
}

function getActiveDebtFavorCreditor(debtor) {
    return activeDebtFavors.get(debtor);
}

function getActualPerformer(scheduledUser) {
    // Check if there's an active debt favor for the scheduled user
    if (hasActiveDebtFavor(scheduledUser)) {
        const creditor = getActiveDebtFavorCreditor(scheduledUser);
        return creditor; // Creditor performs debtor's turn
    }
    
    // Check if someone owes the scheduled user a debt (someone should perform their turn)
    if (hasDebtsOwedTo(scheduledUser)) {
        const debtor = getNextDebtorFor(scheduledUser);
        if (debtor) {
            return debtor; // Debtor performs creditor's turn
        }
    }
    
    return scheduledUser; // Normal turn - scheduled user performs it
}

// Anti-cheating helper function
function alertAdminsAboutCheating(userId, userName, reason, details) {
    const now = new Date();
    const timeString = now.toLocaleString();
    
    // Collect all unique admin chat IDs to avoid duplicates
    const adminChatIdsToNotify = new Set();
    
    // Add adminChatIds
    adminChatIds.forEach(chatId => adminChatIdsToNotify.add(chatId));
    
    // Add chat IDs from authorized users who are admins
    [...authorizedUsers, ...admins].forEach(user => {
        let userChatId = userChatIds.get(user) || userChatIds.get(user.toLowerCase());
        if (userChatId && admins.has(user)) {
            adminChatIdsToNotify.add(userChatId);
        }
    });
    
    // Send alert to each unique admin chat ID only once
    adminChatIdsToNotify.forEach(adminChatId => {
        let alertMessage;
        if (reason === 'rapid_done') {
            alertMessage = `${t(adminChatId, 'cheating_detected')}\n\n` +
                `${t(adminChatId, 'rapid_done_alert', {user: userName, userId: userId, time: timeString, lastDone: details.lastDone})}`;
        } else if (reason === 'rapid_swap') {
            alertMessage = `${t(adminChatId, 'cheating_detected')}\n\n` +
                `${t(adminChatId, 'rapid_swap_alert', {user: userName, userId: userId, time: timeString, swapCount: details.swapCount})}`;
        }
        
        console.log(`🚨 Sending cheating alert to admin: ${adminChatId}`);
        sendMessage(adminChatId, alertMessage);
    });
}

// Helper function to update queue statistics
function updateUserStatistics(userName) {
    const stats = queueStatistics.get(userName) || { totalCompletions: 0, monthlyCompletions: 0, lastCompleted: null };
    
    stats.totalCompletions++;
    stats.monthlyCompletions++; // Could be enhanced to reset monthly
    stats.lastCompleted = new Date();
    
    queueStatistics.set(userName, stats);
    
    // Update monthly stats
    const monthKey = getCurrentMonthKey();
    initializeMonthlyStats(monthKey);
    const monthData = monthlyStats.get(monthKey);
    if (monthData.users[userName]) {
        monthData.users[userName].completions++;
    }
    monthData.totals.dishesCompleted++;
}

// Helper function to track monthly statistics
function trackMonthlyAction(type, userName, adminName = null, count = 1) {
    const monthKey = getCurrentMonthKey();
    initializeMonthlyStats(monthKey);
    const monthData = monthlyStats.get(monthKey);
    
    switch (type) {
        case 'punishment_received':
            if (monthData.users[userName]) {
                monthData.users[userName].punishments += count;
            }
            break;
        case 'suspension':
            if (monthData.users[userName]) {
                monthData.users[userName].daysSuspended += count;
            }
            break;
        case 'swap_requested':
            if (monthData.users[userName]) {
                monthData.users[userName].swapsRequested++;
            }
            break;
        case 'punishment_request':
            if (monthData.users[userName]) {
                monthData.users[userName].punishmentRequests++;
            }
            break;
        case 'admin_completion':
            if (!monthData.admins[adminName]) {
                monthData.admins[adminName] = { completions: 0, punishmentsApplied: 0, forceSwaps: 0, announcements: 0 };
            }
            monthData.admins[adminName].completions++;
            monthData.totals.adminInterventions++;
            break;
        case 'admin_punishment':
            if (!monthData.admins[adminName]) {
                monthData.admins[adminName] = { completions: 0, punishmentsApplied: 0, forceSwaps: 0, announcements: 0 };
            }
            monthData.admins[adminName].punishmentsApplied++;
            break;
        case 'admin_force_swap':
            if (!monthData.admins[adminName]) {
                monthData.admins[adminName] = { completions: 0, punishmentsApplied: 0, forceSwaps: 0, announcements: 0 };
            }
            monthData.admins[adminName].forceSwaps++;
            break;
        case 'admin_announcement':
            if (!monthData.admins[adminName]) {
                monthData.admins[adminName] = { completions: 0, punishmentsApplied: 0, forceSwaps: 0, announcements: 0 };
            }
            monthData.admins[adminName].announcements++;
            break;
        case 'queue_reorder':
            monthData.totals.queueReorders++;
            break;
    }
}

// Generate monthly report
function generateMonthlyReport(monthKey, userId, isAutoReport = false) {
    const monthData = monthlyStats.get(monthKey);
    if (!monthData) {
        return t(userId, 'no_data_available');
    }
    
    const [year, month] = monthKey.split('-');
    const monthNames = {
        'en': ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
        'he': ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']
    };
    const userLang = getUserLanguage(userId);
    const monthName = monthNames[userLang][parseInt(month) - 1];
    
    let report = '';
    
    // Add auto-report header if this is an automatic report
    if (isAutoReport) {
        report += `${t(userId, 'auto_monthly_report_header', {month: monthName, year})}`;
    }
    
    report += `${t(userId, 'monthly_report_title', {month: monthName, year})}\n\n`;
    
    // User statistics
    report += `${t(userId, 'user_statistics')}\n`;
    Object.entries(monthData.users).forEach(([userName, stats]) => {
        report += `${addRoyalEmoji(userName)}:\n`;
        report += `  ✅ ${t(userId, 'completions_count', {count: stats.completions})}\n`;
        report += `  ⚡ ${t(userId, 'punishments_received', {count: stats.punishments})}\n`;
        report += `  ✈️ ${t(userId, 'days_suspended', {count: stats.daysSuspended})}\n`;
        report += `  🔄 ${t(userId, 'swaps_requested', {count: stats.swapsRequested})}\n`;
        report += `  📝 ${t(userId, 'punishment_requests_made', {count: stats.punishmentRequests})}\n\n`;
    });
    
    // Admin statistics
    if (Object.keys(monthData.admins).length > 0) {
        report += `${t(userId, 'admin_statistics')}\n`;
        Object.entries(monthData.admins).forEach(([adminName, stats]) => {
            report += `👨‍💼 ${adminName}:\n`;
            report += `  ✅ ${t(userId, 'completions_helped', {count: stats.completions})}\n`;
            report += `  ⚡ ${t(userId, 'punishments_applied', {count: stats.punishmentsApplied})}\n`;
            report += `  🔄 ${t(userId, 'force_swaps_executed', {count: stats.forceSwaps})}\n`;
            report += `  📢 ${t(userId, 'announcements_sent', {count: stats.announcements})}\n\n`;
        });
    }
    
    // Totals
    report += `📈 TOTALS:\n`;
    report += `- ${t(userId, 'total_dishes_completed', {count: monthData.totals.dishesCompleted})}\n`;
    report += `- ${t(userId, 'admin_interventions', {count: monthData.totals.adminInterventions})}\n`;
    report += `- ${t(userId, 'queue_reorders', {count: monthData.totals.queueReorders})}`;
    
    return report;
}

// Broadcast monthly report to all authorized users and admins
function broadcastMonthlyReport(monthKey = null, isAutoReport = false) {
    const currentMonthKey = monthKey || getCurrentMonthKey();
    console.log(`📊 Broadcasting monthly report for ${currentMonthKey}${isAutoReport ? ' (automatic)' : ' (manual)'}`);
    
    let recipientCount = 0;
    
    // Send to all authorized users
    authorizedUsers.forEach(userName => {
        const chatId = userChatIds.get(userName.toLowerCase());
        if (chatId) {
            const report = generateMonthlyReport(currentMonthKey, chatId, isAutoReport);
            sendMessage(chatId, report);
            recipientCount++;
        }
    });
    
    // Send to all admins
    adminChatIds.forEach(chatId => {
        const report = generateMonthlyReport(currentMonthKey, chatId, isAutoReport);
        sendMessage(chatId, report);
        recipientCount++;
    });
    
    console.log(`📊 Monthly report sent to ${recipientCount} recipients`);
    return recipientCount;
}

// Swap request tracking
const pendingSwaps = new Map(); // Map: requestId -> {fromUser, toUser, fromUserId, toUserId, timestamp}
let swapRequestCounter = 0;

// Punishment system (simplified - no strike counting)
const userPunishments = new Map(); // Map: userName -> {punishmentCount, extraTurns, endDate}
const pendingPunishments = new Map(); // Map: requestId -> {fromUser, targetUser, reason, fromUserId, timestamp}
const punishmentTurns = new Map(); // Map: userName -> number of punishment turns remaining
let punishmentRequestCounter = 0;

// Deduplication for cloud deployment (prevents multiple popups in Render)
const processedUpdates = new Set(); // Track processed update IDs
const instanceId = process.env.RENDER_INSTANCE_ID || `local-${Date.now()}`;

// Button click deduplication (prevents rapid multiple clicks on same button)
const lastUserAction = new Map(); // Map: userId -> {action, timestamp}
const ACTION_COOLDOWN = 1000; // 1 second cooldown between same actions

// Language preference storage
const userLanguage = new Map(); // Map: userId -> 'en' or 'he'

// Royal emoji mapping for elegant display
const royalEmojis = {
    // Admins (by order of addition)
    'admin_1': '👑', // King - First admin
    'admin_2': '💎', // Queen - Second admin
    // Queue members
    'Eden Aronov': '🔱', // Princess 1
    'Adele Aronov': '⭐', // Princess 2  
    'Emma Aronov': '✨'  // Princess 3
};

// Translation dictionaries
const translations = {
    en: {
        // Menu titles
        'admin_menu': 'Admin Menu - Full Access',
        'user_menu': 'User Menu - Queue Access',
        'guest_menu': 'Guest Menu - Limited Access',
        
        // Button texts
        'status': '📊 Status',
        'done': '✅ Done',
        'help': '❓ Help',
        'request_access': '🔐 Request Access',
        'users': '👥 Users',
        'admins': '🔑 Admins',
        'authorize': '🎫 Authorize',
        'add_admin': '👑 Add Admin',
        'force_swap': '⚡ Force Swap',
        'apply_punishment': '⚖️ Apply Punishment',
        'dishwasher_alert': '🚨 Dishwasher Alert!',
        'dishwasher_started': '🏁 Dishwasher Started!',
        'swap': '🔄 Swap',
        'request_punishment': '⚖️ Request Punishment',
        'language_switch': '🇮🇱 עברית',
        
        // Punishment reasons
        'reason_behavior': '😠 Behavior',
        'reason_household': '🏠 Household Rules',
        'reason_respect': '🤝 Respect',
        'reason_other': '📝 Other',
        
        // Messages
        'dishwasher_queue_status': '📋 **Dishwasher Queue Status:**',
        'current_turn': '- **CURRENT TURN**',
        'not_authorized_user': '(Not authorized)',
        'authorized_users': '👥 **Authorized Users:**',
        'force_swap_current_turn': '⚡ **Force Swap** - Current turn:',
        'swap_current_turn_with': 'Swap current turn with another user:',
        'force_swap_step2': '⚡ **Force Swap** - Step 2',
        'swap_with_select': '🔄 **Swap with:** Select user below',
        
        // Common messages
        'not_authorized': '❌ **Not authorized!**',
        'admin_access_required': '❌ **Admin access required!**',
        'not_your_turn': '❌ **Not your turn!**',
        'current_turn_user': '🔄 **Current turn:**',
        'your_queue_position': '👤 **Your queue position:**',
        'please_wait_turn': '⏳ Please wait for your turn.',
        'dishwasher_alert_sent': '✅ **Dishwasher Alert Sent!**',
        'dishwasher_started_sent': '✅ **Dishwasher Started Notification Sent!**',
        'alerted_user': '👤 **Alerted:**',
        'sent_to_all': '📢 **Sent to:** All authorized users and admins',
        'auto_timer': 'Auto-Timer',
        'cheating_detected': '🚨 **CHEATING SUSPECTED!** 🚨',
        'rapid_done_alert': '⚠️ **Rapid DONE Activity Detected**\n\n👤 **User:** {user} ({userId})\n⏰ **Time:** {time}\n🕐 **Last DONE:** {lastDone}\n\n📊 **Dishwasher cannot be ready in less than 30 minutes!**',
        'rapid_swap_alert': '⚠️ **Rapid Swap Activity Detected**\n\n👤 **User:** {user} ({userId})\n⏰ **Time:** {time}\n🔄 **Swaps in 10 minutes:** {swapCount}\n\n📊 **Suspicious activity pattern detected!**',
        'swap_request_sent': '✅ **Swap request sent to admins!**',
        'punishment_request_sent': '✅ **Punishment request sent to admins!**',
        'target_user': '🎯 **Target:**',
        'reason': '📝 **Reason:**',
        'waiting_approval': '⏰ **Waiting for admin approval...**',
        'punishment_applied': '✅ **Punishment Applied!**',
        'applied_by': '👨‍💼 **Applied by:**',
        'user_authorized': '✅ **User Authorized!**',
        'total_authorized': '📊 **Total authorized users:**',
        'swap_completed': '✅ **Swap completed!**',
        'next_up': '🎯 Next up:',
        'completed_turn': 'completed their turn!',
        'punishment_remaining': '⚖️ Punishment:',
        'extra_turns_remaining': 'extra turn(s) remaining.',
        
        // Debt system messages
        'debt_created': 'Debt Created',
        'debt_repaid': 'Debt Repaid',
        'active_debts': 'Active Debts',
        'no_active_debts': 'No Active Debts',
        'swap_error': 'Swap Error',
        'only_scheduled_user_can_swap': 'Only the scheduled user can offer their turn',
        'legacy_swaps_active': 'Legacy Swaps Active',
        
        // More popup messages
        'force_swap_completed': '✅ **Force swap completed!**',
        'swap_users': '🔄 **{user1} ↔ {user2}**',
        'punishment_approved': '✅ **Punishment Approved!**',
        'approved_by': '👨‍💼 **Approved by:**',
        'extra_turns_applied': '⚡ **3 extra turns applied immediately!**',
        'admin_direct_punishment': '⚡ **Admin Direct Punishment Applied!**',
        'extra_turns_added': '⚡ **3 extra turns added immediately!**',
        'swap_request_approved': '✅ **Swap request approved!**',
        'swap_request_rejected': '❌ **Swap request rejected!**',
        'swap_request_canceled': '❌ **Swap request canceled!**',
        'keep_current_turn': '🔄 **You keep your current turn.**',
        'declined_swap': 'declined your swap request.',
        'canceled_swap_with': 'You canceled your swap request with',
        'error_users_not_found': '❌ **Error:** Could not find users in queue.',
        'error_queue_position': '❌ **Error:** Could not find your queue position.',
        'punishment_request_expired': '❌ **Punishment request not found or expired!**',
        'not_your_punishment': '❌ **This punishment request is not yours!**',
        'not_your_swap': '❌ **This swap request is not for you!**',
        
        // Done command messages
        'admin_intervention': '✅ **ADMIN INTERVENTION!**',
        'admin_completed_duty': '👨‍💼 **Admin:** {admin} completed dishwasher duty',
        'helped_user': '👤 **Helped user:** {user}',
        'next_turn': '🔄 **Next turn:** {user}',
        'punishment_turns_remaining': '⚡ **Punishment turns remaining:** {count}',
        'admin_can_apply_punishment': '💡 **Admin can manually apply punishment to {user} if needed**',
        'turn_completed': '✅ **TURN COMPLETED!**',
        'completed_by': '👤 **Completed by:** {user}',
        
        // Punishment selection messages
        'apply_punishment_select_reason': 'Apply Punishment - Select reason for {user}:',
        'request_punishment_select_reason': 'Request Punishment - Select reason for {user}:',
        
        // Punishment approval/rejection messages
        'punishment_request_approved': '✅ **Punishment Request Approved!**',
        'punishment_request_rejected': '❌ **Punishment Request Rejected!**',
        'requested_by': '👤 **Requested by:** {user}',
        'rejected_by': '👨‍💼 **Rejected by:** {user}',
        'declined_punishment_request': '👨‍💼 {admin} declined your punishment request for {target}.',
        'you_declined_punishment': '👤 You declined {requester}\'s punishment request.',
        
        // Additional punishment messages
        'punishment_request_submitted': 'Punishment Request Submitted!',
        'admins_notified': 'Admins have been notified!',
        'request_punishment_select_user': 'Request Punishment - Select user to report:',
        
        // Swap messages
        'request_swap_your_position': 'Request Swap - Your position: {position} - Select user to swap with:',
        
        // Authorization messages
        'not_authorized_queue_commands': '❌ **Not authorized!**\n\n👤 {user} is not authorized to use queue commands.\n\n💡 **Ask an admin to authorize you:**\n`/authorize {user}`',
        'not_authorized_swap_features': '❌ **Not authorized!** You need to be authorized to use swap features.',
        
        // Additional swap messages
        'swap_request_sent_detailed': 'Swap request sent! Requested swap with: {user} - Waiting for approval - You can cancel your request if needed',
        'cancel_request': '❌ Cancel Request',
        'swap_request_canceled_notification': '❌ **Swap request canceled!**\n\n👤 {user} canceled their swap request with you.',
        'swap_request_canceled_confirmation': '❌ **Swap request canceled!**\n\n👤 You canceled your swap request with {user}.\n\n🔄 **You keep your current turn.**',
        'swap_request_canceled_admin': '❌ **Swap Request Canceled**\n\n👤 **From:** {from}\n👤 **Canceled by:** {canceledBy}\n👤 **Target was:** {target}\n📅 **Time:** {time}',
        
        // Dishwasher alert messages
        'dishwasher_alert_message': '🚨 **DISHWASHER ALERT!** 🚨\n\n👤 **It\'s {user}\'s turn!**\n⏰ **Time to do the dishes!**\n\n📢 **Reminder sent by:** {sender}',
        'dishwasher_started_message': '🏁 **DISHWASHER STARTED!** 🏁\n\n👤 **Currently doing dishes:** {user}\n⏰ **Dishwasher is now running!**\n\n📢 **Started by:** {sender}',
        
        // Admin management messages
        'current_admins': '👨‍💼 **Current Admins:**\n\n{adminList}\n\n📊 **Total admins:** {count}',
        'no_authorized_users': '👥 **No authorized users set yet.**\n\nUse `/authorize <user>` to authorize a user.\n\n📋 **Available queue members:**\n• Eden Aronov\n• Adele Aronov\n• Emma Aronov',
        'first_admin_added': '✅ **First Admin Added!**\n\n👨‍💼 {user} is now the first admin.\n\n🔑 **Admin privileges:**\n• Manage queue\n• Authorize users\n• Add/remove admins\n• Force swaps\n• Apply punishments\n\n💡 **Note:** {user} needs to send /start to the bot to receive notifications.',
        'admin_added': '✅ **Admin Added!**\n\n👨‍💼 {user} is now an admin.\n\n🔑 **Admin privileges:**\n• Manage queue\n• Authorize users\n• Add/remove admins\n• Force swaps\n• Apply punishments\n\n💡 **Note:** {user} needs to send /start to the bot to receive notifications.',
        
        // Additional missing messages
        'admin_access_required_simple': '❌ **Admin access required!**\n\n👤 {user} is not an admin.',
        'cannot_add_yourself_admin': '❌ **Cannot add yourself as admin!**\n\n🛡️ **Security protection:** Only other admins can promote you.\n\n💡 **Ask another admin to add you:**\n`/addadmin {user}`',
        'cannot_remove_yourself_admin': '❌ **Cannot remove yourself as admin!**\n\n🛡️ **Security protection:** Only other admins can remove you.\n\n💡 **Ask another admin to remove you:**\n`/removeadmin {user}`',
        'admin_removed': '✅ **Admin Removed!**\n\n👤 {user} is no longer an admin.\n\n🔒 **Admin privileges revoked.**',
        'user_not_found_admin': '❌ **User not found!**\n\n👤 {user} is not an admin.\n\n💡 **Use `/admins` to see current admins.**',
        'admin_access_required_authorize': '❌ **Admin access required!**\n\n👤 {user} is not an admin.\n\n💡 **Only admins can authorize users.**',
        'user_not_in_queue': '❌ **User not in queue!**\n\n👥 **Available queue members:**\n• Eden Aronov\n• Adele Aronov\n• Emma Aronov\n\n💡 **Usage:** `/authorize Eden` or `/authorize Eden Aronov`',
        'test_button_works': '🧪 **Test Button Works!**\n\n✅ Inline buttons are working correctly!\n\n👤 **Pressed by:** {user}\n🆔 **User ID:** {userId}\n🔘 **Button data:** {data}',
        'pending_swap_exists': '❌ **You already have a pending swap request!**\n\n🎯 **Current request:** {fromUser} ↔ {toUser}\n⏰ **Request ID:** {requestId}\n\n💡 **You can cancel your current request before creating a new one.**',
        'target_has_pending_swap': '❌ **{targetUser} already has a pending swap request!**\n\n🎯 **Current request:** {fromUser} ↔ {toUser}\n⏰ **Request ID:** {requestId}\n\n💡 **Please wait for this request to be resolved before creating a new one.**',
        'swap_request_rejected_simple': '❌ **Swap request rejected!**\n\n👤 {user} declined your swap request.',
        'you_declined_swap_request': '❌ **Swap request rejected!**\n\n👤 You declined {user}\'s swap request.',
        
        // Button texts
        'approve': '✅ Approve',
        'reject': '❌ Reject',
        'current_turn_button': '🎯 {user} (Current Turn)',
        
        // Usage messages
        'usage_addadmin': '❌ **Usage:** `/addadmin <username>`\n\nExample: `/addadmin Dani`',
        'usage_removeadmin': '❌ **Usage:** `/removeadmin <username>`\n\nExample: `/removeadmin Dani`',
        'usage_authorize': '❌ **Usage:** `/authorize <username>`\n\nExample: `/authorize Eden`',
        'unknown_command': '❌ Unknown command. Type /help to see available commands.',
        
        // Queue update messages
        'queue_update': 'Queue Update',
        'swapped_positions': 'swapped positions',
        'new_queue_order': 'New queue order',
        'current_turn_status': 'CURRENT TURN',
        'next_lap': 'Next Lap Preview',
        'admin_force_swap_executed': 'Admin Force Swap Executed!',
        'apply_punishment_select_user': 'Apply Punishment - Select user to punish:',
        
        // Error messages
        'max_authorized_users': '❌ **Maximum 3 authorized users reached!**\n\nRemove a user first before adding another.',
        'no_one_in_queue': '❌ **No one is currently in the queue!**',
        'not_your_turn_swap': '❌ **Not your turn!** You can only request swaps during your turn.',
        'swap_request_not_found': '❌ **Swap request not found or expired!**',
        'swap_request_not_for_you': '❌ **This swap request is not for you!**',
        'swap_request_not_yours': '❌ **This swap request is not yours!**',
        'target_user_not_found': '❌ **Target user not found!**\n\n👤 **User:** {targetUser}\n💡 **Make sure the user has sent /start to the bot.**',
        'not_authorized_punishment': '❌ **Not authorized!** You need to be authorized to request punishments.',
        'no_users_available_report': '❌ **No users available to report!**',
        
        // Swap request messages
        'swap_request_title': 'Swap Request',
        'new_swap_request': 'New Swap Request',
        'from_user': 'From',
        'wants_to_swap_with': 'Wants to swap with',
        'time': 'Time',
        'request_id': 'Request ID',
        'swap_request_rejected_title': 'Swap Request Rejected',
        'rejected_by': 'Rejected by',
        
        // Punishment request messages
        'punishment_request_title': 'Punishment Request',
        
        // Announcement system (Admin only)
        'create_announcement': 'Create Announcement',
        'type_announcement_message': 'Type your announcement message:',
        'announcement_preview': 'Preview',
        'announcement': 'Announcement',
        'send_to_all': '📢 Send to All',
        'announcement_sent': 'Announcement sent successfully!',
        
        // Message system (Admin + Users)
        'send_message': 'Send Message',
        'type_your_message': 'Type your message:',
        'message_preview': 'Preview',
        'message_from': 'Message from',
        'message_sent': 'Message sent successfully!',
        
        // Common messaging elements
        'got_it': '✅ Got it!',
        'like': '👍 Like',
        'sent_to': 'Sent to',
        'cancel': '❌ Cancel',
        'from_admin': 'From Admin',
        'maintenance': '🔧 Maintenance',
        'back': '⬅️ Back',
        
        // Queue Management
        'queue_management': '📋 Queue Management',
        'reorder_queue': '🔄 Reorder Queue',
        'queue_statistics': '📊 Queue Statistics',
        'suspend_user': '✈️ Suspend User',
        'reactivate_user': '✅ Reactivate User',
        'reset_queue': '🔄 Reset Queue',
        'select_user_to_reorder': 'Select user to move to new position:',
        'select_new_position': 'Select new position for {user}:',
        'position_1': '1️⃣ Position 1 (First)',
        'position_2': '2️⃣ Position 2 (Second)', 
        'position_3': '3️⃣ Position 3 (Third)',
        'queue_reordered': '✅ Queue reordered successfully!',
        'new_queue_order_is': 'New queue order:',
        'select_user_to_suspend': 'Select user to suspend:',
        'select_suspension_duration': 'Select suspension duration for {user}:',
        'duration_1_day': '1️⃣ 1 Day',
        'duration_3_days': '3️⃣ 3 Days',
        'duration_7_days': '7️⃣ 1 Week',
        'duration_14_days': '🗓️ 2 Weeks',
        'duration_30_days': '📅 1 Month',
        'user_suspended': '✅ {user} suspended for {duration}',
        'select_user_to_reactivate': 'Select user to reactivate:',
        'user_reactivated': '✅ {user} reactivated successfully!',
        'no_suspended_users': 'No users are currently suspended.',
        'queue_reset_confirm': '⚠️ Reset queue to original order (Eden→Adele→Emma)?',
        'confirm_reset': '✅ Yes, Reset Queue',
        'queue_reset_success': '✅ Queue reset to original order!',
        'queue_statistics_title': '📊 Queue Statistics',
        'total_completions': 'Total Completions:',
        'this_month': 'This Month:',
        'suspended_users_list': 'Suspended Users:',
        'suspended_until': 'Suspended until: {date}',
        'current_queue_order': 'Current Queue Order:',
        'punishment_debt_preserved': 'Punishment debt preserved: {count} turns',
        'reactivated_with_punishment': '{user} reactivated with {count} punishment turns',
        'remove_user': '❌ Remove User',
        'select_user_to_remove': 'Select user to remove permanently:',
        'user_removed': '❌ {user} removed from queue permanently',
        'permanently_removed': 'Permanently removed',
        
        // Monthly Reports
        'monthly_report': '📊 Monthly Report',
        'share_monthly_report': '📤 Share Monthly Report',
        'monthly_report_title': '📊 Monthly Report - {month} {year}',
        'monthly_report_shared': '✅ **Monthly Report Shared!**\n\n📤 Report sent to all authorized users and admins.\n\n👥 **Recipients:** {count} users',
        'auto_monthly_report_header': '🗓️ **AUTOMATIC MONTHLY REPORT**\n\n📅 End of {month} {year}\n\n',
        'user_statistics': 'USER STATISTICS:',
        'admin_statistics': 'ADMIN STATISTICS:',
        'completions_count': 'Completions: {count}',
        'punishments_received': 'Punishments received: {count}',
        'days_suspended': 'Days suspended: {count}',
        'swaps_requested': 'Swaps requested: {count}',
        'punishment_requests_made': 'Punishment requests made: {count}',
        'completions_helped': 'Completions (helped): {count}',
        'punishments_applied': 'Punishments applied: {count}',
        'force_swaps_executed': 'Force swaps: {count}',
        'announcements_sent': 'Announcements: {count}',
        'total_dishes_completed': 'Total dishes completed: {count}',
        'admin_interventions': 'Admin interventions: {count}',
        'queue_reorders': 'Queue reorders: {count}',
        
        // Swap status messages
        'temporary_swaps_active': 'Temporary Swaps Active:',
        'no_active_swaps': 'No active swaps - normal queue order',
        'force_swap_type': 'Force Swap',
        'user_swap_type': 'User Swap',
        'reverts_when_completes': 'reverts when {user} completes their turn'
    },
    he: {
        // Menu titles
        'admin_menu': 'תפריט מנהל - גישה מלאה',
        'user_menu': 'תפריט משתמש - גישה לתור',
        'guest_menu': 'תפריט אורח - גישה מוגבלת',
        
        // Button texts
        'status': '📊 מצב',
        'done': '✅ סיים',
        'help': '❓ עזרה',
        'request_access': '🔐 בקש גישה',
        'users': '👥 משתמשים',
        'admins': '🔑 מנהלים',
        'authorize': '🎫 הרשה',
        'add_admin': '👑 הוסף מנהל',
        'force_swap': '⚡ החלף בכוח',
        'apply_punishment': '⚖️ הפעל עונש',
        'dishwasher_alert': '🚨 התראת כלים!',
        'dishwasher_started': '🏁 מדיח התחיל!',
        'swap': '🔄 החלף',
        'request_punishment': '⚖️ בקש עונש',
        'language_switch': '🇺🇸 English',
        
        // Punishment reasons
        'reason_behavior': '😠 התנהגות',
        'reason_household': '🏠 חוקי הבית',
        'reason_respect': '🤝 כבוד',
        'reason_other': '📝 אחר',
        
        // Messages
        'dishwasher_queue_status': '📋 **סטטוס תור הכלים:**',
        'current_turn': '- **התור הנוכחי**',
        'not_authorized_user': '(לא מורשה)',
        'authorized_users': '👥 **משתמשים מורשים:**',
        'force_swap_current_turn': '⚡ **החלפה בכוח** - התור הנוכחי:',
        'swap_current_turn_with': 'החלף את התור הנוכחי עם משתמש אחר:',
        'force_swap_step2': '⚡ **החלפה בכוח** - שלב 2',
        'swap_with_select': '🔄 **החלף עם:** בחר משתמש למטה',
        
        // Common messages
        'not_authorized': '❌ **לא מורשה!**',
        'admin_access_required': '❌ **נדרשת גישת מנהל!**',
        'not_your_turn': '❌ **לא התור שלך!**',
        'current_turn_user': '🔄 **התור הנוכחי:**',
        'your_queue_position': '👤 **המיקום שלך בתור:**',
        'please_wait_turn': '⏳ אנא המתן לתורך.',
        'dishwasher_alert_sent': '✅ **התראת כלים נשלחה!**',
        'dishwasher_started_sent': '✅ **הודעת התחלת כלים נשלחה!**',
        'alerted_user': '👤 **הותרע:**',
        'sent_to_all': '📢 **נשלח אל:** כל המשתמשים והמנהלים',
        'auto_timer': 'טיימר אוטומטי',
        'cheating_detected': '🚨 **חשד לרמיה!** 🚨',
        'rapid_done_alert': '⚠️ **פעילות DONE מהירה זוהתה**\n\n👤 **משתמש:** {user} ({userId})\n⏰ **זמן:** {time}\n🕐 **DONE אחרון:** {lastDone}\n\n📊 **מדיח הכלים לא יכול להיות מוכן תוך פחות מ-30 דקות!**',
        'rapid_swap_alert': '⚠️ **פעילות החלפה מהירה זוהתה**\n\n👤 **משתמש:** {user} ({userId})\n⏰ **זמן:** {time}\n🔄 **החלפות ב-10 דקות:** {swapCount}\n\n📊 **זוהה דפוס פעילות חשוד!**',
        'swap_request_sent': '✅ **בקשת החלפה נשלחה למנהלים!**',
        'punishment_request_sent': '✅ **בקשת עונש נשלחה למנהלים!**',
        'target_user': '🎯 **יעד:**',
        'reason': '📝 **סיבה:**',
        'waiting_approval': '⏰ **ממתין לאישור מנהל...**',
        'punishment_applied': '✅ **עונש הופעל!**',
        'applied_by': '👨‍💼 **הופעל על ידי:**',
        'user_authorized': '✅ **משתמש הורשה!**',
        'total_authorized': '📊 **סך משתמשים מורשים:**',
        'swap_completed': '✅ **החלפה הושלמה!**',
        'next_up': '🎯 הבא בתור:',
        'completed_turn': 'סיים את התור!',
        'punishment_remaining': '⚖️ עונש:',
        'extra_turns_remaining': 'תורות נוספים נותרו.',
        
        // Debt system messages
        'debt_created': 'חוב נוצר',
        'debt_repaid': 'חוב שולם',
        'active_debts': 'חובות פעילים',
        'no_active_debts': 'אין חובות פעילים',
        'swap_error': 'שגיאת החלפה',
        'only_scheduled_user_can_swap': 'רק המשתמש המתוזמן יכול להציע את התור שלו',
        'legacy_swaps_active': 'החלפות ישנות פעילות',
        
        // More popup messages
        'force_swap_completed': '✅ **החלפה בכוח הושלמה!**',
        'swap_users': '🔄 **{user1} ↔ {user2}**',
        'punishment_approved': '✅ **עונש אושר!**',
        'approved_by': '👨‍💼 **אושר על ידי:**',
        'extra_turns_applied': '⚡ **3 תורות נוספים הופעלו מיד!**',
        'admin_direct_punishment': '⚡ **עונש ישיר של מנהל הופעל!**',
        'extra_turns_added': '⚡ **3 תורות נוספים נוספו מיד!**',
        'swap_request_approved': '✅ **בקשת החלפה אושרה!**',
        'swap_request_rejected': '❌ **בקשת החלפה נדחתה!**',
        'swap_request_canceled': '❌ **בקשת החלפה בוטלה!**',
        'keep_current_turn': '🔄 **אתה שומר על התור הנוכחי שלך.**',
        'declined_swap': 'דחה את בקשת החלפה שלך.',
        'canceled_swap_with': 'ביטלת את בקשת החלפה שלך עם',
        'error_users_not_found': '❌ **שגיאה:** לא ניתן למצוא משתמשים בתור.',
        'error_queue_position': '❌ **שגיאה:** לא ניתן למצוא את מיקומך בתור.',
        'punishment_request_expired': '❌ **בקשת עונש לא נמצאה או פגה תוקפה!**',
        'not_your_punishment': '❌ **בקשת עונש זו לא שלך!**',
        'not_your_swap': '❌ **בקשת החלפה זו לא מיועדת לך!**',
        
        // Done command messages
        'admin_intervention': '✅ **התערבות מנהל!**',
        'admin_completed_duty': '👨‍💼 **מנהל:** {admin} השלים את חובת הכלים',
        'helped_user': '👤 **עזר למשתמש:** {user}',
        'next_turn': '🔄 **התור הבא:** {user}',
        'punishment_turns_remaining': '⚡ **תורות עונש נותרו:** {count}',
        'admin_can_apply_punishment': '💡 **מנהל יכול להפעיל עונש על {user} במידת הצורך**',
        'turn_completed': '✅ **התור הושלם!**',
        'completed_by': '👤 **הושלם על ידי:** {user}',
        
        // Punishment selection messages
        'apply_punishment_select_reason': 'הפעל עונש - בחר סיבה עבור {user}:',
        'request_punishment_select_reason': 'בקש עונש - בחר סיבה עבור {user}:',
        
        // Punishment approval/rejection messages
        'punishment_request_approved': '✅ **בקשת עונש אושרה!**',
        'punishment_request_rejected': '❌ **בקשת עונש נדחתה!**',
        'requested_by': '👤 **התבקש על ידי:** {user}',
        'rejected_by': '👨‍💼 **נדחה על ידי:** {user}',
        'declined_punishment_request': '👨‍💼 {admin} דחה את בקשת העונש שלך עבור {target}.',
        'you_declined_punishment': '👤 דחית את בקשת העונש של {requester}.',
        
        // Additional punishment messages
        'punishment_request_submitted': 'בקשת עונש הוגשה!',
        'admins_notified': 'המנהלים הותרעו!',
        'request_punishment_select_user': 'בקש עונש - בחר משתמש לדיווח:',
        
        // Swap messages
        'request_swap_your_position': 'בקש החלפה - המיקום שלך: {position} - בחר משתמש להחלפה:',
        
        // Authorization messages
        'not_authorized_queue_commands': '❌ **לא מורשה!**\n\n👤 {user} לא מורשה להשתמש בפקודות התור.\n\n💡 **בקש ממנהל להרשות אותך:**\n`/authorize {user}`',
        'not_authorized_swap_features': '❌ **לא מורשה!** אתה צריך להיות מורשה כדי להשתמש בתכונות החלפה.',
        
        // Additional swap messages
        'swap_request_sent_detailed': 'בקשת החלפה נשלחה! ביקשת החלפה עם: {user} - ממתין לאישור - אתה יכול לבטל את הבקשה שלך במידת הצורך',
        'cancel_request': '❌ בטל בקשה',
        'swap_request_canceled_notification': '❌ **בקשת החלפה בוטלה!**\n\n👤 {user} ביטל את בקשת החלפה שלו איתך.',
        'swap_request_canceled_confirmation': '❌ **בקשת החלפה בוטלה!**\n\n👤 ביטלת את בקשת החלפה שלך עם {user}.\n\n🔄 **אתה שומר על התור הנוכחי שלך.**',
        'swap_request_canceled_admin': '❌ **בקשת החלפה בוטלה**\n\n👤 **מאת:** {from}\n👤 **בוטל על ידי:** {canceledBy}\n👤 **היעד היה:** {target}\n📅 **זמן:** {time}',
        
        // Dishwasher alert messages
        'dishwasher_alert_message': '🚨 **התראת כלים!** 🚨\n\n👤 **זה התור של {user}!**\n⏰ **זמן לעשות כלים!**\n\n📢 **התזכורת נשלחה על ידי:** {sender}',
        'dishwasher_started_message': '🏁 **מדיח התחיל!** 🏁\n\n👤 **כרגע עושה כלים:** {user}\n⏰ **מדיח הכלים פועל כעת!**\n\n📢 **הותחל על ידי:** {sender}',
        
        // Admin management messages
        'current_admins': '👨‍💼 **מנהלים נוכחיים:**\n\n{adminList}\n\n📊 **סך מנהלים:** {count}',
        'no_authorized_users': '👥 **עדיין לא הוגדרו משתמשים מורשים.**\n\nהשתמש ב-`/authorize <user>` כדי להרשות משתמש.\n\n📋 **חברי התור הזמינים:**\n• Eden Aronov\n• Adele Aronov\n• Emma Aronov',
        'first_admin_added': '✅ **מנהל ראשון נוסף!**\n\n👨‍💼 {user} הוא כעת המנהל הראשון.\n\n🔑 **הרשאות מנהל:**\n• ניהול התור\n• הרשאת משתמשים\n• הוספה/הסרה של מנהלים\n• החלפות בכוח\n• הפעלת עונשים\n\n💡 **הערה:** {user} צריך לשלוח /start לבוט כדי לקבל התראות.',
        'admin_added': '✅ **מנהל נוסף!**\n\n👨‍💼 {user} הוא כעת מנהל.\n\n🔑 **הרשאות מנהל:**\n• ניהול התור\n• הרשאת משתמשים\n• הוספה/הסרה של מנהלים\n• החלפות בכוח\n• הפעלת עונשים\n\n💡 **הערה:** {user} צריך לשלוח /start לבוט כדי לקבל התראות.',
        
        // Additional missing messages
        'admin_access_required_simple': '❌ **נדרשת גישת מנהל!**\n\n👤 {user} אינו מנהל.',
        'cannot_add_yourself_admin': '❌ **לא ניתן להוסיף את עצמך כמנהל!**\n\n🛡️ **הגנת אבטחה:** רק מנהלים אחרים יכולים לקדם אותך.\n\n💡 **בקש ממנהל אחר להוסיף אותך:**\n`/addadmin {user}`',
        'cannot_remove_yourself_admin': '❌ **לא ניתן להסיר את עצמך כמנהל!**\n\n🛡️ **הגנת אבטחה:** רק מנהלים אחרים יכולים להסיר אותך.\n\n💡 **בקש ממנהל אחר להסיר אותך:**\n`/removeadmin {user}`',
        'admin_removed': '✅ **מנהל הוסר!**\n\n👤 {user} אינו עוד מנהל.\n\n🔒 **הרשאות מנהל בוטלו.**',
        'user_not_found_admin': '❌ **משתמש לא נמצא!**\n\n👤 {user} אינו מנהל.\n\n💡 **השתמש ב-`/admins` כדי לראות מנהלים נוכחיים.**',
        'admin_access_required_authorize': '❌ **נדרשת גישת מנהל!**\n\n👤 {user} אינו מנהל.\n\n💡 **רק מנהלים יכולים להרשות משתמשים.**',
        'user_not_in_queue': '❌ **משתמש לא בתור!**\n\n👥 **חברי התור הזמינים:**\n• Eden Aronov\n• Adele Aronov\n• Emma Aronov\n\n💡 **שימוש:** `/authorize Eden` או `/authorize Eden Aronov`',
        'test_button_works': '🧪 **כפתור בדיקה עובד!**\n\n✅ כפתורים מוטבעים עובדים נכון!\n\n👤 **נלחץ על ידי:** {user}\n🆔 **מזהה משתמש:** {userId}\n🔘 **נתוני כפתור:** {data}',
        'pending_swap_exists': '❌ **יש לך כבר בקשת החלפה ממתינה!**\n\n🎯 **בקשה נוכחית:** {fromUser} ↔ {toUser}\n⏰ **מזהה בקשה:** {requestId}\n\n💡 **אתה יכול לבטל את הבקשה הנוכחית לפני יצירת חדשה.**',
        'target_has_pending_swap': '❌ **ל-{targetUser} יש כבר בקשת החלפה ממתינה!**\n\n🎯 **בקשה נוכחית:** {fromUser} ↔ {toUser}\n⏰ **מזהה בקשה:** {requestId}\n\n💡 **אנא המתן עד שהבקשה הזו תיפתר לפני יצירת חדשה.**',
        'swap_request_rejected_simple': '❌ **בקשת החלפה נדחתה!**\n\n👤 {user} דחה את בקשת החלפה שלך.',
        'you_declined_swap_request': '❌ **בקשת החלפה נדחתה!**\n\n👤 דחית את בקשת החלפה של {user}.',
        
        // Button texts
        'approve': '✅ אשר',
        'reject': '❌ דחה',
        'current_turn_button': '🎯 {user} (התור הנוכחי)',
        
        // Usage messages
        'usage_addadmin': '❌ **שימוש:** `/addadmin <שם משתמש>`\n\nדוגמה: `/addadmin Dani`',
        'usage_removeadmin': '❌ **שימוש:** `/removeadmin <שם משתמש>`\n\nדוגמה: `/removeadmin Dani`',
        'usage_authorize': '❌ **שימוש:** `/authorize <שם משתמש>`\n\nדוגמה: `/authorize Eden`',
        'unknown_command': '❌ פקודה לא מוכרת. הקלד /help כדי לראות פקודות זמינות.',
        
        // Queue update messages
        'queue_update': 'עדכון התור',
        'swapped_positions': 'החליפו מקומות',
        'new_queue_order': 'סדר התור החדש',
        'current_turn_status': 'התור הנוכחי',
        'next_lap': 'תצוגת הסיבוב הבא',
        'admin_force_swap_executed': 'מנהל ביצע החלפה בכוח!',
        'apply_punishment_select_user': 'הפעל עונש - בחר משתמש לעונש:',
        
        // Error messages
        'max_authorized_users': '❌ **הגעת למקסימום 3 משתמשים מורשים!**\n\nהסר משתמש קודם לפני הוספת אחר.',
        'no_one_in_queue': '❌ **אף אחד לא נמצא כרגע בתור!**',
        'not_your_turn_swap': '❌ **לא התור שלך!** אתה יכול לבקש החלפות רק במהלך התור שלך.',
        'swap_request_not_found': '❌ **בקשת החלפה לא נמצאה או פגה תוקפה!**',
        'swap_request_not_for_you': '❌ **בקשת החלפה זו לא מיועדת לך!**',
        'swap_request_not_yours': '❌ **בקשת החלפה זו לא שלך!**',
        'target_user_not_found': '❌ **משתמש יעד לא נמצא!**\n\n👤 **משתמש:** {targetUser}\n💡 **ודא שהמשתמש שלח /start לבוט.**',
        'not_authorized_punishment': '❌ **לא מורשה!** אתה צריך להיות מורשה כדי לבקש עונשים.',
        'no_users_available_report': '❌ **אין משתמשים זמינים לדיווח!**',
        
        // Swap request messages
        'swap_request_title': 'בקשת החלפה',
        'new_swap_request': 'בקשת החלפה חדשה',
        'from_user': 'מאת',
        'wants_to_swap_with': 'רוצה להחליף עם',
        'time': 'זמן',
        'request_id': 'מזהה בקשה',
        'swap_request_rejected_title': 'בקשת החלפה נדחתה',
        'rejected_by': 'נדחתה על ידי',
        
        // Punishment request messages
        'punishment_request_title': 'בקשת עונש',
        
        // Announcement system (Admin only)
        'create_announcement': 'צור הודעה רשמית',
        'type_announcement_message': 'הקלד את ההודעה הרשמית שלך:',
        'announcement_preview': 'תצוגה מקדימה',
        'announcement': 'הודעה רשמית',
        'send_to_all': '📢 שלח לכולם',
        'announcement_sent': 'ההודעה הרשמית נשלחה בהצלחה!',
        
        // Message system (Admin + Users)
        'send_message': 'שלח הודעה',
        'type_your_message': 'הקלד את ההודעה שלך:',
        'message_preview': 'תצוגה מקדימה',
        'message_from': 'הודעה מאת',
        'message_sent': 'ההודעה נשלחה בהצלחה!',
        
        // Common messaging elements
        'got_it': '✅ הבנתי!',
        'like': '👍 אהבתי',
        'sent_to': 'נשלח אל',
        'cancel': '❌ בטל',
        'from_admin': 'מהמנהל',
        'maintenance': '🔧 תחזוקה',
        'back': '⬅️ חזור',
        
        // Queue Management
        'queue_management': '📋 ניהול תור',
        'reorder_queue': '🔄 סידור תור מחדש',
        'queue_statistics': '📊 סטטיסטיקות תור',
        'suspend_user': '✈️ השעיית משתמש',
        'reactivate_user': '✅ הפעלת משתמש מחדש',
        'reset_queue': '🔄 איפוס תור',
        'select_user_to_reorder': 'בחר משתמש להעברה למיקום חדש:',
        'select_new_position': 'בחר מיקום חדש עבור {user}:',
        'position_1': '1️⃣ מיקום 1 (ראשון)',
        'position_2': '2️⃣ מיקום 2 (שני)',
        'position_3': '3️⃣ מיקום 3 (שלישי)',
        'queue_reordered': '✅ התור סודר מחדש בהצלחה!',
        'new_queue_order_is': 'סדר התור החדש:',
        'select_user_to_suspend': 'בחר משתמש להשעיה:',
        'select_suspension_duration': 'בחר משך השעיה עבור {user}:',
        'duration_1_day': '1️⃣ יום אחד',
        'duration_3_days': '3️⃣ 3 ימים',
        'duration_7_days': '7️⃣ שבוע',
        'duration_14_days': '🗓️ שבועיים',
        'duration_30_days': '📅 חודש',
        'user_suspended': '✅ {user} הושעה ל{duration}',
        'select_user_to_reactivate': 'בחר משתמש להפעלה מחדש:',
        'user_reactivated': '✅ {user} הופעל מחדש בהצלחה!',
        'no_suspended_users': 'אין משתמשים מושעים כרגע.',
        'queue_reset_confirm': '⚠️ לאפס את התור לסדר המקורי (עדן→אדל→אמה)?',
        'confirm_reset': '✅ כן, אפס תור',
        'queue_reset_success': '✅ התור אופס לסדר המקורי!',
        'queue_statistics_title': '📊 סטטיסטיקות תור',
        'total_completions': 'סה"כ השלמות:',
        'this_month': 'החודש:',
        'suspended_users_list': 'משתמשים מושעים:',
        'suspended_until': 'מושעה עד: {date}',
        'current_queue_order': 'סדר התור הנוכחי:',
        'punishment_debt_preserved': 'חוב עונש נשמר: {count} תורות',
        'reactivated_with_punishment': '{user} הופעל מחדש עם {count} תורות עונש',
        'remove_user': '❌ הסר משתמש',
        'select_user_to_remove': 'בחר משתמש להסרה קבועה:',
        'user_removed': '❌ {user} הוסר מהתור לצמיתות',
        'permanently_removed': 'הוסר לצמיתות',
        
        // Monthly Reports
        'monthly_report': '📊 דוח חודשי',
        'share_monthly_report': '📤 שתף דוח חודשי',
        'monthly_report_title': '📊 דוח חודשי - {month} {year}',
        'monthly_report_shared': '✅ **דוח חודשי נשלח!**\n\n📤 הדוח נשלח לכל המשתמשים המורשים והמנהלים.\n\n👥 **נמענים:** {count} משתמשים',
        'auto_monthly_report_header': '🗓️ **דוח חודשי אוטומטי**\n\n📅 סוף {month} {year}\n\n',
        'user_statistics': 'סטטיסטיקות משתמשים:',
        'admin_statistics': 'סטטיסטיקות מנהלים:',
        'completions_count': 'השלמות: {count}',
        'punishments_received': 'עונשים שהתקבלו: {count}',
        'days_suspended': 'ימי השעיה: {count}',
        'swaps_requested': 'החלפות שנתבקשו: {count}',
        'punishment_requests_made': 'בקשות עונש שנשלחו: {count}',
        'completions_helped': 'השלמות (עזרה): {count}',
        'punishments_applied': 'עונשים שהוחלו: {count}',
        'force_swaps_executed': 'החלפות בכוח: {count}',
        'announcements_sent': 'הודעות רשמיות: {count}',
        'total_dishes_completed': 'סה"כ כלים שהושלמו: {count}',
        'admin_interventions': 'התערבויות מנהל: {count}',
        'queue_reorders': 'סידורי תור מחדש: {count}',
        
        // Swap status messages
        'temporary_swaps_active': 'החלפות זמניות פעילות:',
        'no_active_swaps': 'אין החלפות פעילות - סדר תור רגיל',
        'force_swap_type': 'החלפה בכוח',
        'user_swap_type': 'החלפת משתמש',
        'reverts_when_completes': 'חוזר כאשר {user} מסיים את התור שלו'
    }
};

// Get user's language preference
function getUserLanguage(userId) {
    return userLanguage.get(userId) || 'en'; // Default to English
}

// Get translated text
function t(userId, key, replacements = {}) {
    const lang = getUserLanguage(userId);
    let text = translations[lang][key] || translations.en[key] || key;
    
    // Replace placeholders like {user}, {admin}, {count}
    for (const [placeholder, value] of Object.entries(replacements)) {
        text = text.replace(new RegExp(`{${placeholder}}`, 'g'), value);
    }
    
    return text;
}

// Helper function to create buttons with recipient's language
function createLocalizedButtons(recipientUserId, buttonConfigs) {
    return buttonConfigs.map(row => 
        row.map(button => ({
            text: button.translationKey ? t(recipientUserId, button.translationKey) : button.text,
            callback_data: button.callback_data
        }))
    );
}

// Function to add royal emoji to user names
function addRoyalEmoji(userName) {
    // Check if it's a queue member first
    if (royalEmojis[userName]) {
        return `${royalEmojis[userName]} ${userName}`;
    }
    
    // Check if it's an admin (by order)
    const adminArray = Array.from(admins);
    if (adminArray.length > 0 && (adminArray[0] === userName || adminArray[0] === userName.toLowerCase())) {
        return `${royalEmojis.admin_1} ${userName}`; // King
    }
    if (adminArray.length > 1 && (adminArray[1] === userName || adminArray[1] === userName.toLowerCase())) {
        return `${royalEmojis.admin_2} ${userName}`; // Queen
    }
    
    // Return plain name if no royal emoji found
    return userName;
}

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
            'Content-Length': Buffer.byteLength(data)
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
            'Content-Length': Buffer.byteLength(data)
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
    
    // Check and clean expired suspensions first
    checkAndCleanExpiredSuspensions();
    
    // Handle messaging states first (before command processing)
    const userState = userStates.get(userId);
    
    if (userState === 'typing_announcement') {
        // Admin is typing announcement
        const announcementText = text;
        
        pendingAnnouncements.set(userId, {
            text: announcementText,
            fromAdmin: userName,
            timestamp: Date.now()
        });
        
        // Show preview with confirmation buttons (same format as message)
        const previewMessage = `${t(userId, 'announcement_preview')}:\n\n` +
                              `📢 **${t(userId, 'announcement')}**\n\n` +
                              `${announcementText}\n\n` +
                              `👨‍💼 **${t(userId, 'from_admin')}:** ${userName}\n` +
                              `🕐 **${t(userId, 'time')}:** ${new Date().toLocaleString()}`;
        
        const buttons = [
            [
                { text: t(userId, 'send_to_all'), callback_data: 'confirm_send_announcement' },
                { text: t(userId, 'cancel'), callback_data: 'cancel_announcement' }
            ]
        ];
        
        sendMessageWithButtons(chatId, previewMessage, buttons);
        userStates.delete(userId);
        return;
        
    } else if (userState === 'typing_message') {
        // User is typing message
        const messageText = text;
        
        pendingMessages.set(userId, {
            text: messageText,
            fromUser: userName,
            timestamp: Date.now()
        });
        
        // Show preview with confirmation buttons
        const previewMessage = `${t(userId, 'message_preview')}:\n\n` +
                              `💬 **${t(userId, 'message_from')} ${userName}**\n\n` +
                              `${messageText}\n\n` +
                              `🕐 **${t(userId, 'time')}:** ${new Date().toLocaleString()}`;
        
        const buttons = [
            [
                { text: t(userId, 'send_to_all'), callback_data: 'confirm_send_message' },
                { text: t(userId, 'cancel'), callback_data: 'cancel_message' }
            ]
        ];
        
        sendMessageWithButtons(chatId, previewMessage, buttons);
        userStates.delete(userId);
        return;
    }
    
    if (command === '/start') {
        // Store chat ID for this user (for notifications)
        userChatIds.set(userName, chatId);
        userChatIds.set(userName.toLowerCase(), chatId);
        
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        const isAuthorized = authorizedUsers.has(userName) || authorizedUsers.has(userName.toLowerCase());
        
        // If this user is an admin, store their chat ID for admin notifications
        if (isAdmin) {
            adminChatIds.add(chatId);
            console.log(`👨‍💼 Admin ${userName} (${userId}) chat ID ${chatId} added to adminChatIds`);
        }
        
        let text = `Dishwasher Bot Menu`;
        let buttons = [];
        
        if (isAdmin) {
            text += t(userId, 'admin_menu');
            buttons = [
                [
                    { text: t(userId, 'status'), callback_data: "status" },
                    { text: t(userId, 'done'), callback_data: "done" }
                ],
                [
                    { text: t(userId, 'force_swap'), callback_data: "force_swap_menu" },
                    { text: t(userId, 'apply_punishment'), callback_data: "apply_punishment_menu" }
                ],
                [
                    { text: t(userId, 'dishwasher_started'), callback_data: "dishwasher_started" },
                    { text: t(userId, 'dishwasher_alert'), callback_data: "dishwasher_alert" }
                ],
                [
                    { text: t(userId, 'create_announcement'), callback_data: "create_announcement" },
                    { text: t(userId, 'send_message'), callback_data: "send_user_message" }
                ],
                [
                    { text: t(userId, 'maintenance'), callback_data: "maintenance_menu" }
                ],
                [
                    { text: t(userId, 'language_switch'), callback_data: "language_switch" }
                ]
            ];
        } else if (isAuthorized) {
            text += t(userId, 'user_menu');
            buttons = [
                [
                    { text: t(userId, 'status'), callback_data: "status" },
                    { text: t(userId, 'done'), callback_data: "done" }
                ],
                [
                    { text: t(userId, 'swap'), callback_data: "swap_menu" },
                    { text: t(userId, 'request_punishment'), callback_data: "request_punishment_menu" }
                ],
                [
                    { text: t(userId, 'help'), callback_data: "help" }
                ],
                [
                    { text: t(userId, 'send_message'), callback_data: "send_user_message" }
                ],
                [
                    { text: t(userId, 'language_switch'), callback_data: "language_switch" }
                ]
            ];
        } else {
            text += t(userId, 'guest_menu');
            buttons = [
                [
                    { text: t(userId, 'status'), callback_data: "status" },
                    { text: t(userId, 'help'), callback_data: "help" }
                ],
                [
                    { text: t(userId, 'request_access'), callback_data: "request_access" }
                ],
                [
                    { text: t(userId, 'language_switch'), callback_data: "language_switch" }
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
                'Content-Length': Buffer.byteLength(data)
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
        let statusMessage = `${t(userId, 'dishwasher_queue_status')}\n\n`;
        
        // Debug: Show current queue state
        console.log(`🔍 DEBUG - Current queue: [${queue.join(', ')}]`);
        console.log(`🔍 DEBUG - Current turn: ${currentTurn}`);
        console.log(`🔍 DEBUG - Queue length: ${queue.length}`);
        
        // Show only the next 3 consecutive turns (current + next 2)
        for (let i = 0; i < 3; i++) {
            const turnIndex = (currentTurn + i) % queue.length;
            const scheduledUser = queue[turnIndex];
            const actualPerformer = getActualPerformer(scheduledUser);
            const isCurrentTurn = i === 0;
            const turnIcon = isCurrentTurn ? '🔄' : '⏳';
            const turnText = isCurrentTurn ? ` ${t(userId, 'current_turn')}` : '';
            
            // Format display: show actual performer, with scheduled user in parentheses if different
            let displayName;
            if (actualPerformer === scheduledUser) {
                // Normal turn - scheduled user performs it
                displayName = addRoyalEmoji(actualPerformer);
            } else {
                // Debt repayment - debtor performs creditor's turn
                displayName = `${addRoyalEmoji(actualPerformer)} (${scheduledUser})`;
            }
            
            // Check if this queue member is authorized
            const authorizedUser = queueUserMapping.get(actualPerformer);
            const authText = authorizedUser ? ` (${authorizedUser})` : ` ${t(userId, 'not_authorized_user')}`;
            
            statusMessage += `${turnIcon} ${i + 1}. ${displayName}${turnText}${authText}\n`;
        }
        
        statusMessage += `\n${t(userId, 'authorized_users')} ${authorizedUsers.size}/3`;
        
        // Show punishment information
        const usersWithPunishments = Array.from(punishmentTurns.entries()).filter(([user, turns]) => turns > 0);
        if (usersWithPunishments.length > 0) {
            statusMessage += `\n\n⚡ **Active Punishments:**`;
            usersWithPunishments.forEach(([user, turns]) => {
                statusMessage += `\n• ${user}: ${turns} punishment turn${turns > 1 ? 's' : ''} remaining`;
            });
        }
        
        // Show suspended users information
        const suspendedUsersList = Array.from(suspendedUsers.entries());
        if (suspendedUsersList.length > 0) {
            statusMessage += `\n\n✈️ **${t(userId, 'suspended_users_list')}**`;
            suspendedUsersList.forEach(([user, data]) => {
                const date = data.suspendedUntil.toLocaleDateString();
                
                // Check if this is a permanent removal (100+ year suspension)
                const now = new Date();
                const yearsUntilExpiry = (data.suspendedUntil - now) / (1000 * 60 * 60 * 24 * 365);
                const isPermanent = yearsUntilExpiry > 50; // If more than 50 years, consider it permanent
                
                if (isPermanent) {
                    statusMessage += `\n• ${addRoyalEmoji(user)}: ${t(userId, 'permanently_removed')}`;
                } else {
                    statusMessage += `\n• ${addRoyalEmoji(user)}: ${t(userId, 'suspended_until', {date})}`;
                }
            });
        }
        
        // Show debt information
        const debtStatus = getDebtStatus();
        const creditorsWithDebts = Object.keys(debtStatus);
        
        if (creditorsWithDebts.length > 0) {
            statusMessage += `\n\n💳 **${t(userId, 'active_debts')}**`;
            creditorsWithDebts.forEach(creditor => {
                const debtors = debtStatus[creditor];
                statusMessage += `\n• ${creditor} is owed by: ${debtors.join(', ')} (${debtors.length} turn${debtors.length > 1 ? 's' : ''})`;
            });
        } else {
            statusMessage += `\n\n✅ **${t(userId, 'no_active_debts')}**`;
        }
        
        // Show active temporary swaps information (legacy - now using debt system)
        if (global.tempSwaps && global.tempSwaps.size > 0) {
            const activeSwaps = Array.from(global.tempSwaps.entries()).filter(([id, swap]) => swap.isActive);
            
            if (activeSwaps.length > 0) {
                statusMessage += `\n\n⚠️ **${t(userId, 'legacy_swaps_active')}**`;
                activeSwaps.forEach(([swapId, swap]) => {
                    const swapTypeText = swap.swapType === 'force_swap' ? t(userId, 'force_swap_type') : t(userId, 'user_swap_type');
                    statusMessage += `\n• ${swap.firstUser} ↔ ${swap.secondUser} (${swapTypeText}) - ${t(userId, 'reverts_when_completes', {user: swap.originalCurrentTurnUser})}`;
                });
            }
        }
        
        sendMessage(chatId, statusMessage);
        
    } else if (command === '/done' || command === 'done') {
        // Initialize anti-cheating tracking
        if (!global.doneTimestamps) global.doneTimestamps = new Map();
        
        // Check for rapid DONE activity (30 minutes)
        const now = Date.now();
        const lastDone = global.doneTimestamps.get('lastDone');
        
        if (lastDone && (now - lastDone) < 30 * 60 * 1000) { // 30 minutes
            const lastDoneTime = new Date(lastDone).toLocaleString();
            // Send alert for each DONE within 30 minutes (different users get separate alerts)
            alertAdminsAboutCheating(userId, userName, 'rapid_done', { lastDone: lastDoneTime });
            console.log(`🚨 RAPID DONE DETECTED: ${userName} (${userId}) - Last DONE: ${lastDoneTime}`);
        }
        
        // Update last DONE timestamp
        global.doneTimestamps.set('lastDone', now);
        
        // Check if user is admin
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        
        if (isAdmin) {
            // Admin "Done" - Admin takes over dishwasher duty
            const currentUser = queue[currentTurn];
            let actualPerformer = currentUser; // Who actually performed the turn
            let debtRepaid = false;
            
            // Check if this is a debt favor turn (creditor performs debtor's turn)
            if (hasActiveDebtFavor(currentUser)) {
                const creditor = getActiveDebtFavorCreditor(currentUser);
                actualPerformer = creditor;
                // Clear the active debt favor when creditor completes debtor's turn
                clearActiveDebtFavor(currentUser);
                debtRepaid = true;
                console.log(`💳 Debt favor completed: ${creditor} performed ${currentUser}'s turn`);
            }
            
            // If no debt favor above, check if someone owes the scheduled user a debt (debtor performs creditor's turn)
            if (!debtRepaid && hasDebtsOwedTo(currentUser)) {
                const debtor = getNextDebtorFor(currentUser);
                if (debtor) {
                    // Debt repayment: debtor performs creditor's turn
                    actualPerformer = debtor;
                    repayDebt(debtor, currentUser);
                    debtRepaid = true;
                    console.log(`💳 Debt repayment: ${debtor} performed ${currentUser}'s turn`);
                }
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
                advanceToNextUser();
            }
            
            // Update statistics for the user who completed their turn
            updateUserStatistics(actualPerformer);
            
            const nextUser = queue[currentTurn];
            
            let adminDoneMessage = `${t(userId, 'admin_intervention')}\n\n` +
                `${t(userId, 'admin_completed_duty', {admin: userName})}\n` +
                `${t(userId, 'helped_user', {user: actualPerformer})}\n` +
                `${t(userId, 'next_turn', {user: nextUser})}` +
                (punishmentTurnsRemaining > 0 ? `\n${t(userId, 'punishment_turns_remaining', {count: punishmentTurnsRemaining - 1})}` : '');
            
            if (debtRepaid) {
                adminDoneMessage += `\n💳 **${t(userId, 'debt_repaid')}:** ${actualPerformer} repaid ${currentUser}`;
            }
            
            adminDoneMessage += `\n\n${t(userId, 'admin_can_apply_punishment', {user: actualPerformer})}`;
            
            // Send confirmation to admin
            sendMessage(chatId, adminDoneMessage);
            
            // Notify all authorized users and admins in their language
            [...authorizedUsers, ...admins].forEach(user => {
                // Try to find chat ID for this user
                let userChatId = userChatIds.get(user) || userChatIds.get(user.toLowerCase());
                
                if (userChatId && userChatId !== chatId) {
                    // Create message in recipient's language
                    let userDoneMessage = `${t(userChatId, 'admin_intervention')}\n\n` +
                        `${t(userChatId, 'admin_completed_duty', {admin: userName})}\n` +
                        `${t(userChatId, 'helped_user', {user: actualPerformer})}\n` +
                        `${t(userChatId, 'next_turn', {user: nextUser})}` +
                        (punishmentTurnsRemaining > 0 ? `\n${t(userChatId, 'punishment_turns_remaining', {count: punishmentTurnsRemaining - 1})}` : '');
                    
                    if (debtRepaid) {
                        userDoneMessage += `\n💳 **${t(userChatId, 'debt_repaid')}:** ${actualPerformer} repaid ${currentUser}`;
                    }
                    
                    userDoneMessage += `\n\n${t(userChatId, 'admin_can_apply_punishment', {user: actualPerformer})}`;
                    
                    console.log(`🔔 Sending admin DONE notification to ${user} (${userChatId})`);
                    sendMessage(userChatId, userDoneMessage);
                } else {
                    console.log(`🔔 No chat ID found for ${user}`);
                }
            });
            
            // Mark that dishwasher was completed (cancel auto-alert)
            global.dishwasherCompleted = true;
            if (global.dishwasherAutoAlertTimer) {
                clearTimeout(global.dishwasherAutoAlertTimer);
                global.dishwasherAutoAlertTimer = null;
            }
            
        } else {
            // Regular user "Done" - Check if user is authorized
            if (!authorizedUsers.has(userName) && !authorizedUsers.has(userName.toLowerCase())) {
                sendMessage(chatId, t(userId, 'not_authorized_queue_commands', {user: userName}));
                return;
            }
            
            const currentUser = queue[currentTurn];
            const userQueueName = userQueueMapping.get(userName) || userQueueMapping.get(userName.toLowerCase());
            let actualPerformer = currentUser; // Who actually performed the turn
            let debtRepaid = false;
            
            // Check if this is a debt favor turn (creditor performs debtor's turn)
            if (hasActiveDebtFavor(currentUser)) {
                const creditor = getActiveDebtFavorCreditor(currentUser);
                actualPerformer = creditor;
                // Clear the active debt favor when creditor completes debtor's turn
                clearActiveDebtFavor(currentUser);
                debtRepaid = true;
                console.log(`💳 Debt favor completed: ${creditor} performed ${currentUser}'s turn`);
            }
            
            // If no debt favor above, check if someone owes the scheduled user a debt (debtor performs creditor's turn)
            if (!debtRepaid && hasDebtsOwedTo(currentUser)) {
                const debtor = getNextDebtorFor(currentUser);
                if (debtor) {
                    // Debt repayment: debtor performs creditor's turn
                    actualPerformer = debtor;
                    repayDebt(debtor, currentUser);
                    debtRepaid = true;
                    console.log(`💳 Debt repayment: ${debtor} performed ${currentUser}'s turn`);
                }
            }
            
            // Check if it's actually their turn (for normal turns, not debt repayments)
            if (!debtRepaid && userQueueName !== currentUser) {
                sendMessage(chatId, `${t(userId, 'not_your_turn')}\n\n${t(userId, 'current_turn_user')} ${currentUser}\n${t(userId, 'your_queue_position')} ${userQueueName}\n\n${t(userId, 'please_wait_turn')}`);
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
                advanceToNextUser();
            }
            
            // Update statistics for the user who completed their turn
            updateUserStatistics(actualPerformer);
            
            const nextUser = queue[currentTurn];
            
            let doneMessage = `${t(userId, 'turn_completed')}\n\n` +
                `${t(userId, 'completed_by', {user: actualPerformer})}\n` +
                `${t(userId, 'next_turn', {user: nextUser})}` +
                (punishmentTurnsRemaining > 0 ? `\n${t(userId, 'punishment_turns_remaining', {count: punishmentTurnsRemaining - 1})}` : '');
            
            if (debtRepaid) {
                doneMessage += `\n💳 **${t(userId, 'debt_repaid')}:** ${actualPerformer} repaid ${currentUser}`;
            }
            
            // Notify all authorized users and admins in their language
            [...authorizedUsers, ...admins].forEach(user => {
                // Try to find chat ID for this user
                let userChatId = userChatIds.get(user) || userChatIds.get(user.toLowerCase());
                
                if (userChatId && userChatId !== chatId) {
                    // Create message in recipient's language
                    let userDoneMessage = `${t(userChatId, 'turn_completed')}\n\n` +
                        `${t(userChatId, 'completed_by', {user: actualPerformer})}\n` +
                        `${t(userChatId, 'next_turn', {user: nextUser})}` +
                        (punishmentTurnsRemaining > 0 ? `\n${t(userChatId, 'punishment_turns_remaining', {count: punishmentTurnsRemaining - 1})}` : '');
                    
                    if (debtRepaid) {
                        userDoneMessage += `\n💳 **${t(userChatId, 'debt_repaid')}:** ${actualPerformer} repaid ${currentUser}`;
                    }
                    
                    console.log(`🔔 Sending user DONE notification to ${user} (${userChatId})`);
                    sendMessage(userChatId, userDoneMessage);
                } else {
                    console.log(`🔔 No chat ID found for ${user}`);
                }
            });
            
            // Mark that dishwasher was completed (cancel auto-alert)
            global.dishwasherCompleted = true;
            if (global.dishwasherAutoAlertTimer) {
                clearTimeout(global.dishwasherAutoAlertTimer);
                global.dishwasherAutoAlertTimer = null;
            }
        }
        
    } else if (command === '/help' || command === 'help') {
        const helpMessage = `🤖 **בוט מדיח הכלים של המשפחה (Family Dishwasher Bot):**\n\n` +
            `📋 **פקודות התור (Queue Commands):**\n` +
            `• \`/status\` - הצגת התור הנוכחי (Show current queue)\n` +
            `• \`/done\` - השלמת התור שלך (Complete your turn)\n\n` +
            `🔄 **החלפת תורות (Swap Turns):**\n` +
            `• **החלפה (Swap)** - בקשה להחלפה עם משתמש אחר\n` +
            `• **תהליך:** בחר משתמש → המשתמש מקבל הודעה → צריך לאשר או לדחות\n` +
            `• **אישור:** שני הצדדים צריכים להסכים להחלפה\n` +
            `• **ביטול:** אתה יכול לבטל את הבקשה שלך בכל עת (כפתור "Cancel Request")\n\n` +
            `⚡ **דיווח על משתמש (Report User):**\n` +
            `• **בקשת ענישה (Request Punishment)** - דיווח על משתמש אחר\n` +
            `• **תהליך:** בחר משתמש → בחר סיבה → מנהלים מקבלים הודעה\n` +
            `• **אישור:** מנהל צריך לאשר את הענישה (3 תורות נוספים)\n\n` +
            `🎯 **תור קבוע (Fixed Queue):** עדן (Eden) → עדלה (Adele) → אמה (Emma) → (חוזר)\n\n` +
            `💡 **טיפ (Tip):** השתמש בכפתורים לניווט קל יותר! (Use buttons for easier mobile interaction!)`;
        
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
            sendMessage(chatId, t(userId, 'current_admins', {adminList: adminList, count: admins.size}));
        }
        
    } else if (command === '/users' || command === 'users') {
        if (authorizedUsers.size === 0) {
            sendMessage(chatId, t(userId, 'no_authorized_users'));
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
        const userToAdd = command.replace('/addadmin ', '').trim();
        
        if (!userToAdd) {
            sendMessage(chatId, t(userId, 'usage_addadmin'));
            return;
        }
        
        // Check if this is the first admin (no existing admins)
        if (admins.size === 0) {
            // First admin can add themselves or anyone
            admins.add(userToAdd);
            admins.add(userToAdd.toLowerCase()); // Add lowercase version for case-insensitive matching
            
            // Note: We don't add chatId here because we don't know the new admin's chat ID yet
            // The new admin's chat ID will be stored when they send /start or interact with the bot
            sendMessage(chatId, t(userId, 'first_admin_added', {user: userToAdd}));
            return;
        }
        
        // If there are existing admins, check if current user is an admin
        if (!admins.has(userName) && !admins.has(userName.toLowerCase()) && !admins.has(userId.toString())) {
            sendMessage(chatId, t(userId, 'not_authorized_queue_commands', {user: userName}));
            return;
        }
        
        // Prevent self-promotion for existing admins
        if (userToAdd.toLowerCase() === userName.toLowerCase() || userToAdd === userId.toString()) {
            sendMessage(chatId, t(userId, 'cannot_add_yourself_admin', {user: userName}));
            return;
        }
        
        // Add the new admin
        admins.add(userToAdd);
        admins.add(userToAdd.toLowerCase()); // Add lowercase version for case-insensitive matching
        
        // Note: We don't add chatId here because we don't know the new admin's chat ID yet
        // The new admin's chat ID will be stored when they send /start or interact with the bot
        sendMessage(chatId, t(userId, 'admin_added', {user: userToAdd}));
        
    } else if (command.startsWith('/removeadmin ')) {
        // Check if user is already an admin
        if (!admins.has(userName) && !admins.has(userName.toLowerCase()) && !admins.has(userId.toString())) {
            sendMessage(chatId, t(userId, 'admin_access_required_simple', {user: userName}));
            return;
        }
        
        const userToRemove = command.replace('/removeadmin ', '').trim();
        if (userToRemove) {
            // Prevent self-removal (security protection)
            if (userToRemove.toLowerCase() === userName.toLowerCase() || userToRemove === userId.toString()) {
                sendMessage(chatId, t(userId, 'cannot_remove_yourself_admin', {user: userName}));
                return;
            }
            
            // Check if user exists in admins
            if (admins.has(userToRemove)) {
                admins.delete(userToRemove);
                sendMessage(chatId, t(userId, 'admin_removed', {user: userToRemove}));
            } else {
                sendMessage(chatId, t(userId, 'user_not_found_admin', {user: userToRemove}));
            }
        } else {
            sendMessage(chatId, t(userId, 'usage_removeadmin'));
        }
        
    } else if (command.startsWith('admin_punishment_reason_')) {
        // Handle admin punishment reason input
        const parts = command.split(' ');
        const requestId = parseInt(parts[0].replace('admin_punishment_reason_', ''));
        const reason = parts.slice(1).join(' ');
        
        const punishmentRequest = pendingPunishments.get(requestId);
        if (!punishmentRequest) {
            sendMessage(chatId, t(userId, 'punishment_request_expired'));
            return;
        }
        
        if (punishmentRequest.fromUserId !== userId) {
            sendMessage(chatId, t(userId, 'not_your_punishment'));
            return;
        }
        
        // Apply punishment directly (admin doesn't need approval)
        applyPunishment(punishmentRequest.targetUser, reason, userName);
        
        sendMessage(chatId, `${t(userId, 'punishment_applied')}\n\n${t(userId, 'target_user')} ${punishmentRequest.targetUser}\n${t(userId, 'reason')} ${reason}\n${t(userId, 'applied_by')} ${userName}`);
        
        // Remove request
        pendingPunishments.delete(requestId);
        
    } else if (command.startsWith('/authorize ')) {
        // Check if user is an admin
        if (!admins.has(userName) && !admins.has(userName.toLowerCase()) && !admins.has(userId.toString())) {
            sendMessage(chatId, t(userId, 'admin_access_required_authorize', {user: userName}));
            return;
        }
        
        const userToAuth = command.replace('/authorize ', '').trim();
        if (userToAuth) {
            if (authorizedUsers.size >= 3) {
                sendMessage(chatId, t(userId, 'max_authorized_users'));
            } else {
                // Check if user is one of the queue members
                const queueMember = queue.find(name => 
                    name.toLowerCase().includes(userToAuth.toLowerCase()) ||
                    userToAuth.toLowerCase().includes(name.toLowerCase())
                );
                
                if (queueMember) {
                    authorizedUsers.add(userToAuth);
                    authorizedUsers.add(userToAuth.toLowerCase()); // Add lowercase version for case-insensitive matching
                    userQueueMapping.set(userToAuth, queueMember);
                    userQueueMapping.set(userToAuth.toLowerCase(), queueMember); // Add lowercase mapping
                    queueUserMapping.set(queueMember, userToAuth);
                    
                    // Store chat ID for notifications (we'll need to get this from the user when they interact)
                    // For now, we'll store it when they send /start
                    sendMessage(chatId, `${t(userId, 'user_authorized')}\n\n👥 ${userToAuth} → ${queueMember}\n\n${t(userId, 'total_authorized')} ${authorizedUsers.size}/3`);
                } else {
                    sendMessage(chatId, t(userId, 'user_not_in_queue'));
                }
            }
        } else {
            sendMessage(chatId, t(userId, 'usage_authorize'));
        }
        
    } else {
        sendMessage(chatId, t(userId, 'unknown_command'));
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

// Execute approved swap (now creates debt instead of swapping positions)
function executeSwap(swapRequest, requestId, status) {
    const { fromUser, toUser, fromUserId, toUserId } = swapRequest;
    
    // Initialize anti-cheating tracking for swaps
    if (!global.swapTimestamps) global.swapTimestamps = [];
    
    // Check for rapid swap activity (3+ swaps in 10 minutes)
    const now = Date.now();
    const tenMinutesAgo = now - (10 * 60 * 1000);
    
    // Remove old timestamps (older than 10 minutes)
    global.swapTimestamps = global.swapTimestamps.filter(timestamp => timestamp > tenMinutesAgo);
    
    // Add current swap timestamp
    global.swapTimestamps.push(now);
    
    // Check if we have 3+ swaps in 10 minutes
    if (global.swapTimestamps.length >= 3) {
        // Only send alert if we haven't already alerted for this rapid swap session
        if (!global.swapTimestamps.alertSent) {
            alertAdminsAboutCheating(fromUserId, fromUser, 'rapid_swap', { swapCount: global.swapTimestamps.length });
            global.swapTimestamps.alertSent = true;
            console.log(`🚨 RAPID SWAP DETECTED: ${fromUser} (${fromUserId}) - ${global.swapTimestamps.length} swaps in 10 minutes`);
        }
    } else {
        // Reset alert flag when swap count drops below threshold
        global.swapTimestamps.alertSent = false;
    }
    
    console.log(`🔄 Executing swap: ${fromUser} ↔ ${toUser}`);
    console.log(`🔍 Current queue:`, queue);
    console.log(`🔍 User queue mapping:`, userQueueMapping);
    
    // Find queue positions
    const fromQueueName = userQueueMapping.get(fromUser) || userQueueMapping.get(fromUser.toLowerCase());
    const fromIndex = queue.indexOf(fromQueueName);
    const toIndex = queue.indexOf(toUser);
    
    console.log(`🔍 From user: ${fromUser} → Queue name: ${fromQueueName} → Index: ${fromIndex}`);
    console.log(`🔍 To user: ${toUser} → Index: ${toIndex}`);
    
    if (fromIndex !== -1 && toIndex !== -1) {
        // NEW DEBT SYSTEM: Create debt instead of swapping positions
        // Only the actual performer can offer their turn
        const scheduledUser = queue[currentTurn];
        const actualPerformer = getActualPerformer(scheduledUser);
        
        if (fromQueueName === actualPerformer) {
            // Check if fromUser is currently repaying a debt (debtor performing creditor's turn)
            if (hasDebtsOwedTo(scheduledUser) && getNextDebtorFor(scheduledUser) === fromQueueName) {
                // Clear the current debt repayment
                repayDebt(fromQueueName, scheduledUser);
                console.log(`💳 Cleared debt repayment: ${fromQueueName} no longer repays ${scheduledUser}`);
                
                // Create debt: fromUser owes toUser (1 turn)
                addDebt(fromQueueName, toUser);
                // Create active debt favor: toUser performs the CREDITOR's turn (not fromUser's turn)
                addActiveDebtFavor(scheduledUser, toUser);
                
                console.log(`💳 Debt created: ${fromQueueName} owes ${toUser} (1 turn)`);
                console.log(`💳 Active debt favor: ${toUser} performing ${scheduledUser}'s turn`);
            } else {
                // Normal case: fromUser is performing their own turn
                // Create debt: fromUser owes toUser (1 turn)
                addDebt(fromQueueName, toUser);
                // Create active debt favor: toUser performs fromUser's turn
                addActiveDebtFavor(fromQueueName, toUser);
                
                console.log(`💳 Debt created: ${fromQueueName} owes ${toUser} (1 turn)`);
            }
        
        // Notify both users in their language
            const fromUserMessage = `✅ **${t(fromUserId, 'swap_completed')}**\n\n🔄 **${fromUser} ↔ ${toUser}**\n\n💳 **${t(fromUserId, 'debt_created')}:** ${fromUser} owes ${toUser} (1 turn)\n\n🔄 **${t(fromUserId, 'next_turn')}:** ${toUser}`;
            const toUserMessage = `✅ **${t(toUserId, 'swap_completed')}**\n\n🔄 **${fromUser} ↔ ${toUser}**\n\n💳 **${t(toUserId, 'debt_created')}:** ${fromUser} owes ${toUser} (1 turn)\n\n🔄 **${t(toUserId, 'next_turn')}:** ${toUser}`;
        
        sendMessage(fromUserId, fromUserMessage);
        sendMessage(toUserId, toUserMessage);
        
        // Notify all other authorized users and admins using userChatIds in their language
        [...authorizedUsers, ...admins].forEach(user => {
            if (user !== fromUser && user !== toUser) {
                let userChatId = userChatIds.get(user) || userChatIds.get(user.toLowerCase());
                if (userChatId) {
                    // Create swap notification in recipient's language
                        const swapNotification = `🔄 **${t(userChatId, 'queue_update')}:** ${fromUser} ↔ ${toUser} ${t(userChatId, 'swapped_positions')}!\n💳 **${t(userChatId, 'debt_created')}:** ${fromUser} owes ${toUser} (1 turn)`;
                    console.log(`🔔 Sending swap approval notification to ${user} (${userChatId})`);
                    sendMessage(userChatId, swapNotification);
                } else {
                    console.log(`🔔 No chat ID found for ${user}`);
                }
            }
        });
        } else {
            // Not the scheduled user's turn - cannot swap
            const errorMessage = `❌ **${t(fromUserId, 'swap_error')}**\n\n${t(fromUserId, 'only_scheduled_user_can_swap')}\n\n${t(fromUserId, 'current_turn_user')} ${queue[currentTurn]}`;
            sendMessage(fromUserId, errorMessage);
        }
    }
    
    // Remove the request
    pendingSwaps.delete(requestId);
}

// Handle callback queries (button presses)
function handleCallback(chatId, userId, userName, data) {
    console.log(`🔘 Button pressed: "${data}" by ${userName}`);
    
    if (data === 'test') {
        sendMessage(chatId, t(userId, 'test_button_works', {user: userName, userId: userId, data: data}));
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
    } else if (data === 'dishwasher_alert') {
        console.log(`🔍 DEBUG - Dishwasher alert handler triggered by ${userName} (${userId})`);
        
        // Check if this is an admin
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        console.log(`🔍 DEBUG - Is admin check: ${isAdmin} (userName: ${userName}, userId: ${userId})`);
        
        if (!isAdmin) {
            console.log(`🔍 DEBUG - Access denied for ${userName}`);
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        // Get current turn user
        const currentUser = queue[currentTurn];
        if (!currentUser) {
            sendMessage(chatId, t(userId, 'no_one_in_queue'));
            return;
        }
        
        // Send alert to all authorized users and admins with their preferred language
        [...authorizedUsers, ...admins].forEach(user => {
            let userChatId = userChatIds.get(user) || userChatIds.get(user.toLowerCase());
            if (userChatId && userChatId !== chatId) {
                // Create alert message in recipient's language
                const alertMessage = t(userChatId, 'dishwasher_alert_message', {user: currentUser, sender: userName});
                console.log(`🔔 Sending dishwasher alert to ${user} (${userChatId})`);
                sendMessage(userChatId, alertMessage);
            }
        });
        
        // Also notify admins using adminChatIds (in case they're not in userChatIds)
        adminChatIds.forEach(adminChatId => {
            if (adminChatId !== chatId) {
                // Create alert message in admin's language
                const adminAlertMessage = t(adminChatId, 'dishwasher_alert_message', {user: currentUser, sender: userName});
                console.log(`🔔 Sending dishwasher alert to admin chat ID: ${adminChatId}`);
                sendMessage(adminChatId, adminAlertMessage);
            }
        });
        
        // Send confirmation to admin
        sendMessage(chatId, `${t(userId, 'dishwasher_alert_sent')}\n\n${t(userId, 'alerted_user')} ${currentUser}\n${t(userId, 'sent_to_all')}`);
        
        // Mark that manual alert was sent (cancel auto-alert)
        global.dishwasherAlertSent = true;
        
    } else if (data === 'dishwasher_started') {
        console.log(`🔍 DEBUG - Dishwasher started handler triggered by ${userName} (${userId})`);
        
        // Check if this is an admin
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        console.log(`🔍 DEBUG - Is admin check: ${isAdmin} (userName: ${userName}, userId: ${userId})`);
        
        if (!isAdmin) {
            console.log(`🔍 DEBUG - Access denied for ${userName}`);
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        // Get current user doing the dishes
        const currentUser = queue[currentTurn];
        if (!currentUser) {
            sendMessage(chatId, t(userId, 'no_one_in_queue'));
            return;
        }
        
        // Send notification to all authorized users and admins with their preferred language
        [...authorizedUsers, ...admins].forEach(user => {
            let userChatId = userChatIds.get(user) || userChatIds.get(user.toLowerCase());
            if (userChatId && userChatId !== chatId) {
                // Create started message in recipient's language
                const startedMessage = t(userChatId, 'dishwasher_started_message', {user: currentUser, sender: userName});
                console.log(`🔔 Sending dishwasher started notification to ${user} (${userChatId})`);
                sendMessage(userChatId, startedMessage);
            }
        });
        
        // Also notify admins using adminChatIds (in case they're not in userChatIds)
        adminChatIds.forEach(adminChatId => {
            if (adminChatId !== chatId) {
                // Create started message in admin's language
                const adminStartedMessage = t(adminChatId, 'dishwasher_started_message', {user: currentUser, sender: userName});
                console.log(`🔔 Sending dishwasher started notification to admin chat ID: ${adminChatId}`);
                sendMessage(adminChatId, adminStartedMessage);
            }
        });
        
        // Clear any existing auto-alert timer
        if (global.dishwasherAutoAlertTimer) {
            clearTimeout(global.dishwasherAutoAlertTimer);
            global.dishwasherAutoAlertTimer = null;
        }
        
        // Set up auto-alert timer (3 hours)
        const autoAlertTimeout = setTimeout(() => {
            // Check if we should still send the auto-alert
            if (global.dishwasherStarted && !global.dishwasherAlertSent && !global.dishwasherCompleted) {
                console.log(`⏰ Auto-alert triggered after 3 hours for ${currentUser}`);
                
                // Send dishwasher alert to all authorized users and admins
                [...authorizedUsers, ...admins].forEach(user => {
                    let userChatId = userChatIds.get(user) || userChatIds.get(user.toLowerCase());
                    if (userChatId) {
                        const alertMessage = t(userChatId, 'dishwasher_alert_message', {user: currentUser, sender: t(userChatId, 'auto_timer')});
                        console.log(`🔔 Sending auto dishwasher alert to ${user} (${userChatId})`);
                        sendMessage(userChatId, alertMessage);
                    }
                });
                
                // Mark alert as sent
                global.dishwasherAlertSent = true;
            }
        }, 3 * 60 * 60 * 1000); // 3 hours in milliseconds
        
        // Store timer reference for potential cleanup
        global.dishwasherAutoAlertTimer = autoAlertTimeout;
        
        // Mark dishwasher as started
        global.dishwasherStarted = true;
        global.dishwasherAlertSent = false;
        global.dishwasherCompleted = false;
        
        // Send confirmation to admin
        sendMessage(chatId, `${t(userId, 'dishwasher_started_sent')}\n\n${t(userId, 'alerted_user')} ${currentUser}\n${t(userId, 'sent_to_all')}`);
        
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
            sendMessage(chatId, t(userId, 'admin_access_required'));
        }
    } else if (data === 'addadmin_menu') {
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        if (isAdmin) {
            const message = `➕ **Add Admin**\n\n` +
                `💡 **Usage:** Type \`/addadmin <username>\`\n\n` +
                `**Example:** \`/addadmin Marianna\``;
            sendMessage(chatId, message);
        } else {
            sendMessage(chatId, t(userId, 'admin_access_required'));
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
        for (const adminChatId of adminChatIds) {
            if (adminChatId !== chatId) { // Don't notify the user themselves
                console.log(`🔔 Sending admin notification to chat ID: ${adminChatId}`);
                sendMessage(adminChatId, adminNotification);
            }
        }
        
    } else if (data === 'create_announcement') {
        // Admin creates announcement
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        sendMessage(chatId, t(userId, 'type_announcement_message'));
        userStates.set(userId, 'typing_announcement');
        
    } else if (data === 'send_user_message') {
        // User or admin sends message
        const isAuthorized = authorizedUsers.has(userName) || authorizedUsers.has(userName.toLowerCase()) || 
                           admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        if (!isAuthorized) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        sendMessage(chatId, t(userId, 'type_your_message'));
        userStates.set(userId, 'typing_message');
        
    } else if (data === 'confirm_send_announcement') {
        // Admin confirms sending announcement
        const announcement = pendingAnnouncements.get(userId);
        if (announcement) {
            broadcastAnnouncement(announcement.text, announcement.fromAdmin);
            sendMessage(chatId, `${t(userId, 'announcement_sent')}\n\n${t(userId, 'sent_to')} ${[...authorizedUsers, ...admins].length - 1} ${t(userId, 'users')}`);
            pendingAnnouncements.delete(userId);
        }
        
    } else if (data === 'confirm_send_message') {
        // User/admin confirms sending message
        const message = pendingMessages.get(userId);
        if (message) {
            broadcastMessage(message.text, message.fromUser, false);
            sendMessage(chatId, `${t(userId, 'message_sent')}\n\n${t(userId, 'sent_to')} ${[...authorizedUsers, ...admins].length - 1} ${t(userId, 'users')}`);
            pendingMessages.delete(userId);
        }
        
    } else if (data === 'cancel_announcement' || data === 'cancel_message') {
        // Cancel announcement or message
        pendingAnnouncements.delete(userId);
        pendingMessages.delete(userId);
        userStates.delete(userId);
        sendMessage(chatId, t(userId, 'cancel'));
        
    } else if (data === 'acknowledge_announcement') {
        // User acknowledges announcement (simple response)
        sendMessage(chatId, '✅');
        
    } else if (data === 'like_message') {
        // User likes message (simple response)
        sendMessage(chatId, '👍');
        
    } else if (data === 'maintenance_menu') {
        // Admin maintenance menu
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        const maintenanceText = `${t(userId, 'maintenance')} Menu`;
        const maintenanceButtons = [
            [
                { text: t(userId, 'queue_management'), callback_data: "queue_management_menu" }
            ],
            [
                { text: t(userId, 'monthly_report'), callback_data: "monthly_report_show" },
                { text: t(userId, 'share_monthly_report'), callback_data: "share_monthly_report" }
            ],
            [
                { text: t(userId, 'users'), callback_data: "users" }
            ],
            [
                { text: t(userId, 'admins'), callback_data: "admins" }
            ],
            [
                { text: t(userId, 'authorize'), callback_data: "authorize_menu" }
            ],
            [
                { text: t(userId, 'add_admin'), callback_data: "addadmin_menu" }
            ]
        ];
        
        sendMessageWithButtons(chatId, maintenanceText, maintenanceButtons);
        
    } else if (data === 'monthly_report_show') {
        // Show monthly report
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        const currentMonthKey = getCurrentMonthKey();
        const report = generateMonthlyReport(currentMonthKey, userId);
        sendMessage(chatId, report);
        
    } else if (data === 'share_monthly_report') {
        // Share monthly report with all users
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        const currentMonthKey = getCurrentMonthKey();
        const recipientCount = broadcastMonthlyReport(currentMonthKey, false);
        sendMessage(chatId, t(userId, 'monthly_report_shared', {count: recipientCount}));
        
    } else if (data === 'queue_management_menu') {
        // Queue Management submenu
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        const queueManagementText = `${t(userId, 'queue_management')} Menu`;
        const queueManagementButtons = [
            [
                { text: t(userId, 'reorder_queue'), callback_data: "reorder_queue_menu" },
                { text: t(userId, 'queue_statistics'), callback_data: "queue_statistics_show" }
            ],
            [
                { text: t(userId, 'suspend_user'), callback_data: "suspend_user_menu" },
                { text: t(userId, 'reactivate_user'), callback_data: "reactivate_user_menu" }
            ],
            [
                { text: t(userId, 'remove_user'), callback_data: "remove_user_menu" }
            ],
            [
                { text: t(userId, 'reset_queue'), callback_data: "reset_queue_confirm" }
            ]
        ];
        
        sendMessageWithButtons(chatId, queueManagementText, queueManagementButtons);
        
    // Queue Management Handlers
    } else if (data === 'reorder_queue_menu') {
        // Step 1: Select user to reorder
        const queueUsers = ['Eden', 'Adele', 'Emma'];
        const buttons = queueUsers.map(user => [{ text: addRoyalEmoji(user), callback_data: `reorder_select_${user}` }]);
        sendMessageWithButtons(chatId, t(userId, 'select_user_to_reorder'), buttons);
        
    } else if (data.startsWith('reorder_select_')) {
        // Step 2: Select new position for user
        const selectedUser = data.replace('reorder_select_', '');
        const positionButtons = [
            [{ text: t(userId, 'position_1'), callback_data: `reorder_position_${selectedUser}_1` }],
            [{ text: t(userId, 'position_2'), callback_data: `reorder_position_${selectedUser}_2` }],
            [{ text: t(userId, 'position_3'), callback_data: `reorder_position_${selectedUser}_3` }]
        ];
        sendMessageWithButtons(chatId, t(userId, 'select_new_position', {user: addRoyalEmoji(selectedUser)}), positionButtons);
        
    } else if (data.startsWith('reorder_position_')) {
        // Execute reorder (rebuild queue in desired order)
        const parts = data.replace('reorder_position_', '').split('_');
        const selectedUser = parts[0];
        const newPosition = parseInt(parts[1]) - 1; // Convert to 0-based index
        
        // Get all positions of user (including punishment turns)
        const userPositions = getAllUserPositions(selectedUser);
        
        if (userPositions.length > 0) {
            // Store current queue state
            const originalQueue = [...queue];
            const originalCurrentTurn = currentTurn;
            
            // Extract the user and their punishment turns
            const removedUsers = [];
            for (let i = userPositions.length - 1; i >= 0; i--) {
                removedUsers.unshift(queue.splice(userPositions[i], 1)[0]);
            }
            
            // Get the base queue (unique users only)
            const baseQueue = ['Eden', 'Adele', 'Emma'];
            const otherUsers = baseQueue.filter(user => user !== selectedUser);
            
            // Build new base order
            const newBaseOrder = [];
            for (let i = 0; i < baseQueue.length; i++) {
                if (i === newPosition) {
                    newBaseOrder.push(selectedUser);
                }
                if (otherUsers.length > 0) {
                    const nextUser = otherUsers.shift();
                    if (nextUser !== selectedUser) {
                        newBaseOrder.push(nextUser);
                    }
                }
            }
            
            // If position is at the end and not yet added
            if (newPosition >= newBaseOrder.length && !newBaseOrder.includes(selectedUser)) {
                newBaseOrder.push(selectedUser);
            }
            
            // Rebuild queue with punishment turns
            queue.length = 0; // Clear queue
            
            // Add base users
            newBaseOrder.forEach(user => {
                queue.push(user);
            });
            
            // Add punishment turns back for the moved user
            const punishmentCount = removedUsers.length - 1; // -1 for the normal turn
            for (let i = 0; i < punishmentCount; i++) {
                queue.push(selectedUser);
            }
            
            // Add punishment turns for other users (if any)
            baseQueue.forEach(user => {
                if (user !== selectedUser) {
                    const userPunishments = punishmentTurns.get(user) || 0;
                    for (let i = 0; i < userPunishments; i++) {
                        queue.push(user);
                    }
                }
            });
            
            // Adjust currentTurn to point to the same logical position
            const currentUserInOriginal = originalQueue[originalCurrentTurn];
            const newCurrentIndex = queue.indexOf(currentUserInOriginal);
            currentTurn = newCurrentIndex !== -1 ? newCurrentIndex : 0;
            
            const punishmentNote = punishmentCount > 0 ? ` (including ${punishmentCount} punishment turns)` : '';
            const reorderMessage = `${t(userId, 'queue_reordered')}${punishmentNote}\n\n${t(userId, 'new_queue_order_is')}\n${queue.map((user, index) => `${index + 1}. ${addRoyalEmoji(user)}`).join('\n')}`;
            sendMessage(chatId, reorderMessage);
        } else {
            sendMessage(chatId, `❌ Cannot reorder ${addRoyalEmoji(selectedUser)} - not found in queue`);
        }
        
    } else if (data === 'queue_statistics_show') {
        // Show queue statistics
        let statsMessage = `${t(userId, 'queue_statistics_title')}\n\n`;
        
        // Current queue order (active users only)
        statsMessage += `${t(userId, 'current_queue_order')}\n`;
        queue.forEach((user, index) => {
            const emoji = addRoyalEmoji(user);
            statsMessage += `${index + 1}. ${emoji}\n`;
        });
        
        // Statistics (placeholder for now - can be enhanced later)
        statsMessage += `\n${t(userId, 'total_completions')}\n`;
        ['Eden', 'Adele', 'Emma'].forEach(user => {
            const stats = queueStatistics.get(user) || { totalCompletions: 0 };
            statsMessage += `${addRoyalEmoji(user)}: ${stats.totalCompletions}\n`;
        });
        
        // Suspended users with punishment debt
        const suspended = Array.from(suspendedUsers.entries());
        if (suspended.length > 0) {
            statsMessage += `\n${t(userId, 'suspended_users_list')}\n`;
            suspended.forEach(([user, data]) => {
                const date = data.suspendedUntil.toLocaleDateString();
                const debtText = data.punishmentDebt > 0 ? ` (${data.punishmentDebt} punishment turns)` : '';
                
                // Check if this is a permanent removal (100+ year suspension)
                const now = new Date();
                const yearsUntilExpiry = (data.suspendedUntil - now) / (1000 * 60 * 60 * 24 * 365);
                const isPermanent = yearsUntilExpiry > 50; // If more than 50 years, consider it permanent
                
                if (isPermanent) {
                    statsMessage += `${addRoyalEmoji(user)}: ${t(userId, 'permanently_removed')}${debtText}\n`;
                } else {
                    statsMessage += `${addRoyalEmoji(user)}: ${t(userId, 'suspended_until', {date})}${debtText}\n`;
                }
            });
        }
        
        sendMessage(chatId, statsMessage);
        
    } else if (data === 'suspend_user_menu') {
        // Select user to suspend (only show users currently in queue)
        if (queue.length === 0) {
            sendMessage(chatId, 'No users in queue to suspend.');
            return;
        }
        const buttons = queue.map(user => [{ text: addRoyalEmoji(user), callback_data: `suspend_select_${user}` }]);
        sendMessageWithButtons(chatId, t(userId, 'select_user_to_suspend'), buttons);
        
    } else if (data.startsWith('suspend_select_')) {
        // Select suspension duration
        const selectedUser = data.replace('suspend_select_', '');
        const durationButtons = [
            [{ text: t(userId, 'duration_1_day'), callback_data: `suspend_duration_${selectedUser}_1` }],
            [{ text: t(userId, 'duration_3_days'), callback_data: `suspend_duration_${selectedUser}_3` }],
            [{ text: t(userId, 'duration_7_days'), callback_data: `suspend_duration_${selectedUser}_7` }],
            [{ text: t(userId, 'duration_14_days'), callback_data: `suspend_duration_${selectedUser}_14` }],
            [{ text: t(userId, 'duration_30_days'), callback_data: `suspend_duration_${selectedUser}_30` }]
        ];
        sendMessageWithButtons(chatId, t(userId, 'select_suspension_duration', {user: addRoyalEmoji(selectedUser)}), durationButtons);
        
    } else if (data.startsWith('suspend_duration_')) {
        // Execute suspension
        const parts = data.replace('suspend_duration_', '').split('_');
        const selectedUser = parts[0];
        const days = parseInt(parts[1]);
        
        const success = suspendUser(selectedUser, days);
        if (success) {
            const durationText = days === 1 ? t(userId, 'duration_1_day').replace('1️⃣ ', '') :
                               days === 3 ? t(userId, 'duration_3_days').replace('3️⃣ ', '') :
                               days === 7 ? t(userId, 'duration_7_days').replace('7️⃣ ', '') :
                               days === 14 ? t(userId, 'duration_14_days').replace('🗓️ ', '') :
                               days === 30 ? t(userId, 'duration_30_days').replace('📅 ', '') : `${days} days`;
            
            sendMessage(chatId, t(userId, 'user_suspended', {user: addRoyalEmoji(selectedUser), duration: durationText}));
        } else {
            sendMessage(chatId, `❌ Failed to suspend ${addRoyalEmoji(selectedUser)}`);
        }
        
    } else if (data === 'reactivate_user_menu') {
        // Select user to reactivate
        const suspendedUsersList = Array.from(suspendedUsers.keys());
        if (suspendedUsersList.length === 0) {
            sendMessage(chatId, t(userId, 'no_suspended_users'));
            return;
        }
        const buttons = suspendedUsersList.map(user => [{ text: addRoyalEmoji(user), callback_data: `reactivate_${user}` }]);
        sendMessageWithButtons(chatId, t(userId, 'select_user_to_reactivate'), buttons);
        
    } else if (data.startsWith('reactivate_')) {
        // Execute reactivation
        const selectedUser = data.replace('reactivate_', '');
        const success = reactivateUser(selectedUser);
        if (success) {
            sendMessage(chatId, t(userId, 'user_reactivated', {user: addRoyalEmoji(selectedUser)}));
        } else {
            sendMessage(chatId, `❌ Failed to reactivate ${addRoyalEmoji(selectedUser)}`);
        }
        
    } else if (data === 'remove_user_menu') {
        // Select user to remove permanently (only show users currently in queue)
        if (queue.length === 0) {
            sendMessage(chatId, 'No users in queue to remove.');
            return;
        }
        const buttons = queue.map(user => [{ text: addRoyalEmoji(user), callback_data: `remove_${user}` }]);
        sendMessageWithButtons(chatId, t(userId, 'select_user_to_remove'), buttons);
        
    } else if (data.startsWith('remove_')) {
        // Execute permanent removal (100-year suspension)
        const selectedUser = data.replace('remove_', '');
        const success = suspendUser(selectedUser, 36500, t(userId, 'permanently_removed')); // 100 years
        if (success) {
            sendMessage(chatId, t(userId, 'user_removed', {user: addRoyalEmoji(selectedUser)}));
        } else {
            sendMessage(chatId, `❌ Failed to remove ${addRoyalEmoji(selectedUser)}`);
        }
        
    } else if (data === 'reset_queue_confirm') {
        // Confirm queue reset
        const confirmButtons = [
            [{ text: t(userId, 'confirm_reset'), callback_data: 'reset_queue_execute' }],
            [{ text: t(userId, 'cancel'), callback_data: 'maintenance_menu' }]
        ];
        sendMessageWithButtons(chatId, t(userId, 'queue_reset_confirm'), confirmButtons);
        
    } else if (data === 'reset_queue_execute') {
        // Execute queue reset
        queue.length = 0;
        queue.push(...originalQueueOrder);
        currentTurn = 0;
        suspendedUsers.clear();
        sendMessage(chatId, t(userId, 'queue_reset_success'));
        
    } else if (data === 'language_switch') {
        const currentLang = getUserLanguage(userId);
        const newLang = currentLang === 'en' ? 'he' : 'en';
        userLanguage.set(userId, newLang);
        
        const switchMessage = newLang === 'he' ? 
            `🇮🇱 **שפה שונתה לעברית!** ✅\n\nהבוט יציג כעת הכל בעברית.\nשלח /start כדי לראות את התפריט החדש! 🎯` :
            `🇺🇸 **Language switched to English!** ✅\n\nThe bot will now display everything in English.\nSend /start to see the new menu! 🎯`;
        
        sendMessage(chatId, switchMessage);
        
    } else if (data === 'swap_menu') {
        const isAuthorized = authorizedUsers.has(userName) || authorizedUsers.has(userName.toLowerCase());
        if (!isAuthorized) {
            sendMessage(chatId, t(userId, 'not_authorized_swap_features'));
            return;
        }
        
        const currentUserQueueName = userQueueMapping.get(userName) || userQueueMapping.get(userName.toLowerCase());
        
        // Show all users except the current user (can't swap with yourself)
        const uniqueUsers = [...new Set(queue)];
        const availableUsers = uniqueUsers.filter(name => name !== currentUserQueueName);
        const buttons = availableUsers.map(name => [{ text: addRoyalEmoji(name), callback_data: `swap_request_${name}` }]);
        
        sendMessageWithButtons(chatId, 
            t(userId, 'request_swap_your_position', {position: currentUserQueueName}), 
            buttons
        );
        
    } else if (data.startsWith('swap_request_')) {
        const targetUser = data.replace('swap_request_', '');
        const currentUserQueueName = userQueueMapping.get(userName) || userQueueMapping.get(userName.toLowerCase());
        
        if (!currentUserQueueName) {
            sendMessage(chatId, t(userId, 'error_queue_position'));
            return;
        }
        
        // Check if it's the current user's turn (actual performer, not just scheduled)
        const currentUserIndex = queue.indexOf(currentUserQueueName);
        const scheduledUser = queue[currentTurn];
        const actualPerformer = getActualPerformer(scheduledUser);
        
        // Only the actual performer can request swaps
        if (actualPerformer !== currentUserQueueName) {
            sendMessage(chatId, t(userId, 'not_your_turn_swap'));
            return;
        }
        
        // Check if user already has a pending swap request
        for (const [requestId, request] of pendingSwaps.entries()) {
            if (request.fromUserId === userId) {
                sendMessage(chatId, t(userId, 'pending_swap_exists', {fromUser: request.fromUser, toUser: request.toUser, requestId: requestId}));
                return;
            }
        }
        
        // Check if target user already has a pending swap request
        for (const [requestId, request] of pendingSwaps.entries()) {
            if (request.toUserId === targetUserId || request.fromUserId === targetUserId) {
                sendMessage(chatId, t(userId, 'target_has_pending_swap', {targetUser: targetUser, fromUser: request.fromUser, toUser: request.toUser, requestId: requestId}));
                return;
            }
        }
        
        // Create swap request
        const requestId = ++swapRequestCounter;
        const targetUserId = queueUserMapping.get(targetUser);
        
        // Get the actual chat ID for the target user
        const targetChatId = userChatIds.get(targetUserId) || userChatIds.get(targetUserId.toLowerCase());
        
        if (!targetChatId) {
            sendMessage(chatId, t(userId, 'target_user_not_found', {targetUser: targetUser}));
            return;
        }
        
        pendingSwaps.set(requestId, {
            fromUser: userName,
            toUser: targetUser,
            fromUserId: userId,
            toUserId: targetChatId, // Store the actual chat ID, not username
            timestamp: Date.now()
        });
        
        // Notify the target user
        if (targetChatId) {
            const buttons = createLocalizedButtons(targetChatId, [
                [
                { translationKey: 'approve', callback_data: `swap_approve_${requestId}` },
                { translationKey: 'reject', callback_data: `swap_reject_${requestId}` }
                ]
            ]);
            
            sendMessageWithButtons(targetChatId, 
                `🔄 **${t(targetChatId, 'swap_request_title')}**\n\n👤 **${t(targetChatId, 'from_user')}:** ${userName} (${currentUserQueueName})\n🎯 **${t(targetChatId, 'wants_to_swap_with')}:** ${targetUser}`, 
                buttons
            );
        } else {
            console.log(`❌ No chat ID found for target user: ${targetUserId}`);
        }
        
        // Notify all admins about the swap request in their language
        for (const adminChatId of adminChatIds) {
            if (adminChatId !== chatId && adminChatId !== targetChatId) { // Don't notify the requester or target user
                // Create notification in admin's language
                const adminNotification = `🔄 **${t(adminChatId, 'new_swap_request')}**\n\n👤 **${t(adminChatId, 'from_user')}:** ${userName} (${currentUserQueueName})\n🎯 **${t(adminChatId, 'wants_to_swap_with')}:** ${targetUser}\n📅 **${t(adminChatId, 'time')}:** ${new Date().toLocaleString()}\n\n💡 **${t(adminChatId, 'request_id')}:** ${requestId}`;
                console.log(`🔔 Sending admin swap notification to chat ID: ${adminChatId}`);
                sendMessage(adminChatId, adminNotification);
            }
        }
        
        // Send confirmation to the requester with cancel option
        const cancelButtons = [
            [
                { text: t(userId, 'cancel_request'), callback_data: `swap_cancel_${requestId}` }
            ]
        ];
        
        sendMessageWithButtons(chatId, 
            t(userId, 'swap_request_sent_detailed', {user: targetUser}), 
            cancelButtons
        );
        
    } else if (data.startsWith('swap_approve_')) {
        const requestId = parseInt(data.replace('swap_approve_', ''));
        const swapRequest = pendingSwaps.get(requestId);
        
        console.log(`🔘 Button pressed: "${data}" by ${userName}`);
        console.log(`🔍 Swap request ID: ${requestId}`);
        console.log(`🔍 Swap request found:`, swapRequest);
        
        if (!swapRequest) {
            console.log(`❌ Swap request not found for ID: ${requestId}`);
            sendMessage(chatId, t(userId, 'swap_request_not_found'));
            return;
        }
        
        // Check if this is the correct user approving
        console.log(`🔍 Checking approval: swapRequest.toUserId (${swapRequest.toUserId}) === userId (${userId})`);
        if (swapRequest.toUserId !== userId) {
            console.log(`❌ Swap request not for this user`);
            sendMessage(chatId, t(userId, 'swap_request_not_for_you'));
            return;
        }
        
        console.log(`✅ Approval valid, executing swap...`);
        // Execute the swap
        executeSwap(swapRequest, requestId, 'approved');
        
    } else if (data.startsWith('swap_reject_')) {
        const requestId = parseInt(data.replace('swap_reject_', ''));
        const swapRequest = pendingSwaps.get(requestId);
        
        if (!swapRequest) {
            sendMessage(chatId, t(userId, 'swap_request_not_found'));
            return;
        }
        
        // Check if this is the correct user rejecting
        if (swapRequest.toUserId !== userId) {
            sendMessage(chatId, t(userId, 'swap_request_not_for_you'));
            return;
        }
        
        // Notify the requester
        sendMessage(swapRequest.fromUserId, t(swapRequest.fromUserId, 'swap_request_rejected_simple', {user: userName}));
        sendMessage(chatId, t(userId, 'you_declined_swap_request', {user: swapRequest.fromUser}));
        
        // Notify all admins about the rejection in their language
        for (const adminChatId of adminChatIds) {
            if (adminChatId !== chatId && adminChatId !== swapRequest.fromUserId) { // Don't notify the rejector or requester
                // Create rejection notification in admin's language
                const adminNotification = `❌ **${t(adminChatId, 'swap_request_rejected_title')}**\n\n👤 **${t(adminChatId, 'from_user')}:** ${swapRequest.fromUser}\n👤 **${t(adminChatId, 'rejected_by')}:** ${userName}\n📅 **${t(adminChatId, 'time')}:** ${new Date().toLocaleString()}`;
                console.log(`🔔 Sending admin swap rejection notification to chat ID: ${adminChatId}`);
                sendMessage(adminChatId, adminNotification);
            }
        }
        
        // Remove the request
        pendingSwaps.delete(requestId);
        
    } else if (data.startsWith('swap_cancel_')) {
        const requestId = parseInt(data.replace('swap_cancel_', ''));
        const swapRequest = pendingSwaps.get(requestId);
        
        if (!swapRequest) {
            sendMessage(chatId, t(userId, 'swap_request_not_found'));
            return;
        }
        
        // Check if this is the correct user canceling
        if (swapRequest.fromUserId !== userId) {
            sendMessage(chatId, t(userId, 'swap_request_not_yours'));
            return;
        }
        
        // Notify the target user that the request was canceled
        if (swapRequest.toUserId) {
            sendMessage(swapRequest.toUserId, t(swapRequest.toUserId, 'swap_request_canceled_notification', {user: userName}));
        }
        
        // Notify the requester
        sendMessage(chatId, t(userId, 'swap_request_canceled_confirmation', {user: swapRequest.toUser}));
        
        // Notify all admins about the cancellation in their language
        for (const adminChatId of adminChatIds) {
            if (adminChatId !== chatId && adminChatId !== swapRequest.toUserId) { // Don't notify the canceler or target user
                // Create cancellation notification in admin's language
                const adminNotification = t(adminChatId, 'swap_request_canceled_admin', {
                    from: swapRequest.fromUser,
                    canceledBy: userName,
                    target: swapRequest.toUser,
                    time: new Date().toLocaleString()
                });
                console.log(`🔔 Sending admin swap cancellation notification to chat ID: ${adminChatId}`);
                sendMessage(adminChatId, adminNotification);
            }
        }
        
        // Remove the request
        pendingSwaps.delete(requestId);
        
    } else if (data === 'force_swap_menu') {
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        console.log(`🔍 Queue contents:`, queue);
        console.log(`🔍 Current turn:`, currentTurn);
        
        // Show actual performer for Force Swap (who will actually perform the turn)
        const scheduledUser = queue[currentTurn];
        const actualPerformer = getActualPerformer(scheduledUser);
        const royalActualPerformer = addRoyalEmoji(actualPerformer);
        const buttons = [[{ text: t(userId, 'current_turn_button', {user: royalActualPerformer}), callback_data: `force_swap_select_${actualPerformer}` }]];
        
        console.log(`🔍 Force Swap - Actual performer: ${actualPerformer} (scheduled: ${scheduledUser})`);
        
        sendMessageWithButtons(chatId, 
            `${t(userId, 'force_swap_current_turn')} **${royalActualPerformer}**\n\n${t(userId, 'swap_current_turn_with')}`, 
            buttons
        );
        
    } else if (data.startsWith('force_swap_select_')) {
        const firstUser = data.replace('force_swap_select_', '');
        
        // Get unique users excluding the current turn user
        const uniqueUsers = [...new Set(queue)];
        const remainingUsers = uniqueUsers.filter(name => name !== firstUser);
        
        const buttons = remainingUsers.map(name => [{ text: addRoyalEmoji(name), callback_data: `force_swap_execute_${firstUser}_${name}` }]);
        const royalFirstUser = addRoyalEmoji(firstUser);
        
        sendMessageWithButtons(chatId, 
            `${t(userId, 'force_swap_step2')}\n\n🎯 **Actual performer:** ${royalFirstUser}\n${t(userId, 'swap_with_select')}`, 
            buttons
        );
        
    } else if (data.startsWith('force_swap_execute_')) {
        const dataWithoutPrefix = data.replace('force_swap_execute_', '');
        const lastUnderscoreIndex = dataWithoutPrefix.lastIndexOf('_');
        const firstUser = dataWithoutPrefix.substring(0, lastUnderscoreIndex);
        const secondUser = dataWithoutPrefix.substring(lastUnderscoreIndex + 1);
        
        console.log(`🔍 DEBUG - Force swap: ${firstUser} ↔ ${secondUser}`);
        console.log(`🔍 DEBUG - Current queue: [${queue.join(', ')}]`);
        console.log(`🔍 DEBUG - Current turn: ${currentTurn}`);
        
        // NEW DEBT SYSTEM: Force swap creates debt instead of swapping positions
        // Only the actual performer can be force swapped
        const scheduledUser = queue[currentTurn];
        const actualPerformer = getActualPerformer(scheduledUser);
        
        if (actualPerformer === firstUser) {
            // Check if firstUser is currently repaying a debt (debtor performing creditor's turn)
            if (hasDebtsOwedTo(scheduledUser) && getNextDebtorFor(scheduledUser) === firstUser) {
                // Clear the current debt repayment
                repayDebt(firstUser, scheduledUser);
                console.log(`💳 Cleared debt repayment: ${firstUser} no longer repays ${scheduledUser}`);
                
                // Create debt: firstUser owes secondUser (1 turn)
                addDebt(firstUser, secondUser);
                // Create active debt favor: secondUser performs the CREDITOR's turn (not firstUser's turn)
                addActiveDebtFavor(scheduledUser, secondUser);
                
                console.log(`💳 Force swap debt created: ${firstUser} owes ${secondUser} (1 turn)`);
                console.log(`💳 Active debt favor: ${secondUser} performing ${scheduledUser}'s turn`);
            } else {
                // Normal case: firstUser is performing their own turn
                // Create debt: firstUser owes secondUser (1 turn)
                addDebt(firstUser, secondUser);
                // Create active debt favor: secondUser performs firstUser's turn
                addActiveDebtFavor(firstUser, secondUser);
                
                console.log(`💳 Force swap debt created: ${firstUser} owes ${secondUser} (1 turn)`);
            }
            
            // Notify admin
            const adminMessage = `⚡ **${t(userId, 'admin_force_swap_executed')}**\n\n🔄 **${firstUser} ↔ ${secondUser}**\n\n💳 **${t(userId, 'debt_created')}:** ${firstUser} owes ${secondUser} (1 turn)\n\n🔄 **${t(userId, 'next_turn')}:** ${secondUser}`;
            sendMessage(chatId, adminMessage);
            
            // Notify all authorized users and admins
            [...authorizedUsers, ...admins].forEach(user => {
                let userChatId = userChatIds.get(user) || userChatIds.get(user.toLowerCase());
                if (userChatId && userChatId !== chatId) {
                    const userMessage = `⚡ **${t(userChatId, 'admin_force_swap_executed')}**\n\n🔄 **${firstUser} ↔ ${secondUser}**\n\n💳 **${t(userChatId, 'debt_created')}:** ${firstUser} owes ${secondUser} (1 turn)\n\n🔄 **${t(userChatId, 'next_turn')}:** ${secondUser}`;
                    console.log(`🔔 Sending force swap notification to ${user} (${userChatId})`);
                    sendMessage(userChatId, userMessage);
                } else {
                    console.log(`🔔 No chat ID found for ${user} or is the admin who performed swap`);
                }
            });
        } else {
            // Not the scheduled user's turn - cannot force swap
            const errorMessage = `❌ **${t(userId, 'swap_error')}**\n\n${t(userId, 'only_scheduled_user_can_swap')}\n\n${t(userId, 'current_turn_user')} ${queue[currentTurn]}`;
            sendMessage(chatId, errorMessage);
        }
        
    } else if (data === 'request_punishment_menu') {
        const isAuthorized = authorizedUsers.has(userName) || authorizedUsers.has(userName.toLowerCase());
        if (!isAuthorized) {
            sendMessage(chatId, t(userId, 'not_authorized_punishment'));
            return;
        }
        
        const currentUserQueueName = userQueueMapping.get(userName) || userQueueMapping.get(userName.toLowerCase());
        const availableUsers = queue.filter(name => name !== currentUserQueueName);
        
        if (availableUsers.length === 0) {
            sendMessage(chatId, t(userId, 'no_users_available_report'));
            return;
        }
        
        const buttons = availableUsers.map(name => [{ text: addRoyalEmoji(name), callback_data: `punishment_target_${name}` }]);
        
        sendMessageWithButtons(chatId, 
            t(userId, 'request_punishment_select_user'), 
            buttons
        );
        
    } else if (data.startsWith('punishment_target_')) {
        const targetUser = data.replace('punishment_target_', '');
        
        // Show reason selection buttons
        const reasonButtons = [
            [
                { text: t(userId, 'reason_behavior'), callback_data: `punishment_reason_${targetUser}_Behavior` },
                { text: t(userId, 'reason_household'), callback_data: `punishment_reason_${targetUser}_Household Rules` }
            ],
            [
                { text: t(userId, 'reason_respect'), callback_data: `punishment_reason_${targetUser}_Respect` },
                { text: t(userId, 'reason_other'), callback_data: `punishment_reason_${targetUser}_Other` }
            ]
        ];
        
        sendMessageWithButtons(chatId, t(userId, 'request_punishment_select_reason', {user: targetUser}), reasonButtons);
        
    } else if (data.startsWith('punishment_reason_')) {
        const parts = data.replace('punishment_reason_', '').split('_');
        const targetUser = parts[0];
        const reason = parts[1];
        
        // Create punishment request (similar to swap request system)
        const requestId = ++punishmentRequestCounter;
        
        pendingPunishments.set(requestId, {
            fromUser: userName,
            targetUser: targetUser,
            reason: reason,
            fromUserId: userId,
            timestamp: Date.now()
        });
        
        // Notify all admins with approval/rejection buttons in their language
        // Send to all admins with localized message and buttons
        for (const adminChatId of adminChatIds) {
            if (adminChatId !== chatId) { // Don't notify the requester
                // Create message in admin's language
                const adminMessage = `${t(adminChatId, 'punishment_request_title')}\n\n${t(adminChatId, 'from_user')}: ${userName}\n${t(adminChatId, 'target_user')}: ${targetUser}\n${t(adminChatId, 'reason')}: ${reason}`;
                const buttons = createLocalizedButtons(adminChatId, [
                    [
                        { translationKey: 'approve', callback_data: `punishment_approve_${requestId}` },
                        { translationKey: 'reject', callback_data: `punishment_reject_${requestId}` }
                    ]
                ]);
                console.log(`🔔 Sending admin punishment notification to chat ID: ${adminChatId}`);
                sendMessageWithButtons(adminChatId, adminMessage, buttons);
            }
        }
        
        sendMessage(chatId, `${t(userId, 'punishment_request_submitted')}\n\n${t(userId, 'target_user')} ${targetUser}\n${t(userId, 'reason')} ${reason}\n${t(userId, 'requested_by', {user: userName})}\n\n${t(userId, 'admins_notified')}`);
        
    } else if (data.startsWith('punishment_approve_')) {
        const requestId = parseInt(data.replace('punishment_approve_', ''));
        const punishmentRequest = pendingPunishments.get(requestId);
        
        if (!punishmentRequest) {
            sendMessage(chatId, t(userId, 'punishment_request_expired'));
            return;
        }
        
        // Check if this is an admin
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        // Apply punishment
        applyPunishment(punishmentRequest.targetUser, punishmentRequest.reason, userName);
        
        // Send confirmation to admin who approved
        sendMessage(chatId, `${t(userId, 'punishment_approved')}\n\n${t(userId, 'target_user')} ${punishmentRequest.targetUser}\n${t(userId, 'reason')} ${punishmentRequest.reason}\n${t(userId, 'approved_by')} ${userName}\n\n${t(userId, 'extra_turns_applied')}`);
        
        // Notify requester
        sendMessage(punishmentRequest.fromUserId, `${t(punishmentRequest.fromUserId, 'punishment_approved')}\n\n${t(punishmentRequest.fromUserId, 'target_user')} ${punishmentRequest.targetUser}\n${t(punishmentRequest.fromUserId, 'reason')} ${punishmentRequest.reason}\n${t(punishmentRequest.fromUserId, 'approved_by')} ${userName}`);
        
        // Notify all other authorized users and admins about the approval in their language
        
        // Notify all authorized users
        [...authorizedUsers].forEach(user => {
            let userChatId = userChatIds.get(user) || userChatIds.get(user.toLowerCase());
            if (userChatId && userChatId !== chatId && userChatId !== punishmentRequest.fromUserId) {
                // Create approval message in user's language
                const approvalMessage = `${t(userChatId, 'punishment_request_approved')}\n\n${t(userChatId, 'requested_by', {user: punishmentRequest.fromUser})}\n${t(userChatId, 'target_user')} ${punishmentRequest.targetUser}\n${t(userChatId, 'reason')} ${punishmentRequest.reason}\n${t(userChatId, 'approved_by')} ${userName}\n\n${t(userChatId, 'extra_turns_applied')}`;
                console.log(`🔔 Sending punishment approval notification to ${user} (${userChatId})`);
                sendMessage(userChatId, approvalMessage);
            }
        });
        
        // Notify all admins using adminChatIds
        for (const adminChatId of adminChatIds) {
            if (adminChatId !== chatId && adminChatId !== punishmentRequest.fromUserId) {
                // Create approval message in admin's language
                const approvalMessage = `${t(adminChatId, 'punishment_request_approved')}\n\n${t(adminChatId, 'requested_by', {user: punishmentRequest.fromUser})}\n${t(adminChatId, 'target_user')} ${punishmentRequest.targetUser}\n${t(adminChatId, 'reason')} ${punishmentRequest.reason}\n${t(adminChatId, 'approved_by')} ${userName}\n\n${t(adminChatId, 'extra_turns_applied')}`;
                console.log(`🔔 Sending punishment approval notification to admin chat ID: ${adminChatId}`);
                sendMessage(adminChatId, approvalMessage);
            }
        }
        
        // Remove request
        pendingPunishments.delete(requestId);
        
    } else if (data.startsWith('punishment_reject_')) {
        const requestId = parseInt(data.replace('punishment_reject_', ''));
        const punishmentRequest = pendingPunishments.get(requestId);
        
        if (!punishmentRequest) {
            sendMessage(chatId, t(userId, 'punishment_request_expired'));
            return;
        }
        
        // Check if this is an admin
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        // Notify requester
        sendMessage(punishmentRequest.fromUserId, `${t(punishmentRequest.fromUserId, 'punishment_request_rejected')}\n\n${t(punishmentRequest.fromUserId, 'declined_punishment_request', {admin: userName, target: punishmentRequest.targetUser})}`);
        sendMessage(chatId, `${t(userId, 'punishment_request_rejected')}\n\n${t(userId, 'you_declined_punishment', {requester: punishmentRequest.fromUser})}`);
        
        // Notify all other authorized users and admins about the rejection in their language
        
        // Notify all authorized users
        [...authorizedUsers].forEach(user => {
            let userChatId = userChatIds.get(user) || userChatIds.get(user.toLowerCase());
            if (userChatId && userChatId !== chatId && userChatId !== punishmentRequest.fromUserId) {
                // Create rejection message in user's language
                const rejectionMessage = `${t(userChatId, 'punishment_request_rejected')}\n\n${t(userChatId, 'requested_by', {user: punishmentRequest.fromUser})}\n${t(userChatId, 'target_user')} ${punishmentRequest.targetUser}\n${t(userChatId, 'reason')} ${punishmentRequest.reason}\n${t(userChatId, 'rejected_by', {user: userName})}`;
                console.log(`🔔 Sending punishment rejection notification to ${user} (${userChatId})`);
                sendMessage(userChatId, rejectionMessage);
            }
        });
        
        // Notify all admins using adminChatIds
        for (const adminChatId of adminChatIds) {
            if (adminChatId !== chatId && adminChatId !== punishmentRequest.fromUserId) {
                // Create rejection message in admin's language
                const rejectionMessage = `${t(adminChatId, 'punishment_request_rejected')}\n\n${t(adminChatId, 'requested_by', {user: punishmentRequest.fromUser})}\n${t(adminChatId, 'target_user')} ${punishmentRequest.targetUser}\n${t(adminChatId, 'reason')} ${punishmentRequest.reason}\n${t(adminChatId, 'rejected_by', {user: userName})}`;
                console.log(`🔔 Sending punishment rejection notification to admin chat ID: ${adminChatId}`);
                sendMessage(adminChatId, rejectionMessage);
            }
        }
        
        // Remove request
        pendingPunishments.delete(requestId);
        
    } else if (data === 'apply_punishment_menu') {
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        // Get unique users from the queue to avoid duplicate buttons
        const uniqueUsers = [...new Set(queue)];
        const buttons = uniqueUsers.map(name => [{ text: addRoyalEmoji(name), callback_data: `admin_punish_${name}` }]);
        
        sendMessageWithButtons(chatId, 
            t(userId, 'apply_punishment_select_user'), 
            buttons
        );
        
    } else if (data.startsWith('admin_punish_')) {
        const targetUser = data.replace('admin_punish_', '');
        
        // Show reason selection for admin punishment
        const buttons = [
            [
                { text: t(userId, 'reason_behavior'), callback_data: `admin_punishment_reason_${targetUser}_Behavior` },
                { text: t(userId, 'reason_household'), callback_data: `admin_punishment_reason_${targetUser}_Household Rules` }
            ],
            [
                { text: t(userId, 'reason_respect'), callback_data: `admin_punishment_reason_${targetUser}_Respect` },
                { text: t(userId, 'reason_other'), callback_data: `admin_punishment_reason_${targetUser}_Other` }
            ]
        ];
        
        sendMessageWithButtons(chatId, t(userId, 'apply_punishment_select_reason', {user: targetUser}), buttons);
        
    } else if (data.startsWith('admin_punishment_reason_')) {
        const parts = data.replace('admin_punishment_reason_', '').split('_');
        const targetUser = parts[0];
        const reason = parts[1];
        
        // Apply punishment directly with selected reason
        applyPunishment(targetUser, reason, userName);
        sendMessage(chatId, `${t(userId, 'punishment_applied')}\n\n${t(userId, 'target_user')} ${targetUser}\n${t(userId, 'reason')} ${reason}\n${t(userId, 'applied_by')} ${userName}\n\n${t(userId, 'extra_turns_added')}`);
        
        // Notify all authorized users and admins about the admin direct punishment in their language
        
        // Notify all authorized users
        [...authorizedUsers].forEach(user => {
            let userChatId = userChatIds.get(user) || userChatIds.get(user.toLowerCase());
            if (userChatId && userChatId !== chatId) {
                // Create notification message in user's language
                const notificationMessage = `${t(userChatId, 'admin_direct_punishment')}\n\n${t(userChatId, 'target_user')} ${targetUser}\n${t(userChatId, 'reason')} ${reason}\n${t(userChatId, 'applied_by')} ${userName}\n\n${t(userChatId, 'extra_turns_added')}`;
                console.log(`🔔 Sending admin direct punishment notification to ${user} (${userChatId})`);
                sendMessage(userChatId, notificationMessage);
            }
        });
        
        // Notify all admins using adminChatIds
        for (const adminChatId of adminChatIds) {
            if (adminChatId !== chatId) {
                // Create notification message in admin's language
                const notificationMessage = `${t(adminChatId, 'admin_direct_punishment')}\n\n${t(adminChatId, 'target_user')} ${targetUser}\n${t(adminChatId, 'reason')} ${reason}\n${t(adminChatId, 'applied_by')} ${userName}\n\n${t(adminChatId, 'extra_turns_added')}`;
                console.log(`🔔 Sending admin direct punishment notification to admin chat ID: ${adminChatId}`);
                sendMessage(adminChatId, notificationMessage);
            }
        }
        
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
                        
                        // Deduplication: Skip if this update was already processed
                        if (processedUpdates.has(update.update_id)) {
                            console.log(`🔄 Skipping duplicate update ${update.update_id} (instance: ${instanceId})`);
                            return;
                        }
                        
                        // Mark this update as processed
                        processedUpdates.add(update.update_id);
                        
                        // Clean up old processed updates (keep only last 1000)
                        if (processedUpdates.size > 1000) {
                            const oldestUpdates = Array.from(processedUpdates).slice(0, 100);
                            oldestUpdates.forEach(id => processedUpdates.delete(id));
                        }
                        
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
                            
                            // Button click deduplication: prevent rapid multiple clicks on same button
                            const now = Date.now();
                            const lastAction = lastUserAction.get(userId);
                            
                            if (lastAction && lastAction.action === data && (now - lastAction.timestamp) < ACTION_COOLDOWN) {
                                console.log(`🔄 Skipping rapid button click: ${data} by ${userName} (cooldown: ${ACTION_COOLDOWN}ms)`);
                                return;
                            }
                            
                            // Update last action
                            lastUserAction.set(userId, { action: data, timestamp: now });
                            
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

// Note: Time limitations removed - requests stay until manually canceled

// Webhook support for Render deployment
const http = require('http');
const url = require('url');

// Keep-alive mechanism to prevent Render from sleeping
function keepAlive() {
    if (process.env.RENDER_EXTERNAL_HOSTNAME) {
        const keepAliveUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/health`;
        console.log('🔄 Sending keep-alive ping to:', keepAliveUrl);
        
        https.get(keepAliveUrl, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                console.log('✅ Keep-alive ping successful:', data);
            });
        }).on('error', (err) => {
            console.log('❌ Keep-alive ping failed:', err.message);
        });
    } else {
        console.log('🏠 Keep-alive skipped - running locally');
    }
}

// HTTP server for webhook and health check
const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    
    // Health check endpoint
    if (parsedUrl.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'healthy', 
            timestamp: new Date().toISOString(),
            instance: instanceId,
            queue: queue.length,
            currentTurn: currentTurn
        }));
        return;
    }
    
    // Webhook endpoint for Telegram
    if (parsedUrl.pathname === '/webhook' && req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                const update = JSON.parse(body);
                
                // Deduplication: Skip if this update was already processed
                if (processedUpdates.has(update.update_id)) {
                    console.log(`🔄 Skipping duplicate webhook update ${update.update_id} (instance: ${instanceId})`);
                    res.writeHead(200);
                    res.end('OK');
                    return;
                }
                
                // Mark this update as processed
                processedUpdates.add(update.update_id);
                
                // Clean up old processed updates (keep only last 1000)
                if (processedUpdates.size > 1000) {
                    const oldestUpdates = Array.from(processedUpdates).slice(0, 100);
                    oldestUpdates.forEach(id => processedUpdates.delete(id));
                }
                
                // Process the update
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
                    
                    // Button click deduplication: prevent rapid multiple clicks on same button
    const now = Date.now();
                    const lastAction = lastUserAction.get(userId);
                    
                    if (lastAction && lastAction.action === data && (now - lastAction.timestamp) < ACTION_COOLDOWN) {
                        console.log(`🔄 Skipping rapid button click: ${data} by ${userName} (cooldown: ${ACTION_COOLDOWN}ms)`);
                        res.writeHead(200);
                        res.end('OK');
                        return;
                    }
                    
                    // Update last action
                    lastUserAction.set(userId, { action: data, timestamp: now });
                    
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
                
                res.writeHead(200);
                res.end('OK');
                
            } catch (error) {
                console.log('❌ Error processing webhook:', error.message);
                res.writeHead(400);
                res.end('Bad Request');
            }
        });
        
        return;
    }
    
    // Default response
    res.writeHead(404);
    res.end('Not Found');
});

// Start server for Render deployment or if PORT is explicitly set
// Broadcast functions for announcements and messages
function broadcastAnnouncement(announcementText, fromAdmin) {
    const timestamp = new Date().toLocaleString();
    
    // Send to all authorized users and admins
    [...authorizedUsers, ...admins].forEach(user => {
        const userChatId = userChatIds.get(user) || userChatIds.get(user.toLowerCase());
        
        if (userChatId) {
            // Create announcement in recipient's language (interface only)
            const announcement = `📢 **${t(userChatId, 'announcement')}**\n\n` +
                               `${announcementText}\n\n` +  // Content unchanged
                               `👨‍💼 **${t(userChatId, 'from_admin')}:** ${fromAdmin}\n` +
                               `🕐 **${t(userChatId, 'time')}:** ${timestamp}`;
            
            // Add acknowledgment button
            const buttons = [
                [{ text: t(userChatId, 'got_it'), callback_data: 'acknowledge_announcement' }]
            ];
            
            sendMessageWithButtons(userChatId, announcement, buttons);
        }
    });
}

function broadcastMessage(messageText, fromUser, isAnnouncement = false) {
    const timestamp = new Date().toLocaleString();
    
    // Send to all authorized users and admins (except sender)
    [...authorizedUsers, ...admins].forEach(user => {
        if (user === fromUser || user.toLowerCase() === fromUser.toLowerCase()) {
            return; // Don't send to sender
        }
        
        const userChatId = userChatIds.get(user) || userChatIds.get(user.toLowerCase());
        
        if (userChatId) {
            // Create message in recipient's language (interface only)
            const message = `💬 **${t(userChatId, 'message_from')} ${fromUser}**\n\n` +
                           `${messageText}\n\n` +  // Content unchanged
                           `🕐 **${t(userChatId, 'time')}:** ${timestamp}`;
            
            // Add like button
            const buttons = [
                [{ text: t(userChatId, 'like'), callback_data: 'like_message' }]
            ];
            
            sendMessageWithButtons(userChatId, message, buttons);
        }
    });
}

const PORT = process.env.PORT || 3000;
if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    // Always start server on Render
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
        console.log(`🌐 Health check: https://${process.env.RENDER_EXTERNAL_HOSTNAME}/health`);
        console.log(`🔗 Webhook endpoint: https://${process.env.RENDER_EXTERNAL_HOSTNAME}/webhook`);
});
} else {
    console.log(`🏠 Running in LOCAL MODE - No HTTP server, using polling only`);
}

// Set webhook if deploying to Render
if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    const webhookUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/webhook`;
    console.log(`🔗 Setting webhook to: ${webhookUrl}`);
    
    const webhookData = JSON.stringify({
        url: webhookUrl
    });
    
    const webhookOptions = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': webhookData.length
        }
    };
    
    const webhookReq = https.request(`${botUrl}/setWebhook`, webhookOptions, (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
            responseData += chunk;
        });
        res.on('end', () => {
            console.log('🔗 Webhook response:', responseData);
        });
    });
    
    webhookReq.write(webhookData);
    webhookReq.end();
} else {
    // Use polling for local development
console.log('🤖 Simple Telegram Dishwasher Bot is ready!');
console.log('📱 Bot is now listening for commands...');
console.log('🔍 Search for: @aronov_dishwasher_bot');

// Start polling for updates
getUpdates();
}

// Keep-alive mechanism (every 5 minutes) - Render free tier sleeps after 15 minutes of inactivity
if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    console.log('🔄 Starting aggressive keep-alive mechanism (every 5 minutes)');
    
    // Initial keep-alive after 30 seconds to ensure server is ready
    setTimeout(keepAlive, 30 * 1000);
    
    // Then every 5 minutes (more aggressive)
    setInterval(keepAlive, 5 * 60 * 1000); // 5 minutes
}

// Automatic monthly report system
function checkAndSendMonthlyReport() {
    const now = new Date();
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const isLastDayOfMonth = now.getDate() === lastDayOfMonth;
    const isEndOfDay = now.getHours() === 23 && now.getMinutes() >= 55; // Between 23:55-23:59
    
    console.log(`📅 Monthly report check: ${now.toISOString()} - Last day: ${isLastDayOfMonth}, End of day: ${isEndOfDay}`);
    
    if (isLastDayOfMonth && isEndOfDay) {
        console.log('📊 Sending automatic monthly report...');
        const currentMonthKey = getCurrentMonthKey();
        broadcastMonthlyReport(currentMonthKey, true);
    }
}

// Check for monthly reports every hour
setInterval(checkAndSendMonthlyReport, 60 * 60 * 1000); // 1 hour

// Note: Cleanup timer removed - no time limitations on requests
