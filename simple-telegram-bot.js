// Simple Telegram Dishwasher Bot (no external dependencies)
const https = require('https');

// Global HTTPS keep-alive agent for Telegram requests (guarded by env flag)
const ENABLE_KEEP_ALIVE = String(process.env.ENABLE_KEEP_ALIVE || 'true').toLowerCase() === 'true';
const telegramHttpsAgent = ENABLE_KEEP_ALIVE ? new https.Agent({
    keepAlive: true,
    maxSockets: 50,
    keepAliveMsecs: 15000,
    timeout: 15000
}) : undefined;
const fs = require('fs');
const path = require('path');
const SupabaseDatabase = require('./supabase-db.js');

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
    console.error('Error: TELEGRAM_BOT_TOKEN environment variable is required');
    console.error('Please set your bot token: set TELEGRAM_BOT_TOKEN=your_bot_token_here');
    process.exit(1);
}
const botUrl = `https://api.telegram.org/bot${token}`;

// ============================================================================
// SQLITE-BASED PERSISTENCE SYSTEM
// ============================================================================

// Database will be initialized after global variables are declared
let db = null;

// Persistence functions using Supabase
async function saveBotData() {
    try {
        // Save core bot state
        await db.saveBotState('authorizedUsers', Array.from(authorizedUsers));
        await db.saveBotState('admins', Array.from(admins));
        await db.saveBotState('userChatIds', Object.fromEntries(userChatIds));
        await db.saveBotState('adminChatIds', Array.from(adminChatIds));
        await db.saveBotState('adminNameToChatId', Object.fromEntries(adminNameToChatId));
        await db.saveBotState('turnOrder', Array.from(turnOrder));
        await db.saveBotState('currentTurnIndex', currentTurnIndex);
        await db.saveBotState('originalQueue', originalQueue); // CRITICAL: Save originalQueue array
        
        // Save additional state
        await db.saveBotState('suspendedUsers', Object.fromEntries(suspendedUsers));
        await db.saveBotState('turnAssignments', Object.fromEntries(turnAssignments));
        await db.saveBotState('swapTimestamps', global.swapTimestamps || []);
        await db.saveBotState('doneTimestamps', global.doneTimestamps ? Object.fromEntries(global.doneTimestamps) : {});
        await db.saveBotState('gracePeriods', global.gracePeriods ? Object.fromEntries(global.gracePeriods) : {});
        await db.saveBotState('queueStatistics', Object.fromEntries(queueStatistics));
        await db.saveBotState('punishmentTurns', Object.fromEntries(punishmentTurns));
        await db.saveBotState('userLanguage', Object.fromEntries(userLanguage));
        await db.saveBotState('chatIdToUserId', Object.fromEntries(chatIdToUserId));
        
        // Save user scores
        for (const [userName, score] of userScores.entries()) {
            await db.setUserScore(userName, score);
        }
        
        // Save queue mappings
        for (const [userName, queueMember] of userQueueMapping.entries()) {
            await db.setQueueMapping(userName, queueMember);
        }
        
        // Save monthly statistics
        for (const [monthKey, statsData] of monthlyStats.entries()) {
            await db.setMonthlyStats(monthKey, statsData);
        }
        
        // Supabase persistence: True persistence across restarts and deployments!
        console.log(`💾 Bot data saved to Supabase PostgreSQL database`);
        console.log(`💾 Data persists across restarts and deployments`);
        console.log(`💾 Bot data saved to Supabase - ${authorizedUsers.size} authorized users, ${admins.size} admins, ${queueUserMapping.size} queue mappings`);
    } catch (error) {
        console.error('❌ Error saving bot data to Supabase:', error);
    }
}

// ===== BATCH SAVE FUNCTIONS (Phase 1) =====
// These functions will be used in Phase 2 to replace immediate saves

async function savePendingScores() {
    if (pendingScoreChanges.size === 0) return;
    
    try {
        console.log(`📊 Batch saving ${pendingScoreChanges.size} score changes`);
        const startTime = Date.now();
        
        // Save all pending score changes
        for (const [userName, score] of pendingScoreChanges) {
            await db.setUserScore(userName, score);
        }
        
        const duration = Date.now() - startTime;
        console.log(`✅ Batch score save completed in ${duration}ms`);
        
        // Clear pending changes
        pendingScoreChanges.clear();
    } catch (error) {
        console.error('❌ Error in batch score save:', error);
        throw error;
    }
}

async function savePendingMonthlyStats() {
    if (Object.keys(pendingMonthlyStats).length === 0) return;
    
    try {
        console.log(`📊 Batch saving monthly stats for ${Object.keys(pendingMonthlyStats).length} months`);
        const startTime = Date.now();
        
        // Save all pending monthly stats
        for (const [month, stats] of Object.entries(pendingMonthlyStats)) {
            await db.setMonthlyStats(month, stats);
        }
        
        const duration = Date.now() - startTime;
        console.log(`✅ Batch monthly stats save completed in ${duration}ms`);
        
        // Clear pending changes
        Object.keys(pendingMonthlyStats).forEach(key => delete pendingMonthlyStats[key]);
    } catch (error) {
        console.error('❌ Error in batch monthly stats save:', error);
        throw error;
    }
}

async function saveDirtyBotState() {
    if (dirtyKeys.size === 0) return;
    
    try {
        console.log(`📊 Batch saving ${dirtyKeys.size} dirty bot state keys: ${Array.from(dirtyKeys).join(', ')}`);
        const startTime = Date.now();
        
        // Save only the keys that have changed
        for (const key of dirtyKeys) {
            switch (key) {
                case 'authorizedUsers':
                    await db.saveBotState('authorizedUsers', Array.from(authorizedUsers));
                    break;
                case 'admins':
                    await db.saveBotState('admins', Array.from(admins));
                    break;
                case 'userChatIds':
                    await db.saveBotState('userChatIds', Object.fromEntries(userChatIds));
                    break;
                case 'adminChatIds':
                    await db.saveBotState('adminChatIds', Array.from(adminChatIds));
                    break;
                case 'adminNameToChatId':
                    await db.saveBotState('adminNameToChatId', Object.fromEntries(adminNameToChatId));
                    break;
                case 'turnOrder':
                    await db.saveBotState('turnOrder', Array.from(turnOrder));
                    break;
                case 'currentTurnIndex':
                    await db.saveBotState('currentTurnIndex', currentTurnIndex);
                    break;
                case 'originalQueue':
                    await db.saveBotState('originalQueue', originalQueue);
                    break;
                case 'suspendedUsers':
                    await db.saveBotState('suspendedUsers', Object.fromEntries(suspendedUsers));
                    break;
                case 'turnAssignments':
                    await db.saveBotState('turnAssignments', Object.fromEntries(turnAssignments));
                    break;
                case 'swapTimestamps':
                    await db.saveBotState('swapTimestamps', Object.fromEntries(swapTimestamps));
                    break;
                case 'doneTimestamps':
                    await db.saveBotState('doneTimestamps', Object.fromEntries(doneTimestamps));
                    break;
                case 'gracePeriods':
                    await db.saveBotState('gracePeriods', Object.fromEntries(gracePeriods));
                    break;
                case 'queueStatistics':
                    await db.saveBotState('queueStatistics', Object.fromEntries(queueStatistics));
                    break;
                case 'punishmentTurns':
                    await db.saveBotState('punishmentTurns', Object.fromEntries(punishmentTurns));
                    break;
                case 'userLanguage':
                    await db.saveBotState('userLanguage', Object.fromEntries(userLanguage));
                    break;
                case 'chatIdToUserId':
                    await db.saveBotState('chatIdToUserId', Object.fromEntries(chatIdToUserId));
                    break;
            }
        }
        
        const duration = Date.now() - startTime;
        console.log(`✅ Batch bot state save completed in ${duration}ms`);
        
        // Clear dirty keys
        dirtyKeys.clear();
    } catch (error) {
        console.error('❌ Error in batch bot state save:', error);
        throw error;
    }
}

function clearPendingChanges() {
    dirtyKeys.clear();
    pendingScoreChanges.clear();
    Object.keys(pendingMonthlyStats).forEach(key => delete pendingMonthlyStats[key]);
    isDirty = false;
    console.log('🧹 Cleared all pending changes');
}

// PHASE 3: Non-blocking save for critical operations
async function saveCriticalData() {
    if (!isDirty) return;
    
    // Use setImmediate to make save non-blocking
    setImmediate(async () => {
        try {
            console.log('🚀 Non-blocking critical save started');
            const startTime = Date.now();
            
            await Promise.all([
                savePendingScores(),
                savePendingMonthlyStats(),
                saveDirtyBotState()
            ]);
            
            const duration = Date.now() - startTime;
            console.log(`✅ Non-blocking critical save completed in ${duration}ms`);
            clearPendingChanges();
            
        } catch (error) {
            console.error('❌ Error in non-blocking critical save:', error);
        }
    });
}

// Supabase persistence - no complex backup functions needed

async function loadBotData() {
    try {
        // Load core bot state
        const authorizedUsersData = await db.getBotState('authorizedUsers') || [];
        const adminsData = await db.getBotState('admins') || [];
        const userChatIdsData = await db.getBotState('userChatIds') || {};
        const adminChatIdsData = await db.getBotState('adminChatIds') || [];
        const turnOrderData = await db.getBotState('turnOrder') || [];
        const currentTurnIndexData = await db.getBotState('currentTurnIndex') || 0;
        const originalQueueData = await db.getBotState('originalQueue') || ['Eden', 'Adele', 'Emma']; // Default fallback
        
        // Load additional state
        const suspendedUsersData = await db.getBotState('suspendedUsers') || {};
        const turnAssignmentsData = await db.getBotState('turnAssignments') || {};
        const swapTimestampsData = await db.getBotState('swapTimestamps') || [];
        const doneTimestampsData = await db.getBotState('doneTimestamps') || {};
        const gracePeriodsData = await db.getBotState('gracePeriods') || {};
        const queueStatisticsData = await db.getBotState('queueStatistics') || {};
        const punishmentTurnsData = await db.getBotState('punishmentTurns') || {};
        const userLanguageData = await db.getBotState('userLanguage') || {};
        const chatIdToUserIdData = await db.getBotState('chatIdToUserId') || {};
        
        // Load user scores
        const userScoresData = await db.getAllUserScores();
        
        // Load queue mappings
        const queueMappingsData = await db.getAllQueueMappings();
        
        // Load monthly statistics
        const monthlyStatsData = await db.getAllMonthlyStats();
        
        // Load dishwasher state
        const dishwasherStartedData = await db.getBotState('dishwasherStarted') || false;
        const dishwasherAlertSentData = await db.getBotState('dishwasherAlertSent') || false;
        const dishwasherCompletedData = await db.getBotState('dishwasherCompleted') || false;
        const dishwasherStartedAtData = await db.getBotState('dishwasherStartedAt') || null;
        
        console.log(`📂 Loading bot data from Supabase database`);
        console.log(`📊 Found ${authorizedUsersData.length} authorized users, ${adminsData.length} admins, ${Object.keys(queueMappingsData).length} queue mappings`);
        
        // Restore core bot state
        authorizedUsers.clear();
        authorizedUsersData.forEach(user => authorizedUsers.add(user));
        
        admins.clear();
        adminsData.forEach(admin => admins.add(admin));
        
        userChatIds.clear();
        Object.entries(userChatIdsData).forEach(([key, value]) => {
            userChatIds.set(key, value);
        });
        
        adminChatIds.clear();
        adminChatIdsData.forEach(chatId => adminChatIds.add(chatId));
        
        // Load admin name to chat ID mapping
        const adminNameToChatIdData = await db.getBotState('adminNameToChatId') || {};
        adminNameToChatId.clear();
        Object.entries(adminNameToChatIdData).forEach(([key, value]) => {
            adminNameToChatId.set(key, value);
        });
        
        turnOrder.clear();
        turnOrderData.forEach(user => turnOrder.add(user));
        
        // Restore originalQueue array (CRITICAL FIX!)
        originalQueue.length = 0;
        originalQueue.push(...originalQueueData);
        console.log(`🔄 Restored originalQueue: [${originalQueue.join(', ')}]`);
        
        userScores.clear();
        Object.entries(userScoresData).forEach(([key, value]) => {
            userScores.set(key, value);
        });
        
        currentTurnIndex = currentTurnIndexData;
        
        // Restore queue mappings
        userQueueMapping.clear();
        Object.entries(queueMappingsData).forEach(([key, value]) => {
            userQueueMapping.set(key, value);
        });
        
        // Create reverse mapping
        queueUserMapping.clear();
        Object.entries(queueMappingsData).forEach(([userName, queueMember]) => {
            queueUserMapping.set(queueMember, userName);
        });
        
        // Restore additional state
        suspendedUsers.clear();
        Object.entries(suspendedUsersData).forEach(([key, value]) => {
            suspendedUsers.set(key, value);
        });
        
        turnAssignments.clear();
        Object.entries(turnAssignmentsData).forEach(([key, value]) => {
            turnAssignments.set(key, value);
        });
        
        // Restore global variables
        global.swapTimestamps = swapTimestampsData;
        global.doneTimestamps = new Map(Object.entries(doneTimestampsData));
        global.gracePeriods = new Map(Object.entries(gracePeriodsData));
        
        // Restore queue statistics
        queueStatistics.clear();
        Object.entries(queueStatisticsData).forEach(([key, value]) => {
            queueStatistics.set(key, value);
        });
        
        // Restore punishment turns
        punishmentTurns.clear();
        Object.entries(punishmentTurnsData).forEach(([key, value]) => {
            punishmentTurns.set(key, value);
        });
        
        // Restore user language preferences
        userLanguage.clear();
        Object.entries(userLanguageData).forEach(([key, value]) => {
            userLanguage.set(key, value);
        });
        
        // Restore chat ID to user ID mapping
        chatIdToUserId.clear();
        Object.entries(chatIdToUserIdData).forEach(([key, value]) => {
            chatIdToUserId.set(key, value);
        });
        
        // Restore monthly statistics
        monthlyStats.clear();
        Object.entries(monthlyStatsData).forEach(([key, value]) => {
            monthlyStats.set(key, value);
        });
        
        // Restore dishwasher state
        global.dishwasherStarted = dishwasherStartedData;
        global.dishwasherAlertSent = dishwasherAlertSentData;
        global.dishwasherCompleted = dishwasherCompletedData;
        global.dishwasherStartedAt = dishwasherStartedAtData;
        
        console.log('📂 Bot data loaded successfully from Supabase');
        console.log(`👥 Users: ${authorizedUsers.size}, Admins: ${admins.size}, Queue Mappings: ${queueUserMapping.size}, Turn Index: ${currentTurnIndex}`);
        
        // Initialize default scores for new users only (persistent scores)
        const defaultUsers = ['Eden', 'Adele', 'Emma'];
        let initializedScores = 0;
        
        for (const user of defaultUsers) {
            if (!userScores.has(user)) {
                userScores.set(user, 0);
                await db.setUserScore(user, 0);
                initializedScores++;
            }
        }
        
        if (initializedScores > 0) {
            console.log(`🎯 Initialized ${initializedScores} new user scores to 0 (persistent scores maintained)`);
        } else {
            console.log(`📊 All user scores loaded from database (persistent scores maintained)`);
        }
        
        return true;
    } catch (error) {
        console.error('❌ Error loading bot data from Supabase:', error);
        return false;
    }
}

// Restore dishwasher timer on startup if needed
async function restoreDishwasherTimer() {
    try {
        // Check if dishwasher was started and timer should still be active
        if (global.dishwasherStarted && !global.dishwasherCompleted && !global.dishwasherAlertSent && global.dishwasherStartedAt) {
            const now = Date.now();
            const elapsed = now - global.dishwasherStartedAt;
            const threeHours = 3 * 60 * 60 * 1000; // 3 hours in milliseconds
            
            // Check if 3 hours have already passed
            if (elapsed >= threeHours) {
                // Timer should have already fired - send alert immediately
                console.log(`⏰ Restoring dishwasher timer: 3 hours already passed, sending alert immediately`);
                
                const currentTurnUser = getCurrentTurnUser();
                if (currentTurnUser) {
                    // Send dishwasher alert to all authorized users and admins
                    [...authorizedUsers, ...admins].forEach(user => {
                        let userChatId = userChatIds.get(user) || (user ? userChatIds.get(user.toLowerCase()) : null);
                        
                        if (!userChatId && isUserAdmin(user)) {
                            userChatId = adminNameToChatId.get(user) || (user ? adminNameToChatId.get(user.toLowerCase()) : null);
                        }
                        
                        if (userChatId) {
                            const recipientUserId = getUserIdFromChatId(userChatId);
                            const alertMessage = t(recipientUserId, 'dishwasher_alert_message', {
                                user: translateName(currentTurnUser, recipientUserId), 
                                sender: t(recipientUserId, 'auto_timer')
                            });
                            console.log(`🔔 Sending restored auto dishwasher alert to ${user} (${userChatId})`);
                            sendMessage(userChatId, alertMessage);
                        }
                    });
                    
                    // Mark alert as sent
                    global.dishwasherAlertSent = true;
                    await db.saveBotState('dishwasherAlertSent', true);
                }
            } else {
                // Timer hasn't fired yet - reschedule it
                const remainingTime = threeHours - elapsed;
                console.log(`⏰ Restoring dishwasher timer: ${Math.round(remainingTime / 1000 / 60)} minutes remaining`);
                
                // Reschedule the timer with remaining time
                const autoAlertTimeout = setTimeout(async () => {
                    // Check if we should still send the auto-alert
                    if (global.dishwasherStarted && !global.dishwasherAlertSent && !global.dishwasherCompleted) {
                        const currentTurnUser = getCurrentTurnUser();
                        
                        // Check Israeli time for night hours restriction (11pm-7am)
                        const now = new Date();
                        const israeliHour = parseInt(now.toLocaleString('en-US', {timeZone: 'Asia/Jerusalem', hour: 'numeric', hour12: false}));
                        const israeliMinute = parseInt(now.toLocaleString('en-US', {timeZone: 'Asia/Jerusalem', minute: 'numeric'}));
                        const israeliTime = israeliHour + (israeliMinute / 60);
                        
                        // Check if it's night hours (11pm-7am Israeli time)
                        if (israeliTime >= 23 || israeliTime < 7) {
                            // Night hours - reschedule for 7:15 AM Israeli time
                            const israeliNow = new Date(now.toLocaleString('en-US', {timeZone: 'Asia/Jerusalem'}));
                            const next7AM = new Date(israeliNow);
                            next7AM.setHours(7, 15, 0, 0);
                            
                            if (next7AM <= israeliNow) {
                                next7AM.setDate(next7AM.getDate() + 1);
                            }
                            
                            const timeUntil7AM = next7AM.getTime() - israeliNow.getTime();
                            
                            const rescheduledTimeout = setTimeout(async () => {
                                if (global.dishwasherStarted && !global.dishwasherAlertSent && !global.dishwasherCompleted) {
                                    const currentTurnUserAtAlert = getCurrentTurnUser();
                                    console.log(`⏰ Auto-alert triggered after night hours delay for ${currentTurnUserAtAlert}`);
                                    
                                    [...authorizedUsers, ...admins].forEach(user => {
                                        let userChatId = userChatIds.get(user) || (user ? userChatIds.get(user.toLowerCase()) : null);
                                        
                                        if (!userChatId && isUserAdmin(user)) {
                                            userChatId = adminNameToChatId.get(user) || (user ? adminNameToChatId.get(user.toLowerCase()) : null);
                                        }
                                        
                                        if (userChatId) {
                                            const recipientUserId = getUserIdFromChatId(userChatId);
                                            const alertMessage = t(recipientUserId, 'dishwasher_alert_message', {
                                                user: translateName(currentTurnUserAtAlert, recipientUserId), 
                                                sender: t(recipientUserId, 'auto_timer')
                                            });
                                            sendMessage(userChatId, alertMessage);
                                        }
                                    });
                                    
                                    global.dishwasherAlertSent = true;
                                    await db.saveBotState('dishwasherAlertSent', true);
                                }
                            }, timeUntil7AM);
                            
                            global.dishwasherAutoAlertTimer = rescheduledTimeout;
                            return;
                        }
                        
                        // Day hours - send immediately
                        console.log(`⏰ Auto-alert triggered after 3 hours for ${currentTurnUser}`);
                        
                        [...authorizedUsers, ...admins].forEach(user => {
                            let userChatId = userChatIds.get(user) || (user ? userChatIds.get(user.toLowerCase()) : null);
                            
                            if (!userChatId && isUserAdmin(user)) {
                                userChatId = adminNameToChatId.get(user) || (user ? adminNameToChatId.get(user.toLowerCase()) : null);
                            }
                            
                            if (userChatId) {
                                const recipientUserId = getUserIdFromChatId(userChatId);
                                const alertMessage = t(recipientUserId, 'dishwasher_alert_message', {
                                    user: translateName(currentTurnUser, recipientUserId), 
                                    sender: t(recipientUserId, 'auto_timer')
                                });
                                sendMessage(userChatId, alertMessage);
                            }
                        });
                        
                        global.dishwasherAlertSent = true;
                        await db.saveBotState('dishwasherAlertSent', true);
                    }
                }, remainingTime);
                
                global.dishwasherAutoAlertTimer = autoAlertTimeout;
            }
        } else {
            console.log('📊 No dishwasher timer to restore');
        }
    } catch (error) {
        console.error('❌ Error restoring dishwasher timer:', error);
    }
}

// Auto-save every 10 minutes (optimized from 5 minutes)
setInterval(async () => {
    const saveStartTime = Date.now();
    const pendingChangesCount = dirtyKeys.size + pendingScoreChanges.size + Object.keys(pendingMonthlyStats).length;
    
    console.log(`💾 Starting optimized auto-save cycle - ${pendingChangesCount} pending changes tracked`);
    console.log(`📊 Pending: ${dirtyKeys.size} dirty keys, ${pendingScoreChanges.size} score changes, ${Object.keys(pendingMonthlyStats).length} monthly stats`);
    
    // PHASE 3: Use batch saves instead of full saveBotData
    try {
        // Save pending changes in parallel for better performance
        await Promise.all([
            savePendingScores(),
            savePendingMonthlyStats(),
            saveDirtyBotState()
        ]);
        
        const saveDuration = Date.now() - saveStartTime;
        console.log(`✅ Optimized auto-save cycle completed in ${saveDuration}ms`);
        
        // Clear pending changes after successful save
        clearPendingChanges();
        
    } catch (error) {
        console.error('❌ Error in optimized auto-save cycle:', error);
        // Fallback to full save if batch save fails
        console.log('🔄 Falling back to full save...');
        await saveBotData();
        clearPendingChanges();
    }
}, 10 * 60 * 1000); // 10 minutes instead of 5

console.log('💾 File-based persistence system initialized');

// Score-based queue management
const originalQueue = ['Eden', 'Adele', 'Emma']; // Original order for tie-breaking
const userScores = new Map(); // userName -> score (number of turns performed)
const queue = ['Eden', 'Adele', 'Emma']; // Keep for compatibility, but order doesn't matter for turn selection
const turnAssignments = new Map(); // userName -> assignedTo (for force swaps)

// Initialize scores to 0 for all users
originalQueue.forEach(user => {
    if (!userScores.has(user)) {
        userScores.set(user, 0);
    }
});

// Score-based turn selection functions
function getCurrentTurnUser(checkAssignments = true) {
    // Find user with lowest score, using original queue order as tie-breaker
    let lowestScore = Infinity;
    let currentUser = null;
    
    // Only consider authorized users (CRITICAL FIX!)
    for (const user of authorizedUsers) {
        // Skip suspended users
        if (suspendedUsers.has(user)) {
            continue;
        }
        
        const score = userScores.get(user) || 0;
        if (score < lowestScore) {
            lowestScore = score;
            currentUser = user;
        } else if (score === lowestScore && currentUser) {
            // Tie-breaker: use originalQueue order
            const userIndex = originalQueue ? originalQueue.indexOf(user) : -1;
            const currentUserIndex = originalQueue ? originalQueue.indexOf(currentUser) : -1;
            
            if (userIndex !== -1 && currentUserIndex !== -1 && userIndex < currentUserIndex) {
                currentUser = user; // User comes first in tie-breaker order
            }
        }
    }
    
    // Only check assignments if requested (for current turn)
    if (checkAssignments) {
        // Follow assignment chain recursively
        let finalUser = currentUser;
        const visited = new Set(); // Prevent infinite loops
        const chain = [finalUser]; // Track the chain for circular detection
        
        while (turnAssignments.has(finalUser)) {
            if (visited.has(finalUser)) {
                // Circular assignment detected - break the loop and clear it
                console.log(`⚠️ Circular assignment detected for ${finalUser} - chain: ${chain.join(' -> ')}`);
                // Clear the last assignment in the chain that created the circle
                if (chain.length >= 2) {
                    const userToClear = chain[chain.length - 2]; // The user whose assignment creates the circle
                    const assignedTo = chain[chain.length - 1]; // Who they're assigned to (the duplicate)
                    console.log(`🔄 Auto-fixing circular assignment by clearing: ${userToClear} -> ${assignedTo}`);
                    turnAssignments.delete(userToClear); // Clear the assignment that created the circle
                    dirtyKeys.add('turnAssignments');
                    isDirty = true;
                }
                // Return the last user before the circle
                return chain.length >= 2 ? chain[chain.length - 2] : currentUser;
            }
            visited.add(finalUser);
            finalUser = turnAssignments.get(finalUser);
            chain.push(finalUser);
        }
        
        return finalUser; // Return the final assigned user in the chain
    }
    
    return currentUser;
}

// Get the original turn holder (without checking assignments)
function getOriginalTurnHolder() {
    // Same logic as getCurrentTurnUser but without checking assignments
    let lowestScore = Infinity;
    let currentUser = null;
    
    for (const user of authorizedUsers) {
        // Skip suspended users
        if (suspendedUsers.has(user)) {
            continue;
        }
        
        const score = userScores.get(user) || 0;
        if (score < lowestScore) {
            lowestScore = score;
            currentUser = user;
        } else if (score === lowestScore && currentUser) {
            // Tie-breaker: use originalQueue order
            const userIndex = originalQueue ? originalQueue.indexOf(user) : -1;
            const currentUserIndex = originalQueue ? originalQueue.indexOf(currentUser) : -1;
            
            if (userIndex !== -1 && currentUserIndex !== -1 && userIndex < currentUserIndex) {
                currentUser = user; // User comes first in tie-breaker order
            }
        }
    }
    
    return currentUser;
}

function getNextThreeTurns() {
    // Simulate next 3 turns by temporarily adjusting scores
    const tempScores = new Map(userScores);
    const tempAssignments = new Map(turnAssignments);
    const turns = [];
    
    for (let i = 0; i < 3; i++) {
        // Find user with lowest score, using originalQueue as tie-breaker
        let lowestScore = Infinity;
        let nextUser = null;
        
        // Only consider authorized users (CRITICAL FIX!)
        for (const user of authorizedUsers) {
            // Skip suspended users
            if (suspendedUsers.has(user)) {
                continue;
            }
            
            const score = tempScores.get(user) || 0;
            if (score < lowestScore) {
                lowestScore = score;
                nextUser = user;
            } else if (score === lowestScore && nextUser) {
                // Tie-breaker: use originalQueue order
                const userIndex = originalQueue ? originalQueue.indexOf(user) : -1;
                const nextUserIndex = originalQueue ? originalQueue.indexOf(nextUser) : -1;
                
                if (userIndex !== -1 && nextUserIndex !== -1 && userIndex < nextUserIndex) {
                    nextUser = user; // User comes first in tie-breaker order
                }
            }
        }
        
        if (nextUser) {
            // Follow assignment chain recursively to find the final performing user
            let finalUser = nextUser;
            const visited = new Set(); // Prevent infinite loops
            
            while (tempAssignments.has(finalUser)) {
                if (visited.has(finalUser)) {
                    // Circular assignment detected - break the loop
                    console.log(`⚠️ Circular assignment detected in getNextThreeTurns for ${finalUser}`);
                    break;
                }
                visited.add(finalUser);
                finalUser = tempAssignments.get(finalUser);
            }
            
            turns.push(finalUser); // Show the final assigned user in the chain
            // Clear the assignment after using it (clear from original holder)
            tempAssignments.delete(nextUser);
            
            // Increment the original user's score for next iteration
            tempScores.set(nextUser, (tempScores.get(nextUser) || 0) + 1);
        }
    }
    
    return turns;
}

async function incrementUserScore(userName) {
    const currentScore = userScores.get(userName) || 0;
    const newScore = currentScore + 1;
    userScores.set(userName, newScore);
    console.log(`📊 ${userName} score incremented: ${currentScore} → ${newScore}`);
    
    // PHASE 3: Track change for batch saving (immediate save removed for performance)
    pendingScoreChanges.set(userName, newScore);
    isDirty = true;
    
    // Check if normalization is needed (when scores get too high)
    normalizeScoresIfNeeded();
}

function normalizeScoresIfNeeded() {
    const scores = Array.from(userScores.values());
    const maxScore = Math.max(...scores);
    
    // Normalize when any score reaches 100 or higher
    if (maxScore >= 100) {
        const minScore = Math.min(...scores);
        
        // Subtract the minimum score from all users
        for (const [user, score] of userScores.entries()) {
            userScores.set(user, score - minScore);
        }
        
        console.log(`🔄 Scores normalized: subtracted ${minScore} from all users`);
    }
}

function applyPunishment(userName) {
    // Punishment = subtract 3 from score (makes them scheduled sooner)
    const currentScore = userScores.get(userName) || 0;
    userScores.set(userName, currentScore - 3);
    console.log(`⚖️ Punishment applied to ${userName}: ${currentScore} → ${currentScore - 3}`);
}

function getRelativeScores() {
    // Calculate relative scores (score - minimum score) for authorized users only
    const authorizedScores = [];
    for (const user of authorizedUsers) {
        const score = userScores.get(user) || 0;
        authorizedScores.push(score);
    }
    
    if (authorizedScores.length === 0) {
        return new Map();
    }
    
    const minScore = Math.min(...authorizedScores);
    
    const relativeScores = new Map();
    for (const user of authorizedUsers) {
        const score = userScores.get(user) || 0;
        relativeScores.set(user, score - minScore);
    }
    
    return relativeScores;
}

// User management
const admins = new Set(); // Set of admin user IDs
const adminChatIds = new Set(); // Set of admin chat IDs
const adminNameToChatId = new Map(); // Map: Admin name -> Chat ID for notifications
const authorizedUsers = new Set(); // Set of authorized user IDs (max 3)
const turnOrder = new Set(); // Set of users in turn order
const userChatIds = new Map(); // Map: userName -> chatId for notifications
let currentTurnIndex = 0; // Current turn index for queue management

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

// Check if running on Render
const isRender = process.env.RENDER === 'true' || process.env.RENDER_EXTERNAL_HOSTNAME;

// ===== INCREMENTAL SAVE SYSTEM (Phase 1) =====
// Change tracking for incremental saves
const dirtyKeys = new Set(); // Track which bot state keys have changed
const pendingScoreChanges = new Map(); // Accumulate user score changes
const pendingMonthlyStats = {}; // Accumulate monthly statistics
let isDirty = false; // Quick flag for any changes
let lastSaveTime = Date.now(); // Track save timing

// Initialize Supabase database after global variables are declared
db = new SupabaseDatabase();
console.log('📊 Supabase database initialized for persistence');

// Wait for database to be ready before proceeding (Supabase style)
let dbReady = false;

// Supabase doesn't use the same connection pattern as SQLite
// Initialize immediately
(async () => {
    try {
        console.log('✅ Supabase database connection established');
        console.log('📊 Using Supabase PostgreSQL for true persistence');
        console.log('📊 Data persists across restarts and deployments');
        
        // Load bot data from Supabase database (true persistence!)
        await loadBotData();
        
        dbReady = true;
        
        // Restore dishwasher timer if needed
        await restoreDishwasherTimer();
        
        console.log('🎯 Bot initialization complete - ready to receive commands');
    } catch (error) {
        console.error('❌ Error during bot initialization:', error);
        console.log('🔄 Bot will continue with empty state');
        dbReady = true;
    }
})();
const originalQueueOrder = ['Eden', 'Adele', 'Emma']; // Default queue order for reset

// Monthly report tracking
const monthlyStats = new Map(); // month-year -> { users: {}, admins: {}, totals: {} }

// Helper function to get current month key
function getCurrentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Helper function for case-insensitive authorization checking with Hebrew support
function isUserAuthorized(userName) {
    // First normalize the input name to first name only
    const normalizedName = getFirstName(userName);
    
    // Safety check for normalizedName
    if (!normalizedName) return false;
    
    // Check if user is authorized (case-insensitive)
    for (const authorizedUser of authorizedUsers) {
        if (authorizedUser && normalizedName && authorizedUser.toLowerCase() === normalizedName.toLowerCase()) {
            return true;
        }
    }
    
    // Also check if the normalized name matches any Hebrew names
    for (const [englishName, hebrewName] of Object.entries(hebrewNames)) {
        if (normalizedName === hebrewName) {
            // Check if the corresponding English name is authorized
            for (const authorizedUser of authorizedUsers) {
                if (authorizedUser && englishName && authorizedUser.toLowerCase() === englishName.toLowerCase()) {
                    return true;
                }
            }
        }
    }
    
    return false;
}

// Helper function for case-insensitive admin checking with Hebrew support
function isUserAdmin(userName, userId = null) {
    // First normalize the input name to first name only
    const normalizedName = getFirstName(userName);
    
    // Safety check for normalizedName
    if (!normalizedName) return false;
    
    // Check if user is admin (case-insensitive)
    for (const admin of admins) {
        if (admin && normalizedName && admin.toLowerCase() === normalizedName.toLowerCase()) {
            return true;
        }
    }
    
    // Also check if the normalized name matches any Hebrew names
    for (const [englishName, hebrewName] of Object.entries(hebrewNames)) {
        if (normalizedName === hebrewName) {
            // Check if the corresponding English name is an admin
            for (const admin of admins) {
                if (admin && englishName && admin.toLowerCase() === englishName.toLowerCase()) {
                    return true;
                }
            }
        }
    }
    
    // Also check by user ID if provided
    if (userId) {
        return admins.has(userId.toString());
    }
    
    return false;
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

// Helper function to suspend user (preserve score, mark as suspended)
function suspendUser(userName, days, reason = null) {
    // Check if user exists in original queue
    if (!originalQueue.includes(userName)) {
        console.log(`⚠️ Cannot suspend ${userName} - not in original queue`);
        return false;
    }
    
    // Store suspension data (preserve current score)
    const currentScore = userScores.get(userName) || 0;
    const suspendUntil = new Date();
    suspendUntil.setDate(suspendUntil.getDate() + days);
    
    suspendedUsers.set(userName, {
        suspendedUntil: suspendUntil,
        reason: reason || `Suspended for ${days} day${days > 1 ? 's' : ''}`,
        originalScore: currentScore // Preserve score
    });
    
    // Track suspension for monthly report
    trackMonthlyAction('suspension', userName, null, days);
    
    console.log(`✈️ ${userName} suspended for ${days} days. Score preserved: ${currentScore}`);
    return true;
}

// Helper function to reactivate user (restore original score)
function reactivateUser(userName) {
    if (!suspendedUsers.has(userName)) {
        console.log(`⚠️ Cannot reactivate ${userName} - not suspended`);
        return false;
    }
    
    const suspension = suspendedUsers.get(userName);
    const originalScore = suspension.originalScore || 0;
    
    // Restore original score
    userScores.set(userName, originalScore);
    
    // Clear suspension
    suspendedUsers.delete(userName);
    
    console.log(`✅ ${userName} reactivated. Score restored: ${originalScore}`);
    return true;
}

// Helper function to advance to next user (no need to skip anyone now)
function advanceToNextUser() {
    // In score-based system, we don't need to advance manually
    // The next user is determined by getCurrentTurnUser()
    return getCurrentTurnUser();
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
        let userChatId = userChatIds.get(user) || (user ? userChatIds.get(user.toLowerCase()) : null);
        if (userChatId && admins.has(user)) {
            adminChatIdsToNotify.add(userChatId);
        }
    });
    
    // Send alert to each unique admin chat ID only once
    adminChatIdsToNotify.forEach(adminChatId => {
        // Get the correct userId for language preference
        const adminUserId = getUserIdFromChatId(adminChatId);
        
        let alertMessage;
        if (reason === 'rapid_done') {
            alertMessage = `${t(adminUserId, 'cheating_detected')}\n\n` +
                `${t(adminUserId, 'rapid_done_alert', {user: translateName(userName, adminUserId), userId: userId, time: timeString, lastDone: details.lastDone})}`;
        } else if (reason === 'rapid_swap') {
            alertMessage = `${t(adminUserId, 'cheating_detected')}\n\n` +
                `${t(adminUserId, 'rapid_swap_alert', {user: translateName(userName, adminUserId), userId: userId, time: timeString, swapCount: details.swapCount})}`;
        }
        
        console.log(`🚨 Sending cheating alert to admin: ${adminChatId} (userId: ${adminUserId})`);
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
    
    // PHASE 2: Track monthly stats changes for future batching
    if (!pendingMonthlyStats[monthKey]) {
        pendingMonthlyStats[monthKey] = JSON.parse(JSON.stringify(monthData)); // Deep copy
    }
    isDirty = true;
    
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
                monthData.admins[adminName] = { completions: 0, punishmentsApplied: 0, forceSwaps: 0, announcements: 0, assists: 0 };
            }
            monthData.admins[adminName].completions++;
            monthData.totals.adminInterventions++;
            break;
        case 'admin_punishment':
            if (!monthData.admins[adminName]) {
                monthData.admins[adminName] = { completions: 0, punishmentsApplied: 0, forceSwaps: 0, announcements: 0, assists: 0 };
            }
            monthData.admins[adminName].punishmentsApplied++;
            break;
        case 'admin_force_swap':
            if (!monthData.admins[adminName]) {
                monthData.admins[adminName] = { completions: 0, punishmentsApplied: 0, forceSwaps: 0, announcements: 0, assists: 0 };
            }
            monthData.admins[adminName].forceSwaps++;
            break;
        case 'admin_announcement':
            if (!monthData.admins[adminName]) {
                monthData.admins[adminName] = { completions: 0, punishmentsApplied: 0, forceSwaps: 0, announcements: 0, assists: 0 };
            }
            monthData.admins[adminName].announcements++;
            break;
        case 'admin_assist':
            if (!monthData.admins[adminName]) {
                monthData.admins[adminName] = { completions: 0, punishmentsApplied: 0, forceSwaps: 0, announcements: 0, assists: 0 };
            }
            monthData.admins[adminName].assists++;
            monthData.totals.adminInterventions++;
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
    
    const [year, month] = monthKey ? monthKey.split('-') : ['', ''];
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
        report += `${addRoyalEmojiTranslated(userName, userId)}:\n`;
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
            report += `  📢 ${t(userId, 'announcements_sent', {count: stats.announcements})}\n`;
            report += `  🤝 ${t(userId, 'assists_provided', {count: stats.assists})}\n\n`;
        });
    }
    
    // Totals
    report += `📈 ${t(userId, 'totals')}:\n`;
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
    
    // Collect all unique chat IDs to avoid duplicates
    const chatIdsToNotify = new Set();
    
    // Add adminChatIds
    adminChatIds.forEach(chatId => chatIdsToNotify.add(chatId));
    
    // Add chat IDs from authorized users
    authorizedUsers.forEach(userName => {
        const chatId = userName ? userChatIds.get(userName.toLowerCase()) : null;
        if (chatId) {
            chatIdsToNotify.add(chatId);
        }
    });
    
    // Send to each unique chat ID only once
    chatIdsToNotify.forEach(chatId => {
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
const chatIdToUserId = new Map(); // Map: chatId -> userId (for notifications)

// Royal emoji mapping for elegant display
const royalEmojis = {
    // Admins (by order of addition)
    'admin_1': '👑', // King - First admin
    'admin_2': '💎', // Queen - Second admin
    // Queue members
    'Eden': '🔱', // Princess 1
    'Adele': '⭐', // Princess 2  
    'Emma': '✨'  // Princess 3
};

// Hebrew name translations
const hebrewNames = {
    'Eden': 'עדן',
    'Adele': 'אדל', 
    'Emma': 'אמה',
    'Dani': 'דני',
    'Marianna': 'מריאנה'
};

// Translation dictionaries
const translations = {
    en: {
        // Menu titles
        'menu_title': 'Dishwasher Bot Menu',
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
        'assist_logged': '✅ **Assist Logged!**\n\n🤝 **Action:** {description}\n👨‍💼 **Admin:** {admin}\n📅 **Time:** {time}\n🔄 **Current turn:** {currentUser}\n\n📊 **Note:** This action does not affect the queue order.',
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
        'rapid_done_alert': '⚠️ **Rapid DONE Activity Detected**\n\n👤 **User:** {user} ({userId})\n⏰ **Time:** {time}\n🕐 **Last Dishwasher Done:** {lastDone}\n\n📊 **Dishwasher cannot be ready in less than 30 minutes!**\n🚨 **ANY user pressing /done or /assist within 30 minutes is suspicious!**',
        'rapid_swap_alert': '⚠️ **Rapid Swap Activity Detected**\n\n👤 **User:** {user} ({userId})\n⏰ **Time:** {time}\n🔄 **Swaps in 10 minutes:** {swapCount}\n\n📊 **Suspicious activity pattern detected!**',
        'swap_request_sent': '✅ **Swap request sent to admins!**',
        'punishment_request_sent': '✅ **Punishment request sent to admins!**',
        'target_user': '🎯 **Target:**',
        'reason': '📝 **Reason:**',
        'waiting_approval': '⏰ **Waiting for admin approval...**',
        'punishment_applied': '✅ **Punishment Applied!**',
        'punishment_applied_alert': '⚡ **PUNISHMENT APPLIED!**',
        'punishment_score_reduced': 'Score reduced by 3 (scheduled sooner)',
        'scheduled_soon': 'scheduled sooner',
        'new_score': '📊 **New score:**',
        'punishment_label': 'Punishment:',
        'applied_by': '👨‍💼 **Applied by:**',
        'reported_by': '👨‍💼 **Reported by:**',
        'punishment_request_action': 'Admin can use "Apply Punishment" button if needed',
        'user_authorized': '✅ **User Authorized!**',
        'total_authorized': '📊 **Total authorized users:**',
        'swap_completed': '✅ **Swap completed!**',
        'next_up': '🎯 Next up:',
        'completed_turn': 'completed their turn!',
        'punishment_remaining': '⚖️ Punishment:',
        'extra_turns_remaining': 'extra turn(s) remaining.',
        
        // More popup messages
        'force_swap_completed': '✅ **Force swap completed!**',
        'admin_force_swap_executed': 'Admin Force Swap Executed',
        'assigned_to_perform': 'assigned to perform',
        'current_turn_label': 'Current turn',
        'turn': 'turn',
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
        'error_not_original_turn_holder': '❌ **Cannot force swap!**\n\n👤 **{firstUser}** is not the original turn holder.\n\n🎯 **Original turn holder:** {originalUser}\n💡 Only the original turn holder can be force swapped.',
        'error_cannot_swap': '❌ **Cannot swap!**\n\n👤 **{userName}** is not the current turn.\n\n🎯 **Current turn:** {currentUser}\n💡 Only the person whose turn it is can request a swap.',
        'error_cannot_force_swap': '❌ **Cannot force swap!**\n\n👤 **{firstUser}** is not the current turn.\n\n🎯 **Current turn:** {currentUser}\n💡 Only the person whose turn it is can be force swapped.',
        'swap_request_expired': '❌ **Swap request expired or invalid!**\n\n🔄 The swap request is no longer valid.',
        'swap_request_expired_requester': '❌ **Swap request expired!**\n\n🔄 The swap request with {toUser} is no longer valid.\n\n🎯 **Current turn:** {currentUser}\n💡 Only the person whose turn it is can be swapped.',
        'swap_request_expired_target': '❌ **Swap request expired!**\n\n🔄 The swap request from {fromUser} is no longer valid.\n\n🎯 **Current turn:** {currentUser}\n💡 The turn has changed since the request was made.',
        'punishment_request_expired': '❌ **Punishment request not found or expired!**',
        'not_your_punishment': '❌ **This punishment request is not yours!**',
        'not_your_swap': '❌ **This swap request is not for you!**',
        
        // Done command messages
        'admin_intervention': '✅ **ADMIN INTERVENTION!**',
        'admin_completed_duty': '👨‍💼 **Admin:** {admin} completed dishwasher duty',
        'helped_user': '👤 **On behalf of:** {user}',
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
        'authorized_and_active_users': '👥 **Authorized and Active Users:**',
        'current_admins_status': '👑 **Current Admins:**',
        'active_status': 'Active',
        'needs_start': 'Needs /start',
        'status_summary': '📊 **Status:**',
        'active_count': 'Active',
        'needs_start_count': 'needs /start',
        'no_authorized_users': '👥 **No authorized users set yet.**\n\nUse `/authorize <user>` to authorize a user.\n\n📋 **Available queue members:**\n• {Eden}\n• {Adele}\n• {Emma}',
        'first_admin_added': '✅ **First Admin Added!**\n\n👨‍💼 {user} is now the first admin.\n\n🔑 **Admin privileges:**\n• Manage queue\n• Authorize users\n• Add/remove admins\n• Force swaps\n• Apply punishments\n\n💡 **Note:** {user} needs to send /start to the bot to receive notifications.',
        'admin_added': '✅ **Admin Added!**\n\n👨‍💼 {user} is now an admin.\n\n🔑 **Admin privileges:**\n• Manage queue\n• Authorize users\n• Add/remove admins\n• Force swaps\n• Apply punishments\n\n💡 **Note:** {user} needs to send /start to the bot to receive notifications.',
        
        // Additional missing messages
        'admin_access_required_simple': '❌ **Admin access required!**\n\n👤 {user} is not an admin.',
        'cannot_add_yourself_admin': '❌ **Cannot add yourself as admin!**\n\n🛡️ **Security protection:** Only other admins can promote you.\n\n💡 **Ask another admin to add you:**\n`/addadmin {user}`',
        'cannot_remove_yourself_admin': '❌ **Cannot remove yourself as admin!**\n\n🛡️ **Security protection:** Only other admins can remove you.\n\n💡 **Ask another admin to remove you:**\n`/removeadmin {user}`',
        'admin_removed': '✅ **Admin Removed!**\n\n👤 {user} is no longer an admin.\n\n🔒 **Admin privileges revoked.**',
        'user_not_found_admin': '❌ **User not found!**\n\n👤 {user} is not an admin.\n\n💡 **Use `/admins` to see current admins.**',
        'admin_access_required_authorize': '❌ **Admin access required!**\n\n👤 {user} is not an admin.\n\n💡 **Only admins can authorize users.**',
        'user_not_in_queue': '❌ **User not in queue!**\n\n👥 **Available queue members:**\n• {Eden}\n• {Adele}\n• {Emma}\n\n💡 **Usage:** `/authorize Eden` or `/authorize Eden`',
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
        'broadcast': '📢 Broadcast',
        'assist': '🤝 Assist',
        'type_announcement_message': 'Type your announcement message:',
        'announcement_preview': 'Preview',
        'announcement': 'Announcement',
        'send_to_all': '📢 Send to All',
        'announcement_sent': 'Announcement sent successfully!',
        
        // Message system (Admin + Users)
        'send_message': '💬 Send Message',
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
        // Queue statistics labels (ensure English keys exist)
        'tie_breaker_priority_order': '📋 Tie-breaker priority order:\n',
        'next_3_turns': '📅 Next 3 turns: ',
        'suspended_users': '✈️ Suspended users:\n',
        'days_left': 'day left',
        'days_left_plural': 'days left',
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
        'active_turn_assignments': '🔄 **Active Turn Assignments:**\n',
        'active_punishments': '⚡ **Active Punishments:**',
        'punishment_turns_remaining': '{turns} punishment turn(s) remaining',
        'no_admins_set': '👨‍💼 **No admins set yet.**\n\nUse `/addadmin <user>` to add an admin.',
        'no_users_to_remove': 'No users in queue to remove.',
        'punishment_debt_preserved': 'Punishment debt preserved: {count} turns',
        'reactivated_with_punishment': '{user} reactivated with {count} punishment turns',
        'remove_user': '❌ Remove User',
        'select_user_to_remove': 'Select user to remove permanently:',
        'user_removed': '❌ {user} removed from queue permanently',
        'permanently_removed': 'Permanently removed',
        
        // Reset Scores
        'reset_scores': '🔄 Reset Scores',
        'reset_all_scores': '🔄 Reset All Scores (All → 0)',
        'reset_individual': '👤 Reset Individual',
        'normalize_scores': '📊 Normalize Scores',
        'reset_system': '🔄 Reset System (All)',
        'confirm_reset_all': '✅ Confirm Reset All',
        'cancel': '❌ Cancel',
        'confirm_reset_all_scores': '⚠️ Confirm Reset All Scores\n\nThis will reset all user scores to 0. Continue?',
        'all_scores_reset': '✅ All Scores Reset!\n\n📊 New Scores:\n{newScores}\n\n🎯 Next turn will be based on original queue order.',
        'select_user_reset_score': 'Select user to reset their score to 0:',
        'confirm_reset_score': '⚠️ Confirm Reset Score\n\n{user} current score: {score}\n\nReset to 0?',
        'score_reset': '✅ Score Reset!\n\n{user}: {oldScore} → 0\n\n🎯 This may affect turn order.',
        'confirm_full_system_reset': '⚠️ Confirm Full System Reset\n\nThis will:\n• Reset all scores to 0\n• Clear all turn assignments\n• Clear all suspensions\n• Reset queue order\n\nThis is irreversible!',
        'reset_everything': '⚠️ Reset Everything',
        'full_system_reset_complete': '✅ Full System Reset Complete!\n\n📊 All scores reset to 0\n🔄 All assignments cleared\n✈️ All suspensions cleared\n📋 Queue order reset to default\n\n🎯 System is now in default state.',
        'normalize_scores_title': '📊 Normalize Scores\n\nCurrent Scores:\n{currentScores}\n\nThis will subtract {minScore} from all scores to keep numbers manageable.\n\nContinue?',
        'normalize_now': '✅ Normalize Now',
        'scores_normalized': '✅ Scores Normalized!\n\n📊 New Scores:\n{newScores}\n\n🎯 Relative positions preserved, numbers reduced.',
        
        // Reorder Queue
        'reorder_tie_breaker_priority': '🔄 **Reorder Tie-Breaker Priority**\n\n📋 **Current Priority Order:**\n{currentOrder}\n\n💡 **This affects who gets priority when scores are tied.**\n\n**Options:**',
        'set_custom_order': '🔄 Set Custom Order',
        'reset_to_default': '🔄 Reset To Default',
        'view_current_order': '📊 View Current Order',
        'select_user_move_priority': 'Select user to move to different priority position:',
        'tie_breaker_order_updated': '✅ **Tie-breaker Order Updated!**\n\n📋 **New Priority Order:**\n{newOrder}\n\n💡 **This affects who gets priority when scores are tied.**',
        'invalid_position_selected': '❌ Invalid position selected.',
        'tie_breaker_order_reset': '✅ **Tie-breaker Order Reset to Default!**\n\n📋 **Default Priority Order:**\n{defaultOrder}',
        'current_tie_breaker_priority_order': '📋 **Current Tie-Breaker Priority Order:**\n\n{currentOrder}\n\n💡 **This affects who gets priority when scores are tied.**',
        
        // Monthly Reports
        'monthly_report': '📊 Monthly Report',
        'share_monthly_report': '📤 Share Monthly Report',
        'monthly_report_title': '📊 Monthly Report - {month} {year}',
        'monthly_report_shared': '✅ **Monthly Report Shared!**\n\n📤 Report sent to all authorized users and admins.\n\n👥 **Recipients:** {count} users',
        'no_data_available': '📊 **No Data Available**\n\n❌ No monthly statistics found for this period.\n\n💡 **This usually means:**\n• Bot was recently started\n• No activity recorded yet\n• Data was reset\n\n📅 **Try again after some activity occurs.**',
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
        'assists_provided': 'Assists provided: {count}',
        'total_dishes_completed': 'Total dishes completed: {count}',
        'admin_interventions': 'Admin interventions: {count}',
        'queue_reorders': 'Queue reorders: {count}',
        'no_statistics_available': 'No statistics available yet. Come back after some activity.',
        'no_statistics_recorded_this_month': 'No statistics recorded yet for this month.',
        'database_issue_work_done': 'Database issue - work was done but not saved',
        'database_updated_turn_completion': '✅ **Database Updated:** Turn completion successfully saved!',
        'database_error_turn_completion': '❌ **Database Error:** Turn completion still not saved. Contact support if issue persists.',
        'database_updated_admin_completion': '✅ **Database Updated:** Admin completion successfully saved!',
        'database_error_admin_completion': '❌ **Database Error:** Admin completion still not saved. Contact support if issue persists.',
        'database_updated_force_swap': '✅ **Database Updated:** Force swap successfully saved!',
        'database_error_force_swap': '❌ **Database Error:** Force swap still not saved. Contact support if issue persists.',
        'totals': 'TOTALS',
        
        // Swap status messages
        'temporary_swaps_active': 'Temporary Swaps Active:',
        'no_active_swaps': 'No active swaps - normal queue order',
        'force_swap_type': 'Force Swap',
        'user_swap_type': 'User Swap',
        'reverts_when_completes': 'reverts when {user} completes their turn',
        'undefined': 'Not in queue',
        
        // Help messages
        'help_title': '🤖 **Family Dishwasher Bot:**\n\n',
        'help_scoring_system': '📊 **Scoring System:**\n',
        'help_scoring_explanation': '• Each user has a score (number of turns completed)\n• Next turn is determined by lowest score\n• In case of tie, uses fixed order ({Eden} → {Adele} → {Emma})\n• System maintains fairness over time\n\n',
        'help_queue_commands': '📋 **Queue Commands:**\n',
        'help_queue_explanation': '• `/status` - Show current queue, scores, and next turns\n• `/done` - Complete your turn (increases score by 1)\n\n',
        'help_swapping': '🔄 **Turn Swapping:**\n',
        'help_swapping_explanation': '• **Swap** - Request to swap your turn with another user\n• **Who can swap:** Only the person whose turn it is (current turn holder or performing user)\n• **Process:** Select user → User gets notification → Must approve or reject\n• **How it works:** The other user performs your turn (you owe them a favor)\n• **Score:** Only the performing user\'s score increases (+1)\n• **Consecutive swaps:** Users performing a turn can swap it to someone else\n• **Swap back:** Can swap back to original turn holder (cancels assignment)\n• **Expiration:** Swap requests expire if turn changes before approval\n• **Cancel:** You can cancel your request anytime\n\n',
        'help_punishment': '⚡ **User Reporting:**\n',
        'help_punishment_explanation': '• **Request Punishment** - Report another user\n• **Process:** Select user → Choose reason → Admins get notification\n• **Punishment:** Admin approves punishment (reduces score by 3)\n\n',
        'help_admin_features': '👨‍💼 **Admin Features:**\n',
        'help_admin_explanation': '• **Force Swap** - Force swap turns (same logic as user swaps, instant)\n• **Apply Punishment** - Apply direct punishment\n• **Assist** - Handle dishwasher without affecting queue (`/assist`)\n• **Suspend/Reactivate** - Suspend and reactivate users\n• **Reset Scores** - Reset scores (all, individual, or normalize)\n• **Reorder Queue** - Change tie-breaker order\n• **Queue Statistics** - Detailed statistics\n• **Monthly Report** - Detailed monthly report\n• **User Management** - Remove users from bot\n• **Data Reset** - Reset all bot data with confirmation\n\n',
        'help_tie_breaker': '🎯 **Tie-breaker Order:** {Eden} → {Adele} → {Emma}\n\n',
        'help_basic_info': '\n💡 **Basic Information:**\n• This bot manages dishwasher turns for authorized users\n• Contact an admin to get authorized for queue commands\n• Use `/start` to begin using the bot\n\n',
        'help_tip': '💡 **Tip:** Use buttons for easier navigation!\n\n🔧 **New Admin Commands:**\n• `/assist` - Handle dishwasher without affecting queue\n• `/removeuser @username` - Remove user from bot\n• `/resetbot` - Reset all bot data\n• `/leave` or `/quit` - Remove yourself from bot\n\n🚨 **Debt Protection:**\n• Users with low scores cannot leave to prevent debt reset\n• 24-hour grace period for legitimate leaves\n• Score preserved during grace period',
        
        // Debt protection messages
        'debt_warning': '🚨 **WARNING: You have {debtAmount} turns to complete before leaving!**\n\n📊 **Your score:** {userScore}\n📊 **Highest score:** {maxScore}\n\n❌ **Cannot leave with outstanding debts**\n\n💡 **Complete your turns or ask an admin to remove you**',
        'leave_confirmation': '⚠️ **Are you sure you want to leave the bot?**\n\n📊 **Your current score:** {userScore}\n\nThis will:\n• Remove you from all queues\n• Start 24-hour grace period\n• You can rejoin within 24 hours with same score\n• After 24 hours, score resets to 0\n\nAre you sure?',
        'admin_leave_confirmation': '⚠️ **Are you sure you want to leave as admin?**\n\n👑 **Admin privileges will be removed**\n\nThis will:\n• Remove your admin privileges\n• Remove you from all queues\n• Start 24-hour grace period\n• You can rejoin within 24 hours\n\nAre you sure?',
        'yes_leave_bot': '✅ Yes, Leave Bot',
        'cancel_leave': '❌ Cancel',
        'leave_cancelled': '❌ Leave cancelled. You remain in the bot.',
        'grace_period_message': '👋 You have been removed from the dishwasher bot.\n\n⏰ **24-hour grace period active until:** {graceEndTime}\n📊 **Your score preserved:** {userScore}\n\n💡 **Rejoin within 24 hours to keep your score, or it will reset to 0**',
        
        // Additional messages
        'reset_warning': '⚠️ **WARNING: This will reset ALL bot data!**\n\nThis includes:\n• All users and admins\n• Turn order\n• Scores\n• Settings\n\nAre you sure?',
        'not_authorized': '❌ You are not currently authorized. Use /start to join the bot.',
        'admin_access_required': '❌ Admin access required for this action',
        'usage_removeuser': '❌ **Usage:** `/removeuser <username>`\n\nExample: `/removeuser Dani`',
        'user_removed_success': '✅ User **{user}** has been removed from the bot',
        'user_not_found': '❌ User **{user}** not found in authorized users',
        'bot_reset_success': '🔄 **Bot data has been completely reset!**\n\nAll users need to reauthorize with /start',
        'reset_cancelled': '❌ Reset cancelled. Bot data remains unchanged.',
        'no_users_to_remove': '❌ No users to remove',
        'no_authorized_users_to_remove': '❌ **No users to remove**\n\n💡 **First authorize users with:**\n`/authorize Eden`\n`/authorize Adele`\n`/authorize Emma`\n\n📋 **Available queue positions:**\n• {Eden}\n• {Adele}\n• {Emma}',
        'user_management_title': '👥 **User Management**\nClick to remove users:',
        'you_removed_from_bot': '👋 You have been removed from the dishwasher bot. Use /start to rejoin anytime.',
        'yes_reset_everything': '✅ Yes, Reset Everything',
        'cancel_reset_button': '❌ Cancel',
        'remove_user_prefix': '❌ Remove',
        'reset_bot_button': '🔄 Reset Bot',
        'leave_bot_button': '👋 Leave Bot',
        'hard_reset_section': '⚠️ HARD RESET',
        'danger_zone_warning': '🚨 **DANGER ZONE** - These actions are irreversible!\n\n• **Remove User** - Remove users from bot\n• **Reset Bot** - Complete bot data reset\n• **Leave Bot** - Remove yourself with grace period\n\n⚠️ **Use with extreme caution!**',
        'back_to_admin_menu': '🔙 Back to Admin Menu',
        'last_admin_cannot_leave': '❌ **Cannot leave - You are the last admin!**\n\n🚨 **Bot management requires at least one admin**\n\n💡 **Options:**\n• Add another admin first\n• Use admin controls to remove yourself\n• Transfer admin privileges to another user',
        
        // Queue Statistics (missing in English)
        'current_scores': '📊 Current Scores:\n',
        
        // Dishwasher confirmation dialog
        'dishwasher_already_running': '⚠️ Dishwasher is already running!\n\nPressing again will:\n• Reset the 3-hour timer\n• Send new notifications to everyone\n• Cancel the current timer\n\nAre you sure you want to reset?',
        'dishwasher_finished_not_done': '⚠️ Dishwasher is already finished but wasn\'t marked done!\n\nPressing again will:\n• Start a new dishwasher cycle\n• Send new notifications to everyone\n\nAre you sure you want to start a new cycle?',
        'yes_reset_timer': 'Yes, Reset Timer',
        'yes_start_new': 'Yes, Start New',
        'cancel': 'Cancel',
        'reset_cancelled': 'Reset cancelled. Dishwasher timer remains unchanged.',
        'error_occurred': '❌ An error occurred. Please try again.',
        'unknown_button_action': '❌ Unknown button action. Please use the main menu.'
    },
    he: {
        // Menu titles
        'menu_title': 'תפריט בוט מדיח הכלים',
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
        'assist_logged': '✅ **עזרה נרשמה!**\n\n🤝 **פעולה:** {description}\n👨‍💼 **מנהל:** {admin}\n📅 **זמן:** {time}\n🔄 **התור הנוכחי:** {currentUser}\n\n📊 **הערה:** פעולה זו לא משפיעה על סדר התור.',
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
        'rapid_done_alert': '⚠️ **פעילות DONE מהירה זוהתה**\n\n👤 **משתמש:** {user} ({userId})\n⏰ **זמן:** {time}\n🕐 **מדיח הכלים האחרון הושלם:** {lastDone}\n\n📊 **מדיח הכלים לא יכול להיות מוכן תוך פחות מ-30 דקות!**\n🚨 **כל משתמש שלוחץ /done או /assist תוך 30 דקות חשוד!**',
        'rapid_swap_alert': '⚠️ **פעילות החלפה מהירה זוהתה**\n\n👤 **משתמש:** {user} ({userId})\n⏰ **זמן:** {time}\n🔄 **החלפות ב-10 דקות:** {swapCount}\n\n📊 **זוהה דפוס פעילות חשוד!**',
        'swap_request_sent': '✅ **בקשת החלפה נשלחה למנהלים!**',
        'punishment_request_sent': '✅ **בקשת עונש נשלחה למנהלים!**',
        'target_user': '🎯 **יעד:**',
        'reason': '📝 **סיבה:**',
        'waiting_approval': '⏰ **ממתין לאישור מנהל...**',
        'punishment_applied': '✅ **עונש הופעל!**',
        'punishment_applied_alert': '⚡ **עונש הופעל!**',
        'punishment_score_reduced': 'ניקוד הופחת ב-3 (מתוזמן מוקדם יותר)',
        'scheduled_soon': 'מתוזמן מוקדם יותר',
        'new_score': '📊 **ניקוד חדש:**',
        'punishment_label': 'עונש:',
        'applied_by': '👨‍💼 **הופעל על ידי:**',
        'reported_by': '👨‍💼 **דווח על ידי:**',
        'punishment_request_action': 'מנהל יכול להשתמש בכפתור "הפעל עונש" במידת הצורך',
        'user_authorized': '✅ **משתמש הורשה!**',
        'total_authorized': '📊 **סך משתמשים מורשים:**',
        'swap_completed': '✅ **החלפה הושלמה!**',
        'next_up': '🎯 הבא בתור:',
        'completed_turn': 'סיים את התור!',
        'punishment_remaining': '⚖️ עונש:',
        'extra_turns_remaining': 'תורות נוספים נותרו.',
        
        // More popup messages
        'force_swap_completed': '✅ **החלפה בכוח הושלמה!**',
        'assigned_to_perform': 'קיבל אישור לבצע את התור של',
        'current_turn_label': 'התור הנוכחי',
        'turn': 'תור',
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
        'error_not_original_turn_holder': '❌ **לא ניתן לבצע החלפה בכוח!**\n\n👤 **{firstUser}** אינו מחזיק התור המקורי.\n\n🎯 **מחזיק התור המקורי:** {originalUser}\n💡 רק מחזיק התור המקורי יכול להיות מוחלף בכוח.',
        'error_cannot_swap': '❌ **לא ניתן להחליף!**\n\n👤 **{userName}** אינו במהלך התור שלו.\n\n🎯 **התור הנוכחי:** {currentUser}\n💡 רק מי שבמהלך התור שלו יכול לבקש החלפה.',
        'error_cannot_force_swap': '❌ **לא ניתן לבצע החלפה בכוח!**\n\n👤 **{firstUser}** אינו במהלך התור שלו.\n\n🎯 **התור הנוכחי:** {currentUser}\n💡 רק מי שבמהלך התור שלו יכול להיות מוחלף בכוח.',
        'swap_request_expired': '❌ **בקשת החלפה פגה תוקפה או לא תקינה!**\n\n🔄 בקשת החלפה כבר לא תקפה.',
        'swap_request_expired_requester': '❌ **בקשת החלפה פגה!**\n\n🔄 בקשת החלפה עם {toUser} כבר לא תקפה.\n\n🎯 **התור הנוכחי:** {currentUser}\n💡 רק מי שבמהלך התור שלו יכול להיות מוחלף.',
        'swap_request_expired_target': '❌ **בקשת החלפה פגה!**\n\n🔄 בקשת החלפה מ-{fromUser} כבר לא תקפה.\n\n🎯 **התור הנוכחי:** {currentUser}\n💡 התור השתנה מאז שהבקשה נעשתה.',
        'punishment_request_expired': '❌ **בקשת עונש לא נמצאה או פגה תוקפה!**',
        'not_your_punishment': '❌ **בקשת עונש זו לא שלך!**',
        'not_your_swap': '❌ **בקשת החלפה זו לא מיועדת לך!**',
        
        // Done command messages
        'admin_intervention': '✅ **התערבות מנהל!**',
        'admin_completed_duty': '👨‍💼 **מנהל:** {admin} השלים את חובת הכלים',
        'helped_user': '👤 **בשם:** {user}',
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
        'authorized_and_active_users': '👥 **משתמשים מורשים ופעילים:**',
        'current_admins_status': '👑 **מנהלים נוכחיים:**',
        'active_status': 'פעיל',
        'needs_start': 'צריך /start',
        'status_summary': '📊 **סטטוס:**',
        'active_count': 'פעיל',
        'needs_start_count': 'צריך /start',
        'no_authorized_users': '👥 **עדיין לא הוגדרו משתמשים מורשים.**\n\nהשתמש ב-`/authorize <user>` כדי להרשות משתמש.\n\n📋 **חברי התור הזמינים:**\n• {Eden}\n• {Adele}\n• {Emma}',
        'first_admin_added': '✅ **מנהל ראשון נוסף!**\n\n👨‍💼 {user} הוא כעת המנהל הראשון.\n\n🔑 **הרשאות מנהל:**\n• ניהול התור\n• הרשאת משתמשים\n• הוספה/הסרה של מנהלים\n• החלפות בכוח\n• הפעלת עונשים\n\n💡 **הערה:** {user} צריך לשלוח /start לבוט כדי לקבל התראות.',
        'admin_added': '✅ **מנהל נוסף!**\n\n👨‍💼 {user} הוא כעת מנהל.\n\n🔑 **הרשאות מנהל:**\n• ניהול התור\n• הרשאת משתמשים\n• הוספה/הסרה של מנהלים\n• החלפות בכוח\n• הפעלת עונשים\n\n💡 **הערה:** {user} צריך לשלוח /start לבוט כדי לקבל התראות.',
        
        // Additional missing messages
        'admin_access_required_simple': '❌ **נדרשת גישת מנהל!**\n\n👤 {user} אינו מנהל.',
        'cannot_add_yourself_admin': '❌ **לא ניתן להוסיף את עצמך כמנהל!**\n\n🛡️ **הגנת אבטחה:** רק מנהלים אחרים יכולים לקדם אותך.\n\n💡 **בקש ממנהל אחר להוסיף אותך:**\n`/addadmin {user}`',
        'cannot_remove_yourself_admin': '❌ **לא ניתן להסיר את עצמך כמנהל!**\n\n🛡️ **הגנת אבטחה:** רק מנהלים אחרים יכולים להסיר אותך.\n\n💡 **בקש ממנהל אחר להסיר אותך:**\n`/removeadmin {user}`',
        'admin_removed': '✅ **מנהל הוסר!**\n\n👤 {user} אינו עוד מנהל.\n\n🔒 **הרשאות מנהל בוטלו.**',
        'user_not_found_admin': '❌ **משתמש לא נמצא!**\n\n👤 {user} אינו מנהל.\n\n💡 **השתמש ב-`/admins` כדי לראות מנהלים נוכחיים.**',
        'admin_access_required_authorize': '❌ **נדרשת גישת מנהל!**\n\n👤 {user} אינו מנהל.\n\n💡 **רק מנהלים יכולים להרשות משתמשים.**',
        'user_not_in_queue': '❌ **משתמש לא בתור!**\n\n👥 **חברי התור הזמינים:**\n• {Eden}\n• {Adele}\n• {Emma}\n\n💡 **שימוש:** `/authorize עדן` או `/authorize עדן`',
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
        'usage_addadmin': '❌ **שימוש:** `/addadmin <שם משתמש>`\n\nדוגמה: `/addadmin דני`',
        'usage_removeadmin': '❌ **שימוש:** `/removeadmin <שם משתמש>`\n\nדוגמה: `/removeadmin דני`',
        'usage_authorize': '❌ **שימוש:** `/authorize <שם משתמש>`\n\nדוגמה: `/authorize עדן`',
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
        'broadcast': '📢 שידור',
        'assist': '🤝 עזרה',
        'type_announcement_message': 'הקלד את ההודעה הרשמית שלך:',
        'announcement_preview': 'תצוגה מקדימה',
        'announcement': 'הודעה רשמית',
        'send_to_all': '📢 שלח לכולם',
        'announcement_sent': 'ההודעה הרשמית נשלחה בהצלחה!',
        
        // Message system (Admin + Users)
        'send_message': '💬 שלח הודעה',
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
        'reset_scores': '🔄 אפס ניקודים',
        
        // Reset Scores
        'reset_all_scores': '🔄 אפס כל הניקודים (הכל → 0)',
        'reset_individual': '👤 אפס יחיד',
        'normalize_scores': '📊 נמל ניקודים',
        'reset_system': '🔄 אפס מערכת (הכל)',
        'confirm_reset_all': '✅ אשר אפס הכל',
        'cancel': '❌ ביטול',
        'confirm_reset_all_scores': '⚠️ אשר אפס כל הניקודים\n\nזה יאפס את כל ניקודי המשתמשים ל-0. להמשיך?',
        'all_scores_reset': '✅ כל הניקודים אופסו!\n\n📊 ניקודים חדשים:\n{newScores}\n\n🎯 התור הבא יהיה לפי סדר הקביעות.',
        'select_user_reset_score': 'בחר משתמש לאפס את הניקוד שלו ל-0:',
        'confirm_reset_score': '⚠️ אשר אפס ניקוד\n\n{user} ניקוד נוכחי: {score}\n\nלאפס ל-0?',
        'score_reset': '✅ ניקוד אופס!\n\n{user}: {oldScore} → 0\n\n🎯 זה עשוי להשפיע על סדר התורות.',
        'confirm_full_system_reset': '⚠️ אשר אפס מערכת מלא\n\nזה יעשה:\n• אפס כל הניקודים ל-0\n• נקה כל הקצאות תורות\n• נקה כל השעיות\n• אפס סדר קביעות\n\nזה בלתי הפיך!',
        'reset_everything': '⚠️ אפס הכל',
        'full_system_reset_complete': '✅ אפס מערכת מלא הושלם!\n\n📊 כל הניקודים אופסו ל-0\n🔄 כל ההקצאות נוקו\n✈️ כל ההשעיות נוקו\n📋 סדר הקביעות אופס לברירת מחדל\n\n🎯 המערכת כעת במצב ברירת מחדל.',
        'normalize_scores_title': '📊 נמל ניקודים\n\nניקוד נוכחי:\n{currentScores}\n\nזה יפחית {minScore} מכל הניקודים כדי לשמור על מספרים ניתנים לניהול.\n\nלהמשיך?',
        'normalize_now': '✅ נמל עכשיו',
        'scores_normalized': '✅ ניקודים נומלו!\n\n📊 ניקודים חדשים:\n{newScores}\n\n🎯 מיקומים יחסיים נשמרו, מספרים הופחתו.',
        
        // Reorder Queue
        'reorder_tie_breaker_priority': '🔄 **סידור עדיפות קביעות מחדש**\n\n📋 **סדר עדיפות נוכחי:**\n{currentOrder}\n\n💡 **זה משפיע על מי מקבל עדיפות כאשר הניקודים שווים.**\n\n**אפשרויות:**',
        'set_custom_order': '🔄 הגדר סדר מותאם אישית',
        'reset_to_default': '🔄 אפס לברירת מחדל',
        'view_current_order': '📊 צפה בסדר נוכחי',
        'select_user_move_priority': 'בחר משתמש להעביר לעמדת עדיפות שונה:',
        'tie_breaker_order_updated': '✅ **סדר קביעות עודכן!**\n\n📋 **סדר עדיפות חדש:**\n{newOrder}\n\n💡 **זה משפיע על מי מקבל עדיפות כאשר הניקודים שווים.**',
        'invalid_position_selected': '❌ עמדה לא חוקית נבחרה.',
        'tie_breaker_order_reset': '✅ **סדר קביעות אופס לברירת מחדל!**\n\n📋 **סדר עדיפות ברירת מחדל:**\n{defaultOrder}',
        'current_tie_breaker_priority_order': '📋 **סדר עדיפות קביעות נוכחי:**\n\n{currentOrder}\n\n💡 **זה משפיע על מי מקבל עדיפות כאשר הניקודים שווים.**',
        
        // Queue Statistics
        'queue_statistics_title': '📊 **סטטיסטיקות תור**\n\n',
        'tie_breaker_priority_order': '📋 **סדר עדיפות קביעות:**\n',
        'current_scores': '📊 ניקוד נוכחי:\n',
        'current_turn': '🎯 **תור נוכחי:**',
        'next_3_turns': '📅 **3 התורות הבאים:**',
        'suspended_users': '✈️ **משתמשים מושעים:**\n',
        'days_left': 'יום נותר',
        'days_left_plural': 'ימים נותרו',
        'active_turn_assignments': '🔄 **הקצאות תורות פעילות:**\n',
        'active_punishments': '⚡ **עונשים פעילים:**',
        'punishment_turns_remaining': '{turns} תורות עונש נותרו',
        'no_admins_set': '👨‍💼 **עדיין לא הוגדרו מנהלים.**\n\nהשתמש ב-`/addadmin <משתמש>` כדי להוסיף מנהל.',
        'no_users_to_remove': 'אין משתמשים בתור להסרה.',
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
        'no_data_available': '📊 **אין נתונים זמינים**\n\n❌ לא נמצאו סטטיסטיקות חודשיות לתקופה זו.\n\n💡 **זה בדרך כלל אומר:**\n• הבוט הופעל לאחרונה\n• עדיין לא נרשמה פעילות\n• הנתונים אופסו\n\n📅 **נסה שוב לאחר שתתרחש פעילות.**',
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
        'assists_provided': 'עזרות שסופקו: {count}',
        'total_dishes_completed': 'סה"כ כלים שהושלמו: {count}',
        'admin_interventions': 'התערבויות מנהל: {count}',
        'queue_reorders': 'סידורי תור מחדש: {count}',
        'no_statistics_available': 'אין סטטיסטיקות זמינות עדיין. חזרו לאחר פעילות.',
        'no_statistics_recorded_this_month': 'אין סטטיסטיקות שנרשמו החודש עדיין.',
        'database_issue_work_done': 'בעיית מסד נתונים - העבודה הושלמה אך לא נשמרה',
        'database_updated_turn_completion': '✅ **מסד הנתונים עודכן:** השלמת התור נשמרה בהצלחה!',
        'database_error_turn_completion': '❌ **שגיאת מסד נתונים:** השלמת התור עדיין לא נשמרה. פנו לתמיכה אם הבעיה נמשכת.',
        'database_updated_admin_completion': '✅ **מסד הנתונים עודכן:** השלמת המנהל נשמרה בהצלחה!',
        'database_error_admin_completion': '❌ **שגיאת מסד נתונים:** השלמת המנהל עדיין לא נשמרה. פנו לתמיכה אם הבעיה נמשכת.',
        'database_updated_force_swap': '✅ **מסד הנתונים עודכן:** החלפה כפויה נשמרה בהצלחה!',
        'database_error_force_swap': '❌ **שגיאת מסד נתונים:** החלפה כפויה עדיין לא נשמרה. פנו לתמיכה אם הבעיה נמשכת.',
        'totals': 'סה"כ',
        
        // Swap status messages
        'temporary_swaps_active': 'החלפות זמניות פעילות:',
        'no_active_swaps': 'אין החלפות פעילות - סדר תור רגיל',
        'force_swap_type': 'החלפה בכוח',
        'user_swap_type': 'החלפת משתמש',
        'reverts_when_completes': 'חוזר כאשר {user} מסיים את התור שלו',
        'undefined': 'לא בתור',
        
        // Help messages
        'help_title': '🤖 **בוט מדיח הכלים של המשפחה:**\n\n',
        'help_scoring_system': '📊 **מערכת ניקוד:**\n',
        'help_scoring_explanation': '• כל משתמש יש לו ניקוד (מספר התורות שביצע)\n• התור הבא נקבע לפי הניקוד הנמוך ביותר\n• במקרה של שוויון, משתמשים בסדר הקבוע ({Eden} → {Adele} → {Emma})\n• המערכת שומרת על הוגנות לאורך זמן\n\n',
        'help_queue_commands': '📋 **פקודות התור:**\n',
        'help_queue_explanation': '• `/status` - הצגת התור הנוכחי, ניקודים, והתורות הבאים\n• `/done` - השלמת התור שלך (מעלה את הניקוד ב-1)\n\n',
        'help_swapping': '🔄 **החלפת תורות:**\n',
        'help_swapping_explanation': '• **החלפה** - בקשה להחליף את התור שלך עם משתמש אחר\n• **מי יכול להחליף:** רק מי שבמהלך התור שלו (מחזיק התור המקורי או מבצע התור)\n• **תהליך:** בחר משתמש → המשתמש מקבל הודעה → צריך לאשר או לדחות\n• **איך זה עובד:** המשתמש השני מבצע את התור שלך (אתה חייב להם טובה)\n• **ניקוד:** רק ניקוד המשתמש המבצע עולה (+1)\n• **החלפות רצופות:** משתמשים שמבצעים תור יכולים להחליף אותו למישהו אחר\n• **החלפה חזרה:** אפשר להחליף חזרה למחזיק התור המקורי (מבטל את ההקצאה)\n• **פג תוקף:** בקשות החלפה פוגות אם התור השתנה לפני האישור\n• **ביטול:** אתה יכול לבטל את הבקשה שלך בכל עת\n\n',
        'help_punishment': '⚡ **דיווח על משתמש:**\n',
        'help_punishment_explanation': '• **בקשת ענישה** - דיווח על משתמש אחר\n• **תהליך:** בחר משתמש → בחר סיבה → מנהלים מקבלים הודעה\n• **ענישה:** מנהל מאשר ענישה (מפחית 3 נקודות מהניקוד)\n\n',
        'help_admin_features': '👨‍💼 **תכונות מנהל:**\n',
        'help_admin_explanation': '• **החלפה בכוח** - החלפת תור בכוח (אותה לוגיקה כמו החלפות משתמש, מיידית)\n• **הפעלת עונש** - הפעלת עונש ישיר\n• **עזרה** - טיפול במדיח ללא השפעה על התור (`/assist`)\n• **השעיה/הפעלה מחדש** - השעיה והפעלה מחדש של משתמשים\n• **איפוס ניקודים** - איפוס ניקודים (כולם, יחיד, או נרמול)\n• **סידור תור מחדש** - שינוי סדר הקביעות\n• **סטטיסטיקות תור** - סטטיסטיקות מפורטות\n• **דוח חודשי** - דוח חודשי מפורט\n• **ניהול משתמשים** - הסרת משתמשים מהבוט\n• **איפוס נתונים** - איפוס כל נתוני הבוט עם אישור\n\n',
        'help_tie_breaker': '🎯 **סדר קביעות:** {Eden} → {Adele} → {Emma}\n\n',
        'help_tip': '💡 **עצה:** השתמש בכפתורים לניווט קל יותר!\n\n🔧 **פקודות מנהל חדשות:**\n• `/assist` - טיפול במדיח ללא השפעה על התור\n• `/removeuser @username` - הסרת משתמש מהבוט\n• `/resetbot` - איפוס כל נתוני הבוט\n• `/leave` או `/quit` - הסרה עצמית מהבוט\n\n🚨 **הגנת חוב:**\n• משתמשים עם ניקוד נמוך לא יכולים לעזוב כדי למנוע איפוס חוב\n• תקופת חסד של 24 שעות לעזיבות לגיטימיות\n• ניקוד נשמר במהלך תקופת החסד',
        'help_basic_info': '\n💡 **מידע בסיסי:**\n• הבוט מנהל תורות מדיח כלים למשתמשים מורשים\n• פנה למנהל כדי לקבל הרשאה לפקודות התור\n• השתמש ב-`/start` כדי להתחיל להשתמש בבוט\n\n',
        // Debt protection messages
        'debt_warning': '🚨 **אזהרה: יש לך {debtAmount} תורות להשלים לפני העזיבה!**\n\n📊 **הניקוד שלך:** {userScore}\n📊 **הניקוד הגבוה ביותר:** {maxScore}\n\n❌ **לא ניתן לעזוב עם חובות פתוחים**\n\n💡 **השלם את התורות שלך או בקש ממנהל להסיר אותך**',
        'leave_confirmation': '⚠️ **האם אתה בטוח שברצונך לעזוב את הבוט?**\n\n📊 **הניקוד הנוכחי שלך:** {userScore}\n\nזה יגרום ל:\n• הסרה מכל התורים\n• התחלת תקופת חסד של 24 שעות\n• תוכל להצטרף מחדש תוך 24 שעות עם אותו ניקוד\n• אחרי 24 שעות, הניקוד יתאפס ל-0\n\nהאם אתה בטוח?',
        'admin_leave_confirmation': '⚠️ **האם אתה בטוח שברצונך לעזוב כמנהל?**\n\n👑 **הרשאות המנהל יוסרו**\n\nזה יגרום ל:\n• הסרת הרשאות המנהל שלך\n• הסרה מכל התורים\n• התחלת תקופת חסד של 24 שעות\n• תוכל להצטרף מחדש תוך 24 שעות\n\nהאם אתה בטוח?',
        'yes_leave_bot': '✅ כן, עזוב את הבוט',
        'cancel_leave': '❌ ביטול',
        'leave_cancelled': '❌ העזיבה בוטלה. אתה נשאר בבוט.',
        'grace_period_message': '👋 הוסרת מהבוט לניהול מדיח הכלים.\n\n⏰ **תקופת חסד של 24 שעות פעילה עד:** {graceEndTime}\n📊 **הניקוד שלך נשמר:** {userScore}\n\n💡 **הצטרף מחדש תוך 24 שעות כדי לשמור על הניקוד שלך, או שהוא יתאפס ל-0**',
        
        // Additional messages
        'reset_warning': '⚠️ **אזהרה: זה יאפס את כל נתוני הבוט!**\n\nזה כולל:\n• כל המשתמשים והמנהלים\n• סדר התור\n• ניקודים\n• הגדרות\n\nהאם אתה בטוח?',
        'not_authorized': '❌ אתה לא מורשה כרגע. השתמש ב-/start כדי להצטרף לבוט.',
        'admin_access_required': '❌ נדרש גישת מנהל לפעולה זו',
        'usage_removeuser': '❌ **שימוש:** `/removeuser <username>`\n\nדוגמה: `/removeuser Dani`',
        'user_removed_success': '✅ המשתמש **{user}** הוסר מהבוט',
        'user_not_found': '❌ המשתמש **{user}** לא נמצא במשתמשים מורשים',
        'bot_reset_success': '🔄 **נתוני הבוט אופסו לחלוטין!**\n\nכל המשתמשים צריכים להתיר מחדש עם /start',
        'reset_cancelled': '❌ האיפוס בוטל. נתוני הבוט נשארים ללא שינוי.',
        'no_users_to_remove': '❌ אין משתמשים להסרה',
        'no_authorized_users_to_remove': '❌ **אין משתמשים להסרה**\n\n💡 **תחילה הרשא משתמשים עם:**\n`/authorize Eden`\n`/authorize Adele`\n`/authorize Emma`\n\n📋 **מיקומי תור זמינים:**\n• {Eden}\n• {Adele}\n• {Emma}',
        'user_management_title': '👥 **ניהול משתמשים**\nלחץ להסרת משתמשים:',
        'you_removed_from_bot': '👋 הוסרת מהבוט לניהול מדיח הכלים. השתמש ב-/start כדי להצטרף מחדש בכל עת.',
        'yes_reset_everything': '✅ כן, אפס הכל',
        'cancel_reset_button': '❌ ביטול',
        'remove_user_prefix': '❌ הסר',
        'reset_bot_button': '🔄 אפס בוט',
        'leave_bot_button': '👋 עזוב בוט',
        'hard_reset_section': '⚠️ איפוס כללי',
        'danger_zone_warning': '🚨 **אזור סכנה** - פעולות אלה אינן הפיכות!\n\n• **הסר משתמש** - הסר משתמשים מהבוט\n• **אפס בוט** - איפוס מלא של נתוני הבוט\n• **עזוב בוט** - הסר את עצמך עם תקופת חסד\n\n⚠️ **השתמש בזהירות רבה!**',
        'back_to_admin_menu': '🔙 חזור לתפריט מנהל',
        'last_admin_cannot_leave': '❌ **לא ניתן לעזוב - אתה המנהל האחרון!**\n\n🚨 **ניהול הבוט דורש לפחות מנהל אחד**\n\n💡 **אפשרויות:**\n• הוסף מנהל נוסף קודם\n• השתמש בפקדי מנהל להסרת עצמך\n• העבר הרשאות מנהל למשתמש אחר',
        
        // Dishwasher confirmation dialog
        'dishwasher_already_running': '⚠️ המדיח כבר פועל!\n\nלחיצה שוב תגרום ל:\n• איפוס טיימר של 3 שעות\n• שליחת התראות חדשות לכולם\n• ביטול הטיימר הנוכחי\n\nהאם אתה בטוח שברצונך לאפס?',
        'dishwasher_finished_not_done': '⚠️ המדיח כבר הסתיים אבל לא סומן כהושלם!\n\nלחיצה שוב תגרום ל:\n• התחלת מחזור מדיח חדש\n• שליחת התראות חדשות לכולם\n\nהאם אתה בטוח שברצונך להתחיל מחזור חדש?',
        'yes_reset_timer': 'כן, אפס טיימר',
        'yes_start_new': 'כן, התחל חדש',
        'cancel': 'ביטול',
        'reset_cancelled': 'האיפוס בוטל. טיימר המדיח נותר ללא שינוי.',
        'error_occurred': '❌ אירעה שגיאה. אנא נסה שוב.',
        'unknown_button_action': '❌ פעולת כפתור לא מוכרת. אנא השתמש בתפריט הראשי.'
    }
};

// Get user's language preference
function getUserLanguage(userId) {
    const key = String(userId);
    return userLanguage.get(key) || 'en'; // Default to English
}

// Helper function to get userId from chatId for notifications
function getUserIdFromChatId(chatId) {
    return chatIdToUserId.get(chatId) || chatId; // Fallback to chatId if not found
}

// Extract first name only from full names (e.g., "Eden Aronov" -> "Eden")
function getFirstName(fullName) {
    if (!fullName || typeof fullName !== 'string') return '';
    
    // Split by space and take first part
    const firstName = fullName.split(' ')[0];
    
    // Safety check for empty firstName
    if (!firstName || firstName.length === 0) return '';
    
    // Capitalize first letter, lowercase the rest
    return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
}

// Translate names based on user's language preference
function translateName(name, userId) {
    const userLang = getUserLanguage(userId);
    if (userLang === 'he') {
        // Safety check for name
        if (!name) return '';
        
        // First try exact match (case-insensitive)
        const lowerName = name.toLowerCase();
        for (const [englishName, hebrewName] of Object.entries(hebrewNames)) {
            if (lowerName === englishName.toLowerCase()) {
                return hebrewName;
            }
        }
        
        // Then try partial matches for names with surnames (case-insensitive)
        for (const [englishName, hebrewName] of Object.entries(hebrewNames)) {
            if (lowerName.includes(englishName.toLowerCase())) {
                // Return only the Hebrew name, remove the surname
                return hebrewName;
            }
        }
    }
    return getFirstName(name); // Return first name only for English or unknown names
}

// Translate reason strings based on user's language preference
function translateReason(reason, userId) {
    if (!reason) return reason;
    
    const userLang = getUserLanguage(userId);
    if (userLang === 'he') {
        // Map English reason strings to translation keys
        const reasonMap = {
            'Behavior': 'reason_behavior',
            'Household Rules': 'reason_household',
            'Respect': 'reason_respect',
            'Other': 'reason_other'
        };
        
        // Check if reason matches any key (case-insensitive)
        const reasonLower = reason.toLowerCase().trim();
        for (const [englishReason, translationKey] of Object.entries(reasonMap)) {
            if (reasonLower === englishReason.toLowerCase()) {
                // Get Hebrew translation, but remove emoji prefix for display
                return t(userId, translationKey).replace(/^[^\s]+\s*/, '').trim();
            }
        }
    }
    
    // Return original reason if no translation found or language is English
    return reason;
}

// Translate description based on user's language preference
function translateDescription(description, userId) {
    const userLang = getUserLanguage(userId);
    
    // For now, return description as-is since we don't have a translation system for descriptions
    // In the future, this could be enhanced with a description translation dictionary
    // or integration with a translation service
    
    // Simple approach: if description contains Hebrew characters, assume it's Hebrew
    // and if user prefers English, we could add basic translations here
    
    if (userLang === 'en') {
        // Basic Hebrew to English translations for common assist descriptions
        const commonTranslations = {
            'מדיח נוקה על ידי מנהל': 'Dishwasher cleaned by admin',
            'עזרה במטבח': 'Kitchen help',
            'ניקיון כללי': 'General cleaning',
            'תחזוקת מדיח': 'Dishwasher maintenance',
            'עזרה דחופה': 'Emergency help'
        };
        
        return commonTranslations[description] || description;
    }
    
    return description; // Return original description
}

// Get translated text
function t(userId, key, replacements = {}) {
    const lang = getUserLanguage(userId);
    let text = translations[lang][key] || translations.en[key] || key;
    
    // Replace placeholders like {user}, {admin}, {count}
    for (const [placeholder, value] of Object.entries(replacements)) {
        const replacement = value || ''; // Ensure replacement is never undefined/null
        text = text.replace(new RegExp(`{${placeholder}}`, 'g'), replacement);
    }
    
    // Ensure we always return a non-empty string
    if (!text || text.trim().length === 0) {
        console.log(`⚠️ Empty translation for key: ${key}, userId: ${userId}`);
        return key; // Return the key itself as fallback
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
    // Check if it's an admin first (admins get priority emojis)
    const adminArray = Array.from(admins);
        if (adminArray.length > 0 && (adminArray[0] === userName || (adminArray[0] && userName && adminArray[0].toLowerCase() === userName.toLowerCase()))) {
        return `${royalEmojis.admin_1} ${userName}`; // King
    }
        if (adminArray.length > 1 && (adminArray[1] === userName || (adminArray[1] && userName && adminArray[1].toLowerCase() === userName.toLowerCase()))) {
        return `${royalEmojis.admin_2} ${userName}`; // Queen
    }
    
    // Check if it's a predefined queue member
    if (royalEmojis[userName]) {
        return `${royalEmojis[userName]} ${userName}`;
    }
    
    // For other authorized users, assign emojis based on their position in authorizedUsers
    const authorizedArray = Array.from(authorizedUsers);
    const userIndex = authorizedArray.findIndex(user => 
            user === userName || (user && userName && user.toLowerCase() === userName.toLowerCase())
    );
    
    if (userIndex !== -1) {
        // Assign emojis based on position in authorized users
        const userEmojis = ['🔱', '⭐', '✨']; // Princess emojis
        const emoji = userEmojis[userIndex] || '👤'; // Default user emoji
        return `${emoji} ${userName}`;
    }
    
    // Default: return name with generic emoji
    return `👤 ${userName}`;
}

// Function to add royal emoji AND translate names based on user's language
function addRoyalEmojiTranslated(userName, userId) {
    // Safety check for null/undefined userName
    if (!userName) {
        return '👤 Unknown';
    }
    
    const translatedName = translateName(userName, userId) || userName;
    
    // Check if it's an admin first (admins get priority emojis)
    const adminArray = Array.from(admins);
        if (adminArray.length > 0 && (adminArray[0] === userName || (adminArray[0] && userName && adminArray[0].toLowerCase() === userName.toLowerCase()))) {
        return `${royalEmojis.admin_1} ${translatedName}`; // King
    }
        if (adminArray.length > 1 && (adminArray[1] === userName || (adminArray[1] && userName && adminArray[1].toLowerCase() === userName.toLowerCase()))) {
        return `${royalEmojis.admin_2} ${translatedName}`; // Queen
    }
    
    // Check if it's a predefined queue member
    if (royalEmojis[userName]) {
        return `${royalEmojis[userName]} ${translatedName}`;
    }
    
    // For other authorized users, assign emojis based on their position in authorizedUsers
    const authorizedArray = Array.from(authorizedUsers);
    const userIndex = authorizedArray.findIndex(user => 
            user === userName || (user && userName && user.toLowerCase() === userName.toLowerCase())
    );
    
    if (userIndex !== -1) {
        // Assign emojis based on position in authorized users
        const userEmojis = ['🔱', '⭐', '✨']; // Princess emojis
        const emoji = userEmojis[userIndex] || '👤'; // Default user emoji
        return `${emoji} ${translatedName}`;
    }
    
    // Default: just return the translated name with a generic emoji
    return `👤 ${translatedName}`;
}

// Get user name from user ID (helper function)
function getUserName(userId) {
    // Try to find userName from userChatIds mapping (userName -> chatId)
    for (const [name, chatId] of userChatIds.entries()) {
        if (chatId === userId) {
            return name;
        }
    }
    
    // Try to find userName from admins set (check if userId is in admins)
    if (admins.has(userId.toString())) {
        return userId.toString();
    }
    
    // Fallback: return userId as string
    return userId.toString();
}

// Database retry helper for /done operations
async function retryDatabaseOperation(operation, maxRetries = 2) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await operation();
            return true; // Success
        } catch (error) {
            console.log(`❌ Database operation attempt ${attempt} failed:`, error.message);
            if (attempt === maxRetries) {
                return false; // All attempts failed
            }
            // Wait 500ms before retry
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    return false;
}

// Send database error notification to admins only
function notifyDatabaseError(chatId, userId, userName, isAdmin) {
    const errorMessage = t(userId, 'database_issue_work_done');
    
    // Send to the user who pressed /done
    sendMessage(chatId, errorMessage);
    
    // Notify only admins (they can actually do something about database issues)
    [...admins].forEach(admin => {
        let adminChatId = userChatIds.get(admin) || (admin ? userChatIds.get(admin.toLowerCase()) : null);
        
        if (!adminChatId) {
            adminChatId = adminNameToChatId.get(admin) || (admin ? adminNameToChatId.get(admin.toLowerCase()) : null);
        }
        
        if (adminChatId && adminChatId !== chatId) {
            const recipientUserId = getUserIdFromChatId(adminChatId);
            const localizedError = t(recipientUserId, 'database_issue_work_done');
            console.log(`🔔 Sending database error notification to admin: ${admin} (${adminChatId})`);
            sendMessage(adminChatId, localizedError);
        }
    });
}

// Send message to Telegram
function sendMessage(chatId, text) {
    // Validate text before sending
    if (!text || (typeof text === 'string' && text.trim().length === 0)) {
        console.log(`⚠️ Skipping empty message to ${chatId}`);
        return;
    }
    
    const url = `${botUrl}/sendMessage`;
    
    const send = (payload) => {
        const data = JSON.stringify(payload);
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
            },
            agent: telegramHttpsAgent
    };
    const req = https.request(url, options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => responseData += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(responseData || '{}');
                    if (response && response.ok) {
        console.log(`📤 Sent message to ${chatId}`);
                    } else {
                        const desc = response && response.description ? response.description : 'Unknown error';
                        console.log(`❌ Telegram sendMessage error: ${desc}`);
                        // Fallback: retry without parse_mode on formatting errors
                        if (payload.parse_mode && /parse|entity|markdown/i.test(desc)) {
                            const fallback = { chat_id: chatId, text: text };
                            const trimmed = typeof text === 'string' ? text.trim() : text;
                            fallback.text = trimmed;
                            send(fallback);
                        }
                    }
                } catch (e) {
                    console.log(`❌ Error parsing Telegram response: ${e.message}`);
                }
            });
        });
        req.on('error', (err) => {
            console.log(`❌ HTTPS error sending message: ${err.message}`);
        });
        req.write(data);
        req.end();
    };

    // Try Markdown first; will auto-fallback if Telegram rejects formatting
    send({ chat_id: chatId, text, parse_mode: 'Markdown' });
}

// Send plain text (no formatting) to avoid Markdown/HTML parse errors
function sendMessagePlain(chatId, text) {
    const url = `${botUrl}/sendMessage`;
    const payload = { chat_id: chatId, text: typeof text === 'string' ? text : String(text) };
    const data = JSON.stringify(payload);
        const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
            },
            agent: telegramHttpsAgent
    };
    const req = https.request(url, options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => responseData += chunk);
        res.on('end', () => {
            try {
                const response = JSON.parse(responseData || '{}');
                if (response && response.ok) {
                    console.log(`📤 Sent message to ${chatId}`);
                } else {
                    const desc = response && response.description ? response.description : 'Unknown error';
                    console.log(`❌ Telegram sendMessage (plain) error: ${desc}`);
                }
            } catch (e) {
                console.log(`❌ Error parsing Telegram response (plain): ${e.message}`);
            }
        });
    });
    req.on('error', (err) => {
        console.log(`❌ HTTPS error sending message (plain): ${err.message}`);
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
        parse_mode: 'HTML',
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
async function handleCommand(chatId, userId, userName, text) {
    const command = (text || '').toLowerCase().trim();
    
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
                              `📢 ${t(userId, 'announcement')}\n\n` +
                              `${announcementText}\n\n` +
                              `👨‍💼 ${t(userId, 'from_admin')}: ${translateName(userName, userId)}\n` +
                              `🕐 ${t(userId, 'time')}: ${new Date().toLocaleString()}`;
        
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
                              `💬 ${t(userId, 'message_from')} ${translateName(userName, userId)}\n\n` +
                              `${messageText}\n\n` +
                              `🕐 ${t(userId, 'time')}: ${new Date().toLocaleString()}`;
        
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
        console.log(`🚀 /start command received from ${userName} (${userId}) in chat ${chatId}`);
        
        // Store chat ID for this user (for notifications)
        userChatIds.set(userName, chatId);
        if (userName) {
        userChatIds.set(userName.toLowerCase(), chatId);
        }
        
        // Store reverse mapping for notifications (chatId -> userId)
        chatIdToUserId.set(chatId, userId);
        
        // Set default language for new users (if not already set)
        const langKey = String(userId);
        if (!userLanguage.has(langKey)) {
            userLanguage.set(langKey, 'en'); // Default to English
            console.log(`🌐 Set default language (English) for new user ${userName} (${userId})`);
        } else {
            console.log(`🌐 User ${userName} (${userId}) already has language preference: ${userLanguage.get(langKey)}`);
        }
        
        const isAdmin = isUserAdmin(userName, userId);
        const isAuthorized = isUserAuthorized(userName);
        
        // Check if user is in grace period (CRITICAL FIX!)
        let gracePeriodRestored = false;
        if (global.gracePeriods && global.gracePeriods.has(userName)) {
            const graceData = global.gracePeriods.get(userName);
            const now = Date.now();
            
            if (now < graceData.endTime) {
                // Grace period is still active - restore user
                console.log(`🔄 Grace period restoration for ${userName}: score ${graceData.score}`);
                
                // Only restore to queue if user is NOT an admin
                if (!isAdmin) {
                    // Restore user to queue data structures
                    authorizedUsers.add(userName);
                    userScores.set(userName, graceData.score);
                    
                    // Add back to originalQueue if not already there
                    if (!originalQueue.includes(userName)) {
                        originalQueue.push(userName);
                    }
                    
                    // Add back to turnOrder
                    turnOrder.add(userName);
                    
                    // Restore queue mappings
                    userQueueMapping.set(userName, userName);
                    queueUserMapping.set(userName, userName);
                    
                    gracePeriodRestored = true;
                    console.log(`✅ ${userName} restored from grace period with score ${graceData.score}`);
                } else {
                    // Admin in grace period - just restore their score but don't add to queue
                    userScores.set(userName, graceData.score);
                    console.log(`✅ Admin ${userName} score restored from grace period: ${graceData.score} (not added to queue)`);
                }
                
                // Clear grace period
                global.gracePeriods.delete(userName);
                
                // Save the restoration
                await saveBotData();
            } else {
                // Grace period expired - clean up
                global.gracePeriods.delete(userName);
                console.log(`⏰ Grace period expired for ${userName} - treating as new user`);
            }
        }
        
        // If this user is an admin, store their chat ID for admin notifications
        if (isAdmin) {
            adminChatIds.add(chatId);
            adminNameToChatId.set(userName, chatId);
            if (userName) {
                adminNameToChatId.set(userName.toLowerCase(), chatId);
            }
            console.log(`👨‍💼 Admin ${userName} (${userId}) chat ID ${chatId} added to adminChatIds and adminNameToChatId`);
        }
        
        let text = t(userId, 'menu_title');
        let buttons = [];
        
        // Show grace period restoration message if applicable
        if (gracePeriodRestored) {
            text += `\n\n✅ **Welcome back!** Your score has been restored from grace period.`;
        }
        
        if (isAdmin) {
            text += t(userId, 'admin_menu');
            buttons = [
                // Row 1: Core Operations
                [
                    { text: t(userId, 'status'), callback_data: "status" },
                    { text: t(userId, 'done'), callback_data: "done" }
                ],
                // Row 2: Queue Control
                [
                    { text: t(userId, 'force_swap'), callback_data: "force_swap_menu" },
                    { text: t(userId, 'assist'), callback_data: "assist_menu" }
                ],
                // Row 3: Dishwasher Activity
                [
                    { text: t(userId, 'dishwasher_started'), callback_data: "dishwasher_started" },
                    { text: t(userId, 'dishwasher_alert'), callback_data: "dishwasher_alert" }
                ],
                // Row 4: Administrative Actions
                [
                    { text: t(userId, 'apply_punishment'), callback_data: "apply_punishment_menu" },
                    { text: t(userId, 'maintenance'), callback_data: "maintenance_menu" }
                ],
                // Row 5: Communication Tools
                [
                    { text: t(userId, 'broadcast'), callback_data: "create_announcement" },
                    { text: t(userId, 'send_message'), callback_data: "send_user_message" }
                ],
                // Row 6: Utility & Settings
                [
                    { text: t(userId, 'help'), callback_data: "help" },
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
                    { text: t(userId, 'leave_bot_button'), callback_data: "leave_bot" }
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
        
        console.log(`🔘 About to send menu: text="${text}", buttons=${JSON.stringify(buttons, null, 2)}`);
        sendMessageWithButtons(chatId, text, buttons);
        console.log(`✅ /start command completed for ${userName}`);
        
    } else if (command === '/status' || command === 'status') {
        let statusMessage = `${t(userId, 'dishwasher_queue_status')}\n\n`;
        
        // Get current turn user and next 3 turns using score-based system
        const currentUser = getCurrentTurnUser();
        console.log(`📊 /status - getCurrentTurnUser(): ${currentUser}`);
        console.log(`📊 /status - turnAssignments:`, Array.from(turnAssignments.entries()));
        const nextThreeTurns = getNextThreeTurns();
        
        // Show current turn (explicitly use currentUser to ensure accuracy with assignment chains)
        if (currentUser) {
            const royalName = addRoyalEmojiTranslated(currentUser, userId);
            const isAuthorized = isUserAuthorized(currentUser);
            const authText = isAuthorized ? '' : ` ${t(userId, 'not_authorized_user')}`;
            statusMessage += `🔄 1. ${royalName} ${t(userId, 'current_turn')}${authText}\n`;
        }
        
        // Show next turns (skip first if it matches currentUser, otherwise show all)
        let startIndex = (nextThreeTurns[0] === currentUser) ? 1 : 0;
        for (let i = startIndex; i < Math.min(nextThreeTurns.length, 3 + startIndex); i++) {
            const name = nextThreeTurns[i];
            if (!name) continue;
            
            const royalName = addRoyalEmojiTranslated(name, userId);
            const turnIcon = '⏳';
            const turnNumber = i - startIndex + 2; // Start from 2 (since 1 is current turn)
            
            // Check if this queue member is authorized
            const isAuthorized = isUserAuthorized(name);
            const authText = isAuthorized ? '' : ` ${t(userId, 'not_authorized_user')}`;
            
            statusMessage += `${turnIcon} ${turnNumber}. ${royalName}${authText}\n`;
        }
        
        statusMessage += `\n${t(userId, 'authorized_users')} ${authorizedUsers.size}/3`;
        
        // Show current scores (only for authorized users) - fetch from database for accuracy
        statusMessage += `\n\n${t(userId, 'current_scores')}`;
        const relativeScores = getRelativeScores();
        
        // OPTIMIZATION: Parallel database reads for better performance
        const authorizedUsersArray = Array.from(authorizedUsers);
        const scorePromises = authorizedUsersArray.map(user => db.getUserScore(user));
        const scores = await Promise.all(scorePromises);
        
        // Display scores in originalQueue order for consistency
        for (const user of originalQueue) {
            if (authorizedUsers.has(user)) {
                // Get score from parallel fetch results
                const userIndex = authorizedUsersArray.indexOf(user);
                const score = scores[userIndex] || 0;
                const relativeScore = relativeScores.get(user) || 0;
                const royalName = addRoyalEmojiTranslated(user, userId);
                statusMessage += `• ${royalName}: ${score} (${relativeScore >= 0 ? '+' : ''}${relativeScore})\n`;
            }
        }
        
        // Show punishment information
        const usersWithPunishments = Array.from(punishmentTurns.entries()).filter(([user, turns]) => turns > 0);
        if (usersWithPunishments.length > 0) {
            statusMessage += `\n\n${t(userId, 'active_punishments')}`;
            usersWithPunishments.forEach(([user, turns]) => {
                statusMessage += `\n• ${addRoyalEmojiTranslated(user, userId)}: ${t(userId, 'punishment_turns_remaining', {turns})}`;
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
                    statusMessage += `\n• ${addRoyalEmojiTranslated(user, userId)}: ${t(userId, 'permanently_removed')}`;
                } else {
                    statusMessage += `\n• ${addRoyalEmojiTranslated(user, userId)}: ${t(userId, 'suspended_until', {date})}`;
                }
            });
        }
        
        // Show active turn assignments (force swaps)
        if (turnAssignments.size > 0) {
            statusMessage += `\n\n${t(userId, 'active_turn_assignments')}`;
            for (const [originalUser, assignedUser] of turnAssignments.entries()) {
                const royalOriginal = addRoyalEmojiTranslated(originalUser, userId);
                const royalAssigned = addRoyalEmojiTranslated(assignedUser, userId);
                statusMessage += `\n• ${royalOriginal} → ${royalAssigned}`;
            }
        }
        
        sendMessage(chatId, statusMessage);
        
    } else if (command === '/done' || command === 'done') {
        // Check if user is admin
        const isAdmin = isUserAdmin(userName, userId);
        
        if (isAdmin) {
            // Initialize anti-cheating tracking for admin
        // Check for rapid DONE activity (30 minutes) - global tracking
        const now = Date.now();
        const lastGlobalDone = global.lastDishwasherDone;
        
        if (lastGlobalDone && (now - lastGlobalDone) < 30 * 60 * 1000) { // 30 minutes
            const lastDoneTime = new Date(lastGlobalDone).toLocaleString();
            // Send alert for ANY DONE within 30 minutes of last dishwasher completion
            alertAdminsAboutCheating(userId, userName, 'rapid_done', { lastDone: lastDoneTime });
            console.log(`🚨 RAPID DONE DETECTED: ${userName} (${userId}) - Last dishwasher done: ${lastDoneTime}`);
        }
        
        // Update global dishwasher completion timestamp
        global.lastDishwasherDone = now;
        
            // Admin "Done" - Admin takes over dishwasher duty
            const currentUser = getCurrentTurnUser();
            
            if (!currentUser) {
                sendMessage(chatId, t(userId, 'no_one_in_queue'));
                return;
            }
            
            // Mark dishwasher as completed IMMEDIATELY (before async operations) to prevent race condition
            // This ensures that if "dishwasher started" is pressed during DONE execution, the state is already correct
            global.dishwasherCompleted = true;
            global.dishwasherStarted = false; // Reset for next cycle
            global.dishwasherStartedAt = null; // Clear timer timestamp
            
            // Save dishwasher state to database
            await db.saveBotState('dishwasherCompleted', true);
            await db.saveBotState('dishwasherStarted', false);
            await db.saveBotState('dishwasherStartedAt', null);
            
            // Find the original user whose turn this was (in case of assignment)
            let originalUser = currentUser;
            for (const [user, assignedTo] of turnAssignments.entries()) {
                if (assignedTo === currentUser) {
                    originalUser = user;
                    break;
                }
            }
            
            // OPTIMISTIC: Send notifications immediately (work is physically done)
            // Temporarily increment score to calculate correct next turn
            const currentScore = userScores.get(currentUser) || 0;
            userScores.set(currentUser, currentScore + 1);
            
            const nextUser = getCurrentTurnUser(false);
            
            // Revert the temporary score increment (will be properly incremented in background)
            userScores.set(currentUser, currentScore);
            
            const adminDoneMessage = `${t(userId, 'admin_intervention')}\n\n` +
                `${t(userId, 'admin_completed_duty', {admin: translateName(userName, userId)})}\n` +
                `${t(userId, 'helped_user', {user: translateName(currentUser, userId)})}\n` +
                `${t(userId, 'next_turn', {user: translateName(nextUser, userId)})}` +
                `\n\n${t(userId, 'admin_can_apply_punishment', {user: translateName(currentUser, userId)})}`;
            
            // Send confirmation to admin immediately
            sendMessage(chatId, adminDoneMessage);
            
            // Notify all authorized users and admins immediately
            [...authorizedUsers, ...admins].forEach(user => {
                let userChatId = userChatIds.get(user) || (user ? userChatIds.get(user.toLowerCase()) : null);
                
                if (!userChatId && isUserAdmin(user)) {
                    userChatId = adminNameToChatId.get(user) || (user ? adminNameToChatId.get(user.toLowerCase()) : null);
                }
                
                if (userChatId && userChatId !== chatId) {
                    const recipientUserId = getUserIdFromChatId(userChatId);
                    
                    const userDoneMessage = `${t(recipientUserId, 'admin_intervention')}\n\n` +
                        `${t(recipientUserId, 'admin_completed_duty', {admin: translateName(userName, recipientUserId)})}\n` +
                        `${t(recipientUserId, 'helped_user', {user: translateName(currentUser, recipientUserId)})}\n` +
                        `${t(recipientUserId, 'next_turn', {user: translateName(nextUser, recipientUserId)})}` +
                        `\n\n${t(recipientUserId, 'admin_can_apply_punishment', {user: translateName(currentUser, recipientUserId)})}`;
                    
                    console.log(`🔔 Sending admin DONE notification to ${user} (${userChatId}, userId: ${recipientUserId})`);
                    sendMessage(userChatId, userDoneMessage);
                } else {
                    console.log(`🔔 No chat ID found for ${user} (admin: ${isUserAdmin(user)})`);
                }
            });
            
            // BACKGROUND: Retry database operations
            const dbSuccess = await retryDatabaseOperation(async () => {
                // Increment the score for the user who actually completed the turn (currentUser)
                await incrementUserScore(currentUser);
                
                // Clear the assignment if it was assigned
                if (originalUser !== currentUser) {
                    turnAssignments.delete(originalUser);
                    
                    // PHASE 2: Track bot state changes
                    dirtyKeys.add('turnAssignments');
                    isDirty = true;
                }
                
                // Update statistics for the user who completed their turn
                updateUserStatistics(currentUser);
                
                // Save bot data after score changes
                await saveBotData();
                
                // Track admin completion for monthly report
                trackMonthlyAction('admin_completion', currentUser, userName);
            });
            
            // If database operations failed, notify admins only
            if (!dbSuccess) {
                // Notify only admins about database issue
                [...admins].forEach(admin => {
                    let adminChatId = userChatIds.get(admin) || (admin ? userChatIds.get(admin.toLowerCase()) : null);
                    
                    if (!adminChatId) {
                        adminChatId = adminNameToChatId.get(admin) || (admin ? adminNameToChatId.get(admin.toLowerCase()) : null);
                    }
                    
                    if (adminChatId && adminChatId !== chatId) {
                        const recipientUserId = getUserIdFromChatId(adminChatId);
                        const localizedError = t(recipientUserId, 'database_issue_work_done');
                        console.log(`🔔 Sending database error notification to admin: ${admin} (${adminChatId})`);
                        sendMessage(adminChatId, localizedError);
                    }
                });
                
                // Schedule retry after 5 seconds
                setTimeout(async () => {
                    console.log('🔄 Retrying admin /done database save...');
                    const retrySuccess = await retryDatabaseOperation(async () => {
                        await incrementUserScore(currentUser);
                        
                        // Clear the assignment if it was assigned
                        if (originalUser !== currentUser) {
                            turnAssignments.delete(originalUser);
                            dirtyKeys.add('turnAssignments');
                            isDirty = true;
                        }
                        
                        updateUserStatistics(currentUser);
                        await saveBotData();
                        trackMonthlyAction('admin_completion', currentUser, userName);
                    });
                    
                    if (retrySuccess) {
                        console.log('✅ Admin /done database save succeeded on retry');
                        // Notify only admins about success
                        [...admins].forEach(admin => {
                            let adminChatId = userChatIds.get(admin) || (admin ? userChatIds.get(admin.toLowerCase()) : null);
                            
                            if (!adminChatId) {
                                adminChatId = adminNameToChatId.get(admin) || (admin ? adminNameToChatId.get(admin.toLowerCase()) : null);
                            }
                            
                            if (adminChatId && adminChatId !== chatId) {
                                const recipientUserId = getUserIdFromChatId(adminChatId);
                                sendMessage(adminChatId, t(recipientUserId, 'database_updated_admin_completion'));
                            }
                        });
                    } else {
                        console.log('❌ Admin /done database save failed on retry');
                        // Notify both user and admins about final failure
                        sendMessage(chatId, t(userId, 'database_error_admin_completion'));
                        [...admins].forEach(admin => {
                            let adminChatId = userChatIds.get(admin) || (admin ? userChatIds.get(admin.toLowerCase()) : null);
                            
                            if (!adminChatId) {
                                adminChatId = adminNameToChatId.get(admin) || (admin ? adminNameToChatId.get(admin.toLowerCase()) : null);
                            }
                            
                            if (adminChatId && adminChatId !== chatId) {
                                const recipientUserId = getUserIdFromChatId(adminChatId);
                                sendMessage(adminChatId, t(recipientUserId, 'database_error_admin_completion'));
                            }
                        });
                    }
                }, 5000);
            } else {
                // PHASE 3: Trigger non-blocking critical save for immediate persistence
                await saveCriticalData();
            }
            
            // Cancel auto-alert timer (state already set earlier to prevent race condition)
            if (global.dishwasherAutoAlertTimer) {
                clearTimeout(global.dishwasherAutoAlertTimer);
                global.dishwasherAutoAlertTimer = null;
            }
            
        } else {
            // Regular user "Done" - Check if user is authorized
            if (!userName || !isUserAuthorized(userName)) {
                sendMessage(chatId, t(userId, 'not_authorized_queue_commands', {user: userName || 'Unknown'}));
                return;
            }
            
            const currentUser = getCurrentTurnUser();
            
            if (!currentUser) {
                sendMessage(chatId, t(userId, 'no_one_in_queue'));
                return;
            }
            
            // Check if it's actually their turn (compare canonical names directly)
            if (userName !== currentUser) {
                sendMessage(chatId, `${t(userId, 'not_your_turn')}\n\n${t(userId, 'current_turn_user')} ${addRoyalEmojiTranslated(currentUser, userId)}\n${t(userId, 'your_queue_position')} ${addRoyalEmojiTranslated(userName, userId)}\n\n${t(userId, 'please_wait_turn')}`);
                return;
            }
            
            // Check for rapid DONE activity (30 minutes) - global tracking
            const now = Date.now();
            const lastGlobalDone = global.lastDishwasherDone;
            
            if (lastGlobalDone && (now - lastGlobalDone) < 30 * 60 * 1000) { // 30 minutes
                const lastDoneTime = new Date(lastGlobalDone).toLocaleString();
                // Send alert for ANY DONE within 30 minutes of last dishwasher completion
                alertAdminsAboutCheating(userId, userName, 'rapid_done', { lastDone: lastDoneTime });
                console.log(`🚨 RAPID DONE DETECTED: ${userName} (${userId}) - Last dishwasher done: ${lastDoneTime}`);
            }
            
            // Update global dishwasher completion timestamp
            global.lastDishwasherDone = now;
            
            // Mark dishwasher as completed IMMEDIATELY (before async operations) to prevent race condition
            // This ensures that if "dishwasher started" is pressed during DONE execution, the state is already correct
            global.dishwasherCompleted = true;
            global.dishwasherStarted = false; // Reset for next cycle
            global.dishwasherStartedAt = null; // Clear timer timestamp
            
            // Save dishwasher state to database
            await db.saveBotState('dishwasherCompleted', true);
            await db.saveBotState('dishwasherStarted', false);
            await db.saveBotState('dishwasherStartedAt', null);
            
            // Find the original user whose turn this was (in case of assignment)
            let originalUser = currentUser;
            for (const [user, assignedTo] of turnAssignments.entries()) {
                if (assignedTo === currentUser) {
                    originalUser = user;
                    break;
                }
            }
            
            // OPTIMISTIC: Send notifications immediately (work is physically done)
            // Temporarily increment score to calculate correct next turn
            const currentScore = userScores.get(currentUser) || 0;
            userScores.set(currentUser, currentScore + 1);
            
            const nextUser = getCurrentTurnUser(false);
            
            // Revert the temporary score increment (will be properly incremented in background)
            userScores.set(currentUser, currentScore);
            
            const doneMessage = `${t(userId, 'turn_completed')}\n\n` +
                `${t(userId, 'completed_by', {user: translateName(currentUser, userId)})}\n` +
                `${t(userId, 'next_turn', {user: translateName(nextUser, userId)})}`;
            
            // Send confirmation to user immediately
            sendMessage(chatId, doneMessage);
            
            // Notify all authorized users and admins immediately
            [...authorizedUsers, ...admins].forEach(user => {
                let userChatId = userChatIds.get(user) || (user ? userChatIds.get(user.toLowerCase()) : null);
                
                if (!userChatId && isUserAdmin(user)) {
                    userChatId = adminNameToChatId.get(user) || (user ? adminNameToChatId.get(user.toLowerCase()) : null);
                }
                
                if (userChatId && userChatId !== chatId) {
                    const recipientUserId = getUserIdFromChatId(userChatId);
                    
                    const userDoneMessage = `${t(recipientUserId, 'turn_completed')}\n\n` +
                        `${t(recipientUserId, 'completed_by', {user: translateName(currentUser, recipientUserId)})}\n` +
                        `${t(recipientUserId, 'next_turn', {user: translateName(nextUser, recipientUserId)})}`;
                    
                    console.log(`🔔 Sending user DONE notification to ${user} (${userChatId}, userId: ${recipientUserId})`);
                    sendMessage(userChatId, userDoneMessage);
                } else {
                    console.log(`🔔 No chat ID found for ${user} (admin: ${isUserAdmin(user)})`);
                }
            });
            
            // BACKGROUND: Retry database operations
            const dbSuccess = await retryDatabaseOperation(async () => {
                // Increment the score for the user who actually completed the turn (currentUser)
                await incrementUserScore(currentUser);
                
                // Clear the assignment if it was assigned
                if (originalUser !== currentUser) {
                    turnAssignments.delete(originalUser);
                    
                    // PHASE 2: Track bot state changes
                    dirtyKeys.add('turnAssignments');
                    isDirty = true;
                }
                
                // Update statistics for the user who completed their turn
                updateUserStatistics(currentUser);
                
                // Save bot data after score changes
                await saveBotData();
            });
            
            // If database operations failed, notify admins only
            if (!dbSuccess) {
                // Notify only admins about database issue
                [...admins].forEach(admin => {
                    let adminChatId = userChatIds.get(admin) || (admin ? userChatIds.get(admin.toLowerCase()) : null);
                    
                    if (!adminChatId) {
                        adminChatId = adminNameToChatId.get(admin) || (admin ? adminNameToChatId.get(admin.toLowerCase()) : null);
                    }
                    
                    if (adminChatId && adminChatId !== chatId) {
                        const recipientUserId = getUserIdFromChatId(adminChatId);
                        const localizedError = t(recipientUserId, 'database_issue_work_done');
                        console.log(`🔔 Sending database error notification to admin: ${admin} (${adminChatId})`);
                        sendMessage(adminChatId, localizedError);
                    }
                });
                
                // Schedule retry after 5 seconds
                setTimeout(async () => {
                    console.log('🔄 Retrying user /done database save...');
                    const retrySuccess = await retryDatabaseOperation(async () => {
                        await incrementUserScore(currentUser);
                        
                        // Clear the assignment if it was assigned
                        if (originalUser !== currentUser) {
                            turnAssignments.delete(originalUser);
                            dirtyKeys.add('turnAssignments');
                            isDirty = true;
                        }
                        
                        updateUserStatistics(currentUser);
                        await saveBotData();
                    });
                    
                    if (retrySuccess) {
                        console.log('✅ User /done database save succeeded on retry');
                        // Notify only admins about success
                        [...admins].forEach(admin => {
                            let adminChatId = userChatIds.get(admin) || (admin ? userChatIds.get(admin.toLowerCase()) : null);
                            
                            if (!adminChatId) {
                                adminChatId = adminNameToChatId.get(admin) || (admin ? adminNameToChatId.get(admin.toLowerCase()) : null);
                            }
                            
                            if (adminChatId && adminChatId !== chatId) {
                                const recipientUserId = getUserIdFromChatId(adminChatId);
                                sendMessage(adminChatId, t(recipientUserId, 'database_updated_turn_completion'));
                            }
                        });
                    } else {
                        console.log('❌ User /done database save failed on retry');
                        // Notify both user and admins about final failure
                        sendMessage(chatId, t(userId, 'database_error_turn_completion'));
                        [...admins].forEach(admin => {
                            let adminChatId = userChatIds.get(admin) || (admin ? userChatIds.get(admin.toLowerCase()) : null);
                            
                            if (!adminChatId) {
                                adminChatId = adminNameToChatId.get(admin) || (admin ? adminNameToChatId.get(admin.toLowerCase()) : null);
                            }
                            
                            if (adminChatId && adminChatId !== chatId) {
                                const recipientUserId = getUserIdFromChatId(adminChatId);
                                sendMessage(adminChatId, t(recipientUserId, 'database_error_turn_completion'));
                            }
                        });
                    }
                }, 5000);
            }
            
            // Cancel auto-alert timer (state already set earlier to prevent race condition)
            if (global.dishwasherAutoAlertTimer) {
                clearTimeout(global.dishwasherAutoAlertTimer);
                global.dishwasherAutoAlertTimer = null;
            }
        }
        
    } else if (command === '/help' || command === 'help') {
        // Role-based help content
        const userName = getUserName(userId);
        const isAdmin = isUserAdmin(userName, userId);
        const isAuthorized = isUserAuthorized(userName);
        
        let helpMessage = t(userId, 'help_title');
        
        // Basic content for everyone
        helpMessage += t(userId, 'help_scoring_system') + t(userId, 'help_scoring_explanation', {
            Eden: translateName('Eden', userId),
            Adele: translateName('Adele', userId),
            Emma: translateName('Emma', userId)
        });
        
        if (isAdmin) {
            // Admin gets everything
            helpMessage += t(userId, 'help_queue_commands') + t(userId, 'help_queue_explanation') +
                          t(userId, 'help_swapping') + t(userId, 'help_swapping_explanation') +
                          t(userId, 'help_punishment') + t(userId, 'help_punishment_explanation') +
                          t(userId, 'help_admin_features') + t(userId, 'help_admin_explanation') +
                          t(userId, 'help_tie_breaker', {
                              Eden: translateName('Eden', userId),
                              Adele: translateName('Adele', userId),
                              Emma: translateName('Emma', userId)
                          }) + t(userId, 'help_tip');
        } else if (isAuthorized) {
            // Authorized users get queue commands but no admin features
            helpMessage += t(userId, 'help_queue_commands') + t(userId, 'help_queue_explanation') +
                          t(userId, 'help_swapping') + t(userId, 'help_swapping_explanation') +
                          t(userId, 'help_punishment') + t(userId, 'help_punishment_explanation') +
                          t(userId, 'help_tie_breaker', {
                              Eden: translateName('Eden', userId),
                              Adele: translateName('Adele', userId),
                              Emma: translateName('Emma', userId)
                          });
        } else {
            // Non-authorized users get basic info only
            helpMessage += t(userId, 'help_basic_info') || '\n💡 **Basic Information:**\n• This bot manages dishwasher turns for authorized users\n• Contact an admin to get authorized for queue commands\n• Use `/start` to begin using the bot\n\n';
        }
        
        sendMessage(chatId, helpMessage);
        
    } else if (command === '/admins' || command === 'admins') {
        if (admins.size === 0) {
            sendMessage(chatId, t(userId, 'no_admins_set'));
        } else {
            let adminList = t(userId, 'current_admins_status') + '\n\n';
            let activeCount = 0;
            let totalCount = admins.size;
            
            Array.from(admins).forEach((admin, index) => {
                // Safety check: ensure admin exists
                if (!admin) {
                    console.log(`⚠️ Warning: Empty admin found in admins`);
                    return;
                }
                
                // Check if it's a numeric ID or username
                if (/^\d+$/.test(admin)) {
                    // For numeric IDs, check if they're active by looking in adminNameToChatId
                    const isActive = adminNameToChatId.has(admin.toString());
                    if (isActive) {
                        activeCount++;
                        adminList += `• ✅ User ID: ${admin} → ${admin} → ${admin} (${t(userId, 'active_status')})\n`;
                    } else {
                        adminList += `• ⏳ User ID: ${admin} → ${admin} (${t(userId, 'needs_start')})\n`;
                    }
                } else {
                    // For usernames, check if they're active
                    const isActive = adminNameToChatId.has(admin) || (admin ? adminNameToChatId.has(admin.toLowerCase()) : false);
                    if (isActive) {
                        activeCount++;
                        adminList += `• ✅ ${addRoyalEmojiTranslated(admin, userId)} → ${admin} → ${admin} (${t(userId, 'active_status')})\n`;
                    } else {
                        adminList += `• ⏳ ${addRoyalEmojiTranslated(admin, userId)} → ${admin} (${t(userId, 'needs_start')})\n`;
                    }
                }
            });
            
            adminList += `\n${t(userId, 'status_summary')} ${activeCount}/${totalCount} ${t(userId, 'active_count')} (${totalCount - activeCount} ${t(userId, 'needs_start_count')})`;
            sendMessage(chatId, adminList);
        }
        
    } else if (command === '/users' || command === 'users') {
        if (authorizedUsers.size === 0) {
            sendMessage(chatId, t(userId, 'no_authorized_users', {
                Eden: translateName('Eden', userId),
                Adele: translateName('Adele', userId),
                Emma: translateName('Emma', userId)
            }));
        } else {
            let userList = t(userId, 'authorized_and_active_users') + '\n\n';
            let activeCount = 0;
            let totalCount = authorizedUsers.size;
            
            authorizedUsers.forEach(user => {
                // Check if user is active (has pressed /start)
                const isActive = userChatIds.has(user) || (user ? userChatIds.has(user.toLowerCase()) : false);
                
                // Safety check: ensure user exists
                if (!user) {
                    console.log(`⚠️ Warning: Empty user found in authorizedUsers`);
                    return;
                }
                
                if (isActive) {
                    activeCount++;
                    userList += `• ✅ ${user} → ${user} → ${user} (${t(userId, 'active_status')})\n`;
                } else {
                    userList += `• ⏳ ${user} → ${user} (${t(userId, 'needs_start')})\n`;
                }
            });
            
            userList += `\n${t(userId, 'status_summary')} ${activeCount}/${totalCount} ${t(userId, 'active_count')} (${totalCount - activeCount} ${t(userId, 'needs_start_count')})`;
            userList += `\n📝 **Note:** Maximum 3 authorized users allowed.`;
            sendMessage(chatId, userList);
        }
        
    } else if (command === '/assist') {
        // Admin assist command - logs action without affecting queue (no description needed)
        const isAdmin = isUserAdmin(userName, userId);
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        // Use default description
        const description = "Dishwasher cleaned by admin";
        
        // Check for rapid ASSIST activity (30 minutes) - global tracking
        const now = Date.now();
        const lastGlobalDone = global.lastDishwasherDone;
        
        if (lastGlobalDone && (now - lastGlobalDone) < 30 * 60 * 1000) { // 30 minutes
            const lastDoneTime = new Date(lastGlobalDone).toLocaleString();
            // Send alert for ANY ASSIST within 30 minutes of last dishwasher completion
            alertAdminsAboutCheating(userId, userName, 'rapid_done', { lastDone: lastDoneTime });
            console.log(`🚨 RAPID ASSIST DETECTED: ${userName} (${userId}) - Last dishwasher done: ${lastDoneTime}`);
        }
        
        // Update global dishwasher completion timestamp
        global.lastDishwasherDone = now;
        
        // Mark that dishwasher was completed (cancel auto-alert)
        global.dishwasherCompleted = true;
        global.dishwasherStarted = false; // Reset for next cycle
        global.dishwasherStartedAt = null; // Clear timer timestamp
        
        // Save dishwasher state to database
        await db.saveBotState('dishwasherCompleted', true);
        await db.saveBotState('dishwasherStarted', false);
        await db.saveBotState('dishwasherStartedAt', null);
        
        if (global.dishwasherAutoAlertTimer) {
            clearTimeout(global.dishwasherAutoAlertTimer);
            global.dishwasherAutoAlertTimer = null;
        }
        
        // Track the assist action for monthly statistics
        trackMonthlyAction('admin_assist', null, userName);
        
        // Save bot data after tracking
        await saveBotData();
        
        // Send confirmation message
        const timeString = new Date().toLocaleString();
        const currentUser = getCurrentTurnUser();
        const assistMessage = t(userId, 'assist_logged', {
            description: description,
            admin: translateName(userName, userId),
            time: timeString,
            currentUser: translateName(currentUser, userId)
        });
        
        // Send confirmation to admin immediately
        sendMessage(chatId, assistMessage);
        
        // Notify all authorized users and admins immediately
        [...authorizedUsers, ...admins].forEach(user => {
            let userChatId = userChatIds.get(user) || (user ? userChatIds.get(user.toLowerCase()) : null);
            
            // If not found in userChatIds, check if this user is an admin
            if (!userChatId && isUserAdmin(user)) {
                userChatId = adminNameToChatId.get(user) || (user ? adminNameToChatId.get(user.toLowerCase()) : null);
            }
            
            if (userChatId && userChatId !== chatId) {
                const recipientUserId = getUserIdFromChatId(userChatId);
                
                // Translate description to recipient's language
                const translatedDescription = translateDescription(description, recipientUserId);
                
                const userAssistMessage = t(recipientUserId, 'assist_logged', {
                    description: translatedDescription,
                    admin: translateName(userName, recipientUserId),
                    time: timeString,
                    currentUser: translateName(currentUser, recipientUserId)
                });
                
                console.log(`🔔 Sending admin assist notification to ${user} (${userChatId}, userId: ${recipientUserId})`);
                sendMessage(userChatId, userAssistMessage);
            }
        });
        
        console.log(`🤝 Admin assist logged: ${userName} - ${description}`);
        
    } else if (command && command.startsWith('/addadmin ')) {
        const userToAdd = getFirstName(command.replace('/addadmin ', '').trim()); // Normalize to first name only
        
        if (!userToAdd) {
            sendMessage(chatId, t(userId, 'usage_addadmin'));
            return;
        }
        
        // Check if this is the first admin (no existing admins)
        if (admins.size === 0) {
            // First admin can add themselves or anyone
            admins.add(userToAdd);
            
            // Save bot data after adding first admin
            await saveBotData();
            
            // Note: We don't add chatId here because we don't know the new admin's chat ID yet
            // The new admin's chat ID will be stored when they send /start or interact with the bot
            sendMessage(chatId, t(userId, 'first_admin_added', {user: translateName(userToAdd, userId)}));
            return;
        }
        
        // If there are existing admins, check if current user is an admin
        if (!isUserAdmin(userName, userId)) {
            sendMessage(chatId, t(userId, 'not_authorized_queue_commands', {user: userName}));
            return;
        }
        
        // Prevent self-promotion for existing admins
        if ((userToAdd && userName && userToAdd.toLowerCase() === userName.toLowerCase()) || userToAdd === userId.toString()) {
            sendMessage(chatId, t(userId, 'cannot_add_yourself_admin', {user: userName}));
            return;
        }
        
        // Add the new admin
        admins.add(userToAdd);
        
        // Save bot data after adding admin
        await saveBotData();
        
        // Note: We don't add chatId here because we don't know the new admin's chat ID yet
        // The new admin's chat ID will be stored when they send /start or interact with the bot
        sendMessage(chatId, t(userId, 'admin_added', {user: translateName(userToAdd, userId)}));
        
    } else if (command && command.startsWith('/removeadmin ')) {
        // Check if user is already an admin
        if (!isUserAdmin(userName, userId)) {
            sendMessage(chatId, t(userId, 'admin_access_required_simple', {user: translateName(userName, userId)}));
            return;
        }
        
        const userToRemove = command ? command.replace('/removeadmin ', '').trim() : '';
        if (userToRemove) {
            // Prevent self-removal (security protection)
            if ((userToRemove && userName && userToRemove.toLowerCase() === userName.toLowerCase()) || userToRemove === userId.toString()) {
                sendMessage(chatId, t(userId, 'cannot_remove_yourself_admin', {user: userName}));
                return;
            }
            
            // Check if user exists in admins
            if (isUserAdmin(userToRemove)) {
                // Find and remove the actual admin entry (case-insensitive)
                for (const admin of admins) {
                    if (admin && userToRemove && admin.toLowerCase() === userToRemove.toLowerCase()) {
                        admins.delete(admin);
                        break;
                    }
                }
                
                // Save bot data after removing admin
                await saveBotData();
                
                sendMessage(chatId, t(userId, 'admin_removed', {user: translateName(userToRemove, userId)}));
            } else {
                sendMessage(chatId, t(userId, 'user_not_found_admin', {user: translateName(userToRemove, userId)}));
            }
        } else {
            sendMessage(chatId, t(userId, 'usage_removeadmin'));
        }
        
    } else if (command && command.startsWith('/removeuser ')) {
        // Check if user is admin
        if (!isUserAdmin(userName, userId)) {
            sendMessage(chatId, t(userId, 'admin_access_required_simple', {user: translateName(userName, userId)}));
            return;
        }
        
        const userToRemove = command ? command.replace('/removeuser ', '').trim() : '';
        if (!userToRemove) {
            sendMessage(chatId, t(userId, 'usage_removeuser'));
            return;
        }
        
        // Check if user exists in authorized users
        if (!isUserAuthorized(userToRemove)) {
            sendMessage(chatId, t(userId, 'user_not_found', {user: userToRemove}));
            return;
        }
        
        // Find the actual user name (case-insensitive)
        let actualUserName = null;
        for (const authorizedUser of authorizedUsers) {
            if (authorizedUser && userToRemove && authorizedUser.toLowerCase() === userToRemove.toLowerCase()) {
                actualUserName = authorizedUser;
                break;
            }
        }
        
        if (!actualUserName) {
            sendMessage(chatId, t(userId, 'user_not_found', {user: userToRemove}));
            return;
        }
        
        // Remove user from ALL data structures
        authorizedUsers.delete(actualUserName);
        userChatIds.delete(actualUserName);
        userChatIds.delete(actualUserName.toLowerCase());
        turnOrder.delete(actualUserName);
        userScores.delete(actualUserName);
        
        // Remove from queue mappings
        userQueueMapping.delete(actualUserName);
        queueUserMapping.delete(actualUserName);
        
        // Remove from suspended users
        suspendedUsers.delete(actualUserName);
        
        // Remove from turn assignments
        turnAssignments.delete(actualUserName);
        
        // Remove from queue statistics (CRITICAL FIX!)
        queueStatistics.delete(actualUserName);
        
        // Remove from punishment turns (CRITICAL FIX!)
        punishmentTurns.delete(actualUserName);
        
        // Remove from originalQueue array (CRITICAL FIX!)
        const queueIndex = originalQueue ? originalQueue.indexOf(actualUserName) : -1;
        if (queueIndex !== -1) {
            originalQueue.splice(queueIndex, 1);
            console.log(`🗑️ Removed ${actualUserName} from originalQueue at index ${queueIndex}`);
        }
        
        // Remove from database directly
        await db.removeUser(actualUserName);
        
        // Clean up any turn assignments TO the removed user
        for (const [assigner, assignee] of turnAssignments.entries()) {
            if (assignee === actualUserName) {
                turnAssignments.delete(assigner);
            }
        }
        
        // Adjust current turn index if needed
        if (currentTurnIndex >= turnOrder.size) {
            currentTurnIndex = 0;
        }
        
        // Save bot data after removing user
        await saveBotData();
        
        sendMessage(chatId, t(userId, 'user_removed_success', {user: actualUserName}));
        
    } else if (command === '/leave' || command === '/quit') {
        // Allow users to remove themselves
        const userName = getUserName(userId);
        
        if (isUserAuthorized(userName)) {
            // Remove user from all data structures
            authorizedUsers.delete(userName);
            if (userName) {
                authorizedUsers.delete(userName.toLowerCase());
            }
            userChatIds.delete(userName);
            if (userName) {
                userChatIds.delete(userName.toLowerCase());
            }
            turnOrder.delete(userName);
            if (userName) {
                turnOrder.delete(userName.toLowerCase());
            }
            userScores.delete(userName);
            if (userName) {
                userScores.delete(userName.toLowerCase());
            }
            
            // Remove from queue statistics (CRITICAL FIX!)
            queueStatistics.delete(userName);
            
            // Remove from punishment turns (CRITICAL FIX!)
            punishmentTurns.delete(userName);
            
            // Remove from originalQueue array (CRITICAL FIX!)
            const queueIndex = originalQueue ? originalQueue.indexOf(userName) : -1;
            if (queueIndex !== -1) {
                originalQueue.splice(queueIndex, 1);
                console.log(`🗑️ Removed ${userName} from originalQueue at index ${queueIndex} (self-removal)`);
            }
            
            // Save bot data after self-removal
            await saveBotData();
            
            sendMessage(chatId, t(userId, 'you_removed_from_bot'));
        } else {
            sendMessage(chatId, t(userId, 'not_authorized'));
        }
        
    } else if (command === '/resetbot') {
        // Check if user is admin
        if (!isUserAdmin(userName, userId)) {
            sendMessage(chatId, t(userId, 'admin_access_required_simple', {user: translateName(userName, userId)}));
            return;
        }
        
        // Create confirmation keyboard
        const keyboard = [
            [{ text: t(userId, 'yes_reset_everything'), callback_data: 'confirm_bot_reset' }],
            [{ text: t(userId, 'cancel_reset_button'), callback_data: 'cancel_bot_reset' }]
        ];
        
        const replyMarkup = { inline_keyboard: keyboard };
        sendMessageWithButtons(chatId, t(userId, 'reset_warning'), keyboard);
        
    } else if (command && command.startsWith('admin_punishment_reason_')) {
        // Handle admin punishment reason input
        const parts = command ? command.split(' ') : [];
        const requestId = parts.length > 0 ? parseInt(parts[0].replace('admin_punishment_reason_', '')) : 0;
        const reason = parts.length > 1 ? parts.slice(1).join(' ') : '';
        
        const punishmentRequest = pendingPunishments.get(requestId);
        if (!punishmentRequest) {
            sendMessage(chatId, t(userId, 'punishment_request_expired'));
            return;
        }
        
        if (punishmentRequest.fromUserId !== chatId) {
            sendMessage(chatId, t(userId, 'not_your_punishment'));
            return;
        }
        
        // Apply punishment directly (admin doesn't need approval)
        await applyPunishment(punishmentRequest.targetUser, reason, userName);
        
        sendMessage(chatId, `${t(userId, 'punishment_applied')}\n\n${t(userId, 'target_user')} ${translateName(punishmentRequest.targetUser, userId)}\n${t(userId, 'reason')} ${translateReason(reason, userId)}\n${t(userId, 'applied_by')} ${translateName(userName, userId)}`);
        
        // Remove request
        pendingPunishments.delete(requestId);
        
    } else if (command && command.startsWith('/authorize ')) {
        // Check if user is an admin
        if (!isUserAdmin(userName, userId)) {
            sendMessage(chatId, t(userId, 'admin_access_required_authorize', {user: userName}));
            return;
        }
        
        const userToAuth = getFirstName(command ? command.replace('/authorize ', '').trim() : ''); // Normalize to first name only
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
                    // Store only the canonical name (first name only)
                    authorizedUsers.add(userToAuth);
                    
                    // PHASE 2: Track bot state changes
                    dirtyKeys.add('authorizedUsers');
                    isDirty = true;
                    
                    userQueueMapping.set(userToAuth, queueMember);
                    queueUserMapping.set(queueMember, userToAuth);
                    
                    // Save bot data after authorization
                    await saveBotData();
                    
                    // PHASE 3: Trigger non-blocking critical save for immediate persistence
                    await saveCriticalData();
                    
                    // Store chat ID for notifications (we'll need to get this from the user when they interact)
                    // For now, we'll store it when they send /start
                    sendMessage(chatId, `${t(userId, 'user_authorized')}\n\n👥 ${userToAuth} → ${queueMember}\n\n${t(userId, 'total_authorized')} ${authorizedUsers.size}/3`);
                } else {
                    sendMessage(chatId, t(userId, 'user_not_in_queue', {
                        Eden: translateName('Eden', userId),
                        Adele: translateName('Adele', userId),
                        Emma: translateName('Emma', userId)
                    }));
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
async function applyPunishment(targetUser, reason, appliedBy) {
    // In the new score-based system, punishment = subtract 3 from score
    // This makes them scheduled sooner (they have fewer turns performed)
    const currentScore = userScores.get(targetUser) || 0;
    userScores.set(targetUser, currentScore - 3);
    
    console.log(`⚖️ Punishment applied to ${targetUser}: ${currentScore} → ${currentScore - 3}`);
    
    // Track punishment for monthly report
    trackMonthlyAction('punishment_received', targetUser, null, 1);
    trackMonthlyAction('admin_punishment', targetUser, appliedBy);
    
    // Track punishment for statistics
    const punishmentCount = (userPunishments.get(targetUser)?.punishmentCount || 0) + 1;
    const endDate = new Date(Date.now() + (3 * 24 * 60 * 60 * 1000)); // 3 days from now
    
    userPunishments.set(targetUser, {
        punishmentCount: punishmentCount,
        extraTurns: 3,
        endDate: endDate
    });
    
    // Save to database
    await saveBotData();
    
    // Get current turn user for display
    const currentTurnUser = getCurrentTurnUser();
    
    // Notify all users with translated messages
    [...authorizedUsers, ...admins].forEach(user => {
        // Find the canonical name for this user
        let canonicalName = user;
        for (const [canonical, queueName] of userQueueMapping.entries()) {
            if (queueName === user) {
                canonicalName = canonical;
                break;
            }
        }
        
        // Get chat ID using the canonical name
        let userChatId = userChatIds.get(canonicalName) || (canonicalName ? userChatIds.get(canonicalName.toLowerCase()) : null);
        
        // If not found in userChatIds, check if this user is an admin
        if (!userChatId && isUserAdmin(canonicalName)) {
            userChatId = adminNameToChatId.get(canonicalName) || (canonicalName ? adminNameToChatId.get(canonicalName.toLowerCase()) : null);
        }
        
        if (userChatId) {
            // Get the userId for language preference
            const recipientUserId = getUserIdFromChatId(userChatId);
            
            // Build translated message
            const message = `${t(recipientUserId, 'punishment_applied_alert')}\n\n${t(recipientUserId, 'target_user')} ${translateName(targetUser, recipientUserId)}\n${t(recipientUserId, 'reason')} ${translateReason(reason, recipientUserId)}\n${t(recipientUserId, 'applied_by')} ${translateName(appliedBy, recipientUserId)}\n\n🚫 **${t(recipientUserId, 'punishment_label')}** ${t(recipientUserId, 'punishment_score_reduced')}\n${t(recipientUserId, 'new_score')} ${currentScore - 3}\n🎯 **${t(recipientUserId, 'current_turn_label')}:** ${translateName(currentTurnUser, recipientUserId)}`;
            
            sendMessage(userChatId, message);
        }
    });
    
    console.log(`⚡ Punishment applied to ${targetUser}: ${reason} (by ${appliedBy}) - score reduced by 3`);
}

// Report user for punishment (NO strike counting)
function reportUser(targetUser, reason, reportedBy) {
    // Just notify admins about the report
    // Send to all admins with translated messages
    admins.forEach(admin => {
        // Find the canonical name for this admin
        let canonicalName = admin;
        for (const [canonical, queueName] of userQueueMapping.entries()) {
            if (queueName === admin) {
                canonicalName = canonical;
                break;
            }
        }
        
        // Get chat ID using the canonical name
        const adminChatId = userChatIds.get(canonicalName) || (canonicalName ? userChatIds.get(canonicalName.toLowerCase()) : null);
        if (adminChatId) {
            // Get the userId for language preference
            const adminUserId = getUserIdFromChatId(adminChatId) || adminChatId;
            
            // Build translated message
            const message = `📢 **${t(adminUserId, 'punishment_request_title')}**\n\n${t(adminUserId, 'target_user')} ${translateName(targetUser, adminUserId)}\n${t(adminUserId, 'reason')} ${translateReason(reason, adminUserId)}\n${t(adminUserId, 'reported_by')} ${translateName(reportedBy, adminUserId)}\n\n⚡ ${t(adminUserId, 'punishment_request_action')}`;
            
            sendMessage(adminChatId, message);
        }
    });
    
    console.log(`📢 Punishment request for ${targetUser}: ${reason} (by ${reportedBy})`);
}

// Execute approved swap
async function executeSwap(swapRequest, requestId, status) {
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
            const fromUserUserId = getUserIdFromChatId(fromUserId);
            alertAdminsAboutCheating(fromUserUserId, fromUser, 'rapid_swap', { swapCount: global.swapTimestamps.length });
            global.swapTimestamps.alertSent = true;
            console.log(`🚨 RAPID SWAP DETECTED: ${fromUser} (${fromUserUserId}) - ${global.swapTimestamps.length} swaps in 10 minutes`);
        }
    } else {
        // Reset alert flag when swap count drops below threshold
        global.swapTimestamps.alertSent = false;
    }
    
    console.log(`🔄 Executing swap: ${fromUser} ↔ ${toUser}`);
    
    // Validate users exist in original queue
    if (!originalQueue.includes(fromUser) || !originalQueue.includes(toUser)) {
        console.log(`❌ Invalid swap: users not in original queue`);
        // Notify requester
        const requesterUserId = getUserIdFromChatId(fromUserId);
        sendMessage(fromUserId, t(requesterUserId, 'swap_request_expired'));
        return;
    }
    
    // Validate that swap request is still valid (fromUser must still be current turn holder or performing user)
    // This check is important because the turn might have changed between request and approval
    const originalTurnHolder = getOriginalTurnHolder();
    const currentPerformingUser = getCurrentTurnUser();
    
    if (!originalTurnHolder || !currentPerformingUser) {
        console.log(`⚠️ No current turn holder found when validating swap. originalTurnHolder: ${originalTurnHolder}, currentPerformingUser: ${currentPerformingUser}`);
        // Notify requester
        sendMessage(fromUserId, t(getUserIdFromChatId(fromUserId), 'swap_request_expired'));
        // Remove the invalid request
        pendingSwaps.delete(requestId);
        return;
    }
    
    if (fromUser !== originalTurnHolder && fromUser !== currentPerformingUser) {
        console.log(`❌ Swap request expired: ${fromUser} is no longer the current turn`);
        // Notify both users that the swap request is no longer valid
        const requesterUserId = getUserIdFromChatId(fromUserId);
        const requesterToUser = translateName(toUser, requesterUserId) || toUser;
        const requesterCurrentUser = translateName(currentPerformingUser, requesterUserId) || currentPerformingUser;
        const requesterMessage = t(requesterUserId, 'swap_request_expired_requester', {
            toUser: requesterToUser,
            currentUser: requesterCurrentUser
        });
        if (requesterMessage && requesterMessage.trim().length > 0) {
            sendMessage(fromUserId, requesterMessage);
        }
        
        const targetUserId = getUserIdFromChatId(toUserId);
        const targetFromUser = translateName(fromUser, targetUserId) || fromUser;
        const targetCurrentUser = translateName(currentPerformingUser, targetUserId) || currentPerformingUser;
        const targetMessage = t(targetUserId, 'swap_request_expired_target', {
            fromUser: targetFromUser,
            currentUser: targetCurrentUser
        });
        if (targetMessage && targetMessage.trim().length > 0) {
            sendMessage(toUserId, targetMessage);
        }
        // Remove the expired request
        pendingSwaps.delete(requestId);
        return;
    }
    
    // In the score-based system, swap means:
    // The toUser performs the fromUser's turn (favor/debt)
    // Only the performing user's score increases
    
    // Determine the actual turn holder whose assignment will be updated
    
    // Find the original turn holder for fromUser (if they're performing someone's turn)
    let turnHolderForFromUser = fromUser;
    for (const [user, assignedTo] of turnAssignments.entries()) {
        if (assignedTo === fromUser) {
            turnHolderForFromUser = user; // fromUser is performing this user's turn
            break;
        }
    }
    
    // Determine the actual turn holder
    let actualTurnHolder = fromUser;
    if (fromUser === currentPerformingUser && fromUser !== originalTurnHolder) {
        // fromUser is performing someone else's turn - find who they're performing for
        actualTurnHolder = turnHolderForFromUser;
    }
    
    // OPTIMISTIC: Update in-memory state immediately
    // CRITICAL: Prevent circular assignments - clear any conflicting assignments first
    // Clear ALL assignments that could create circular references:
    // 1. If toUser is already assigned to perform someone's turn
    for (const [existingHolder, existingAssignee] of turnAssignments.entries()) {
        if (existingAssignee === toUser && existingHolder !== actualTurnHolder) {
            // toUser is already performing someone else's turn - clear it to prevent circular assignment
            console.log(`🔄 Clearing conflicting assignment: ${existingHolder} -> ${toUser} (to prevent circular assignment)`);
            turnAssignments.delete(existingHolder);
        }
    }
    // 2. If toUser's turn is assigned to someone else (and we're assigning actualTurnHolder to toUser)
    if (turnAssignments.has(toUser) && turnAssignments.get(toUser) !== actualTurnHolder) {
        // toUser has their turn assigned to someone else - clear it to prevent circular assignment
        console.log(`🔄 Clearing conflicting assignment: ${toUser} -> ${turnAssignments.get(toUser)} (to prevent circular assignment)`);
        turnAssignments.delete(toUser);
    }
    // 3. If actualTurnHolder's turn is already assigned to toUser, clear it first (avoid duplicate)
    if (turnAssignments.has(actualTurnHolder) && turnAssignments.get(actualTurnHolder) === toUser) {
        // Already assigned correctly, but clear it first to ensure clean state
        console.log(`🔄 Clearing existing assignment: ${actualTurnHolder} -> ${toUser} (will be re-set)`);
        turnAssignments.delete(actualTurnHolder);
    }
    // 4. If actualTurnHolder is assigned to perform someone else's turn, clear that too
    for (const [existingHolder, existingAssignee] of turnAssignments.entries()) {
        if (existingAssignee === actualTurnHolder && existingHolder !== actualTurnHolder) {
            // actualTurnHolder is performing someone else's turn - this shouldn't happen, but clear it
            console.log(`🔄 Clearing unexpected assignment: ${existingHolder} -> ${actualTurnHolder} (actualTurnHolder shouldn't be performing another turn)`);
            turnAssignments.delete(existingHolder);
        }
    }
    
    // Handle swap-back: if swapping back to the original turn holder, clear the assignment
    if (toUser === actualTurnHolder) {
        // Swapping back to original holder - remove assignment
        turnAssignments.delete(actualTurnHolder);
        console.log(`🔄 Swap back: Removing assignment from ${actualTurnHolder} to ${fromUser}, now ${actualTurnHolder} performs their own turn`);
        // Mark as dirty for database save
        dirtyKeys.add('turnAssignments');
        isDirty = true;
    } else {
        // Regular swap: assign the actual turn holder to the toUser
        turnAssignments.set(actualTurnHolder, toUser);
        console.log(`🔄 Swap: ${actualTurnHolder}'s turn assigned to ${toUser}`);
        // Mark as dirty for database save
        dirtyKeys.add('turnAssignments');
        isDirty = true;
    }
    
    // OPTIMISTIC: Send notifications immediately (swap is logically done)
    // After the swap, the current turn is performed by toUser (or actualTurnHolder if swap-back)
    const currentTurnUser = (toUser === actualTurnHolder) ? actualTurnHolder : toUser;

    // Get user IDs for translation
    const fromUserUserId = getUserIdFromChatId(fromUserId);
    const toUserUserId = getUserIdFromChatId(toUserId);

    // Notify both users in their language
    let fromUserMessage;
    let toUserMessage;
    if (toUser === actualTurnHolder) {
        // Swap back - actualTurnHolder performs their own turn
        fromUserMessage = `✅ **${t(fromUserUserId, 'swap_completed')}**\n\n🔄 **${translateName(actualTurnHolder, fromUserUserId)} ${t(fromUserUserId, 'assigned_to_perform')} ${translateName(actualTurnHolder, fromUserUserId)} ${t(fromUserUserId, 'turn')}** (Swap back)\n\n🎯 **${t(fromUserUserId, 'current_turn_label')}:** ${translateName(currentTurnUser, fromUserUserId)}`;
        toUserMessage = `✅ **${t(toUserUserId, 'swap_completed')}**\n\n🔄 **${translateName(actualTurnHolder, toUserUserId)} ${t(toUserUserId, 'assigned_to_perform')} ${translateName(actualTurnHolder, toUserUserId)} ${t(toUserUserId, 'turn')}** (Swap back)\n\n🎯 **${t(toUserUserId, 'current_turn_label')}:** ${translateName(currentTurnUser, toUserUserId)}`;
    } else {
        // Regular swap - toUser is now performing the turn
        fromUserMessage = `✅ **${t(fromUserUserId, 'swap_completed')}**\n\n🔄 **${translateName(toUser, fromUserUserId)} ${t(fromUserUserId, 'assigned_to_perform')} ${translateName(actualTurnHolder, fromUserUserId)} ${t(fromUserUserId, 'turn')}**\n\n🎯 **${t(fromUserUserId, 'current_turn_label')}:** ${translateName(currentTurnUser, fromUserUserId)}`;
        toUserMessage = `✅ **${t(toUserUserId, 'swap_completed')}**\n\n🔄 **${translateName(toUser, toUserUserId)} ${t(toUserUserId, 'assigned_to_perform')} ${translateName(actualTurnHolder, toUserUserId)} ${t(toUserUserId, 'turn')}**\n\n🎯 **${t(toUserUserId, 'current_turn_label')}:** ${translateName(currentTurnUser, toUserUserId)}`;
    }
    
    sendMessage(fromUserId, fromUserMessage);
    sendMessage(toUserId, toUserMessage);
    
    // Notify all other authorized users and admins using userChatIds in their language
    [...authorizedUsers, ...admins].forEach(user => {
        if (user !== fromUser && user !== toUser) {
            let userChatId = userChatIds.get(user) || (user ? userChatIds.get(user.toLowerCase()) : null);
            
            // If not found in userChatIds, check if this user is an admin
            if (!userChatId && isUserAdmin(user)) {
                userChatId = adminNameToChatId.get(user) || (user ? adminNameToChatId.get(user.toLowerCase()) : null);
            }
            
            if (userChatId) {
                // Get the correct userId for language preference
                const recipientUserId = getUserIdFromChatId(userChatId);
                
                // Create swap notification in recipient's language
                let swapNotification;
                if (toUser === actualTurnHolder) {
                    swapNotification = `🔄 **${t(recipientUserId, 'queue_update')}:** ${translateName(actualTurnHolder, recipientUserId)} ↔ ${translateName(actualTurnHolder, recipientUserId)} (Swap back)`;
                } else {
                    swapNotification = `🔄 **${t(recipientUserId, 'queue_update')}:** ${translateName(toUser, recipientUserId)} ${t(recipientUserId, 'assigned_to_perform')} ${translateName(actualTurnHolder, recipientUserId)} ${t(recipientUserId, 'turn')}`;
                }
                console.log(`🔔 Sending swap approval notification to ${user} (${userChatId}, userId: ${recipientUserId})`);
                sendMessage(userChatId, swapNotification);
            } else {
                console.log(`🔔 No chat ID found for ${user}`);
            }
        }
    });
    
    // Save to database
    await saveBotData();
    
    // Remove the request
    pendingSwaps.delete(requestId);
}

// Handle callback queries (button presses)
async function handleCallback(chatId, userId, userName, data) {
    try {
    console.log(`🔘 Button pressed: "${data}" by ${userName}`);
    
    if (data === 'test') {
        sendMessage(chatId, t(userId, 'test_button_works', {user: userName, userId: userId, data: data}));
    } else if (data === 'status') {
        await handleCommand(chatId, userId, userName, 'status');
    } else if (data === 'done') {
        await handleCommand(chatId, userId, userName, 'done');
    } else if (data === 'users') {
        await handleCommand(chatId, userId, userName, 'users');
    } else if (data === 'admins') {
        await handleCommand(chatId, userId, userName, 'admins');
    } else if (data === 'help') {
        await handleCommand(chatId, userId, userName, 'help');
    } else if (data === 'confirm_bot_reset') {
        // Check if user is admin
        const isAdmin = isUserAdmin(userName, userId);
        
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        // Clear all data
        authorizedUsers.clear();
        admins.clear();
        userChatIds.clear();
        adminChatIds.clear();
        turnOrder.clear();
        userScores.clear();
        suspendedUsers.clear();
        turnAssignments.clear();
        currentTurnIndex = 0;
        
        // Clear global variables
        global.swapTimestamps = [];
        global.doneTimestamps = new Map();
        
        // Clear ALL database data (CRITICAL FIX!)
        await db.clearAllData();
        
        // Save empty state
        await saveBotData();
        
        sendMessage(chatId, t(userId, 'bot_reset_success'));
        
    } else if (data === 'cancel_bot_reset') {
        sendMessage(chatId, t(userId, 'reset_cancelled'));
        
    } else if (data === 'remove_user_menu') {
        // Check if user is admin
        const isAdmin = isUserAdmin(userName, userId);
        
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        // Show user list for removal
        const userList = Array.from(authorizedUsers);
        if (userList.length === 0) {
            sendMessage(chatId, t(userId, 'no_authorized_users_to_remove', {
                Eden: translateName('Eden', userId),
                Adele: translateName('Adele', userId),
                Emma: translateName('Emma', userId)
            }));
            return;
        }
        
        const keyboard = userList.map(user => {
            // Extract first name and normalize to match royalEmojis keys
            const firstName = user ? user.split(' ')[0] : ''; // Get first name only
            const normalizedUser = firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase() : '';
            return [{
                text: addRoyalEmojiTranslated(normalizedUser, userId),
                callback_data: `remove_user_${user}`
            }];
        });
        
        const replyMarkup = { inline_keyboard: keyboard };
        sendMessageWithButtons(chatId, t(userId, 'user_management_title'), keyboard);
        
    } else if (data.startsWith('remove_user_')) {
        // Check if user is admin
        const isAdmin = isUserAdmin(userName, userId);
        
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        const targetUser = data ? data.replace('remove_user_', '') : '';
        
        // Check if user exists in authorized users
        if (!isUserAuthorized(targetUser)) {
            sendMessage(chatId, t(userId, 'user_not_found', {user: targetUser}));
            return;
        }
        
        // Find the actual user name (case-insensitive)
        let actualUserName = null;
        for (const authorizedUser of authorizedUsers) {
            if (authorizedUser.toLowerCase() === targetUser.toLowerCase()) {
                actualUserName = authorizedUser;
                break;
            }
        }
        
        if (!actualUserName) {
            sendMessage(chatId, t(userId, 'user_not_found', {user: targetUser}));
            return;
        }
        
        // Remove user from ALL data structures
        authorizedUsers.delete(actualUserName);
        userChatIds.delete(actualUserName);
        userChatIds.delete(actualUserName.toLowerCase());
        turnOrder.delete(actualUserName);
        userScores.delete(actualUserName);
        
        // Remove from queue mappings
        userQueueMapping.delete(actualUserName);
        queueUserMapping.delete(actualUserName);
        
        // Remove from suspended users
        suspendedUsers.delete(actualUserName);
        
        // Remove from turn assignments
        turnAssignments.delete(actualUserName);
        
        // Remove from queue statistics (CRITICAL FIX!)
        queueStatistics.delete(actualUserName);
        
        // Remove from punishment turns (CRITICAL FIX!)
        punishmentTurns.delete(actualUserName);
        
        // Remove from originalQueue array (CRITICAL FIX!)
        const queueIndex = originalQueue ? originalQueue.indexOf(actualUserName) : -1;
        if (queueIndex !== -1) {
            originalQueue.splice(queueIndex, 1);
            console.log(`🗑️ Removed ${actualUserName} from originalQueue at index ${queueIndex}`);
        }
        
        // Remove from database directly
        await db.removeUser(actualUserName);
        
        // Clean up any turn assignments TO the removed user
        for (const [assigner, assignee] of turnAssignments.entries()) {
            if (assignee === actualUserName) {
                turnAssignments.delete(assigner);
            }
        }
        
        // Adjust current turn index if needed
        if (currentTurnIndex >= turnOrder.size) {
            currentTurnIndex = 0;
        }
        
        // Save bot data after removing user
        await saveBotData();
        
        // Update the message
        sendMessage(chatId, t(userId, 'user_removed_success', {user: actualUserName}));
        
    } else if (data === 'reset_bot_menu') {
        // Check if user is admin
        const isAdmin = isUserAdmin(userName, userId);
        
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        // Production: no debug version info
        
        // Create confirmation keyboard
        const keyboard = [
            [{ text: t(userId, 'yes_reset_everything'), callback_data: 'confirm_bot_reset' }],
            [{ text: t(userId, 'cancel_reset_button'), callback_data: 'cancel_bot_reset' }]
        ];
        
        const replyMarkup = { inline_keyboard: keyboard };
        sendMessageWithButtons(chatId, t(userId, 'reset_warning'), keyboard);
        
    } else if (data === 'leave_bot') {
        // Allow users to remove themselves with debt protection
        const userName = getUserName(userId);
        
        // Check if user is authorized OR admin
        const isAuthorized = isUserAuthorized(userName);
        const isAdmin = isUserAdmin(userName, userId);
        
        if (isAuthorized || isAdmin) {
            if (isAdmin) {
                // Admin trying to leave - check if they're the last admin
                if (admins.size <= 1) {
                    sendMessage(chatId, t(userId, 'last_admin_cannot_leave'));
                    return;
                }
                
                // Admins can leave without debt check - show confirmation directly
                const keyboard = [
                    [{ text: t(userId, 'yes_leave_bot'), callback_data: 'confirm_leave' }],
                    [{ text: t(userId, 'cancel_leave'), callback_data: 'cancel_leave' }]
                ];
                
                sendMessageWithButtons(chatId, t(userId, 'admin_leave_confirmation'), keyboard);
                return;
            }
            
            // For regular users: Check if user has debts (lower score than others)
            const userScore = userScores.get(userName) || 0;
            const allScores = Array.from(userScores.values());
            const maxScore = Math.max(...allScores);
            const minScore = Math.min(...allScores);
            
            // Skip debt check if all scores are equal (no actual debt)
            if (maxScore === minScore) {
                // All users have same score, no debt - allow leaving
            } else if (userScore < minScore + 2) { // Allow some tolerance
                const debtAmount = maxScore - userScore;
                sendMessage(chatId, t(userId, 'debt_warning', {
                    debtAmount: debtAmount,
                    userScore: userScore,
                    maxScore: maxScore
                }));
                return;
            }
            
            // User has no significant debts, allow leaving with grace period
            const keyboard = [
                [{ text: t(userId, 'yes_leave_bot'), callback_data: 'confirm_leave' }],
                [{ text: t(userId, 'cancel_leave'), callback_data: 'cancel_leave' }]
            ];
            
            const replyMarkup = { inline_keyboard: keyboard };
            sendMessageWithButtons(chatId, t(userId, 'leave_confirmation', {
                userScore: userScore
            }), keyboard);
        } else {
            sendMessage(chatId, t(userId, 'not_authorized'));
        }
        
    } else if (data === 'confirm_leave') {
        // Confirm self-removal with grace period
        const userName = getUserName(userId);
        const userScore = userScores.get(userName) || 0;
        
        // Initialize grace periods if not exists
        if (!global.gracePeriods) {
            global.gracePeriods = new Map();
        }
        
        // Set grace period (24 hours)
        const gracePeriodEnd = Date.now() + (24 * 60 * 60 * 1000);
        global.gracePeriods.set(userName, {
            score: userScore,
            endTime: gracePeriodEnd,
            originalScore: userScore
        });
        
        // Remove user from all data structures
        authorizedUsers.delete(userName);
        authorizedUsers.delete(userName.toLowerCase());
        userChatIds.delete(userName);
        userChatIds.delete(userName.toLowerCase());
        turnOrder.delete(userName);
        turnOrder.delete(userName.toLowerCase());
        userScores.delete(userName);
        userScores.delete(userName.toLowerCase());
        
        // Remove from queue statistics (CRITICAL FIX!)
        queueStatistics.delete(userName);
        
        // Remove from punishment turns (CRITICAL FIX!)
        punishmentTurns.delete(userName);
        
        // Remove from originalQueue array (CRITICAL FIX!)
        const queueIndex = originalQueue.indexOf(userName);
        if (queueIndex !== -1) {
            originalQueue.splice(queueIndex, 1);
            console.log(`🗑️ Removed ${userName} from originalQueue at index ${queueIndex} (grace period leave)`);
        }
        
        // If user is admin, remove admin privileges
        const isAdmin = isUserAdmin(userName, userId);
        if (isAdmin) {
            admins.delete(userName);
            admins.delete(userName.toLowerCase());
            admins.delete(userId.toString());
            adminChatIds.delete(chatId);
        }
        
        // Save bot data after self-removal
        await saveBotData();
        
        const graceEndTime = new Date(gracePeriodEnd).toLocaleString();
        sendMessage(chatId, t(userId, 'grace_period_message', {
            graceEndTime: graceEndTime,
            userScore: userScore
        }));
        
    } else if (data === 'cancel_leave') {
        sendMessage(chatId, t(userId, 'leave_cancelled'));
        
    } else if (data === 'confirm_reset_dishwasher') {
        // User confirmed reset - execute normal dishwasher started logic
        const isAdmin = isUserAdmin(userName, userId);
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        // Get current user doing the dishes using score-based system
        const currentUser = getCurrentTurnUser();
        if (!currentUser) {
            sendMessage(chatId, t(userId, 'no_one_in_queue'));
            return;
        }
        
        // Track admin announcement for monthly report
        trackMonthlyAction('admin_announcement', null, userName);
        
        // Collect all unique chat IDs to avoid duplicates
        const chatIdsToNotify = new Set();
        
        // Add adminChatIds
        adminChatIds.forEach(chatId => chatIdsToNotify.add(chatId));
        
        // Add chat IDs from authorized users who are admins
        [...authorizedUsers, ...admins].forEach(user => {
            let userChatId = userChatIds.get(user) || (user ? userChatIds.get(user.toLowerCase()) : null);
            
            // If not found in userChatIds, check if this user is an admin
            if (!userChatId && isUserAdmin(user)) {
                userChatId = adminNameToChatId.get(user) || (user ? adminNameToChatId.get(user.toLowerCase()) : null);
            }
            
            if (userChatId) {
                chatIdsToNotify.add(userChatId);
            }
        });
        
        // Send notification to each unique chat ID only once
        chatIdsToNotify.forEach(recipientChatId => {
            if (recipientChatId !== chatId) {
                // Get the correct userId for language preference
                const recipientUserId = getUserIdFromChatId(recipientChatId);
                
                // Create started message in recipient's language
                const startedMessage = t(recipientUserId, 'dishwasher_started_message', {user: translateName(currentUser, recipientUserId), sender: translateName(userName, recipientUserId)});
                console.log(`🔔 Sending dishwasher started notification to chat ID: ${recipientChatId} (userId: ${recipientUserId})`);
                sendMessage(recipientChatId, startedMessage);
            }
        });
        
        // Clear any existing auto-alert timer
        if (global.dishwasherAutoAlertTimer) {
            clearTimeout(global.dishwasherAutoAlertTimer);
            global.dishwasherAutoAlertTimer = null;
        }
        
        // Set up auto-alert timer (3 hours)
        const autoAlertTimeout = setTimeout(async () => {
            // Check if we should still send the auto-alert
            if (global.dishwasherStarted && !global.dishwasherAlertSent && !global.dishwasherCompleted) {
                // Get the CURRENT turn user (in case there was a swap)
                const currentTurnUser = getCurrentTurnUser();
                
                // Check Israeli time for night hours restriction (11pm-7am)
                const now = new Date();
                const israeliHour = parseInt(now.toLocaleString('en-US', {timeZone: 'Asia/Jerusalem', hour: 'numeric', hour12: false}));
                const israeliMinute = parseInt(now.toLocaleString('en-US', {timeZone: 'Asia/Jerusalem', minute: 'numeric'}));
                const israeliTime = israeliHour + (israeliMinute / 60);
                
                console.log(`🌙 Auto-alert time check: Israeli time is ${israeliHour}:${israeliMinute.toString().padStart(2, '0')} (${israeliTime}), isNight: ${israeliTime >= 23 || israeliTime < 7}`);
                
                // Check if it's night hours (11pm-7am Israeli time)
                if (israeliTime >= 23 || israeliTime < 7) {
                    // Night hours - reschedule for 7:15 AM Israeli time
                    const israeliNow = new Date(now.toLocaleString('en-US', {timeZone: 'Asia/Jerusalem'}));
                    const next7AM = new Date(israeliNow);
                    next7AM.setHours(7, 15, 0, 0);
                    
                    // If it's already past 7:15 AM today, schedule for tomorrow 7:15 AM
                    if (next7AM <= israeliNow) {
                        next7AM.setDate(next7AM.getDate() + 1);
                    }
                    
                    // Use Israeli-local timestamps on both sides to avoid server timezone offset skew
                    const timeUntil7AM = next7AM.getTime() - israeliNow.getTime();
                    
                    console.log(`🌙 Night hours detected (${israeliHour}:${israeliMinute.toString().padStart(2, '0')} Israeli time), rescheduling alert for 7:15 AM Israeli time`);
                    
                    // Reschedule for 7:15 AM Israeli time
                    const rescheduledTimeout = setTimeout(async () => {
                        // Check again if we should still send the auto-alert
                        if (global.dishwasherStarted && !global.dishwasherAlertSent && !global.dishwasherCompleted) {
                            // Get the CURRENT turn user (in case there was a swap or DONE executed)
                            const currentTurnUserAtAlert = getCurrentTurnUser();
                            console.log(`⏰ Auto-alert triggered after night hours delay for ${currentTurnUserAtAlert}`);
                            
                            // Send dishwasher alert to all authorized users and admins
                            [...authorizedUsers, ...admins].forEach(user => {
                                let userChatId = userChatIds.get(user) || (user ? userChatIds.get(user.toLowerCase()) : null);
                                
                                // If not found in userChatIds, check if this user is an admin
                                if (!userChatId && isUserAdmin(user)) {
                                    userChatId = adminNameToChatId.get(user) || (user ? adminNameToChatId.get(user.toLowerCase()) : null);
                                }
                                
                                if (userChatId) {
                                    // Get the correct userId for language preference
                                    const recipientUserId = getUserIdFromChatId(userChatId);
                                    
                                    const alertMessage = t(recipientUserId, 'dishwasher_alert_message', {user: translateName(currentTurnUserAtAlert, recipientUserId), sender: t(recipientUserId, 'auto_timer')});
                                    console.log(`🔔 Sending delayed auto dishwasher alert to ${user} (${userChatId}, userId: ${recipientUserId})`);
                                    sendMessage(userChatId, alertMessage);
                                }
                            });
                            
                            // Mark alert as sent
                            global.dishwasherAlertSent = true;
                            
                            // Save alert state to database
                            await db.saveBotState('dishwasherAlertSent', true);
                        }
                    }, timeUntil7AM);
                    
                    // Store rescheduled timer reference for potential cleanup
                    global.dishwasherAutoAlertTimer = rescheduledTimeout;
                    
                    return; // Don't send now
                }
                
                // Day hours - send immediately
                console.log(`⏰ Auto-alert triggered after 3 hours for ${currentTurnUser}`);
                
                // Send dishwasher alert to all authorized users and admins
                [...authorizedUsers, ...admins].forEach(user => {
                    let userChatId = userChatIds.get(user) || (user ? userChatIds.get(user.toLowerCase()) : null);
                    
                    // If not found in userChatIds, check if this user is an admin
                    if (!userChatId && isUserAdmin(user)) {
                        userChatId = adminNameToChatId.get(user) || (user ? adminNameToChatId.get(user.toLowerCase()) : null);
                    }
                    
                    if (userChatId) {
                        // Get the correct userId for language preference
                        const recipientUserId = getUserIdFromChatId(userChatId);
                        
                        const alertMessage = t(recipientUserId, 'dishwasher_alert_message', {user: translateName(currentTurnUser, recipientUserId), sender: t(recipientUserId, 'auto_timer')});
                        console.log(`🔔 Sending auto dishwasher alert to ${user} (${userChatId}, userId: ${recipientUserId})`);
                        sendMessage(userChatId, alertMessage);
                    }
                });
                
                // Mark alert as sent
                global.dishwasherAlertSent = true;
                
                // Save alert state to database
                await db.saveBotState('dishwasherAlertSent', true);
            }
        }, 3 * 60 * 60 * 1000); // 3 hours in milliseconds
        
        // Store timer reference for potential cleanup
        global.dishwasherAutoAlertTimer = autoAlertTimeout;
        
        // Mark dishwasher as started
        global.dishwasherStarted = true;
        global.dishwasherAlertSent = false;
        global.dishwasherCompleted = false;
        global.dishwasherStartedAt = Date.now(); // Save timestamp for timer restoration
        
        // Save dishwasher state to database for persistence across restarts
        await db.saveBotState('dishwasherStarted', true);
        await db.saveBotState('dishwasherAlertSent', false);
        await db.saveBotState('dishwasherCompleted', false);
        await db.saveBotState('dishwasherStartedAt', global.dishwasherStartedAt);
        
        // Send confirmation to admin
        sendMessage(chatId, `${t(userId, 'dishwasher_started_sent')}\n\n${t(userId, 'alerted_user')} ${translateName(currentUser, userId)}\n${t(userId, 'sent_to_all')}`);
        
    } else if (data === 'cancel_reset_dishwasher') {
        // User cancelled reset - do nothing
        sendMessage(chatId, t(userId, 'reset_cancelled'));
        
    } else if (data === 'dishwasher_alert') {
        // Check if this is an admin
        const isAdmin = isUserAdmin(userName, userId);
        
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        // Get current turn user using score-based system
        const currentUser = getCurrentTurnUser();
        if (!currentUser) {
            sendMessage(chatId, t(userId, 'no_one_in_queue'));
            return;
        }
        
        // Track admin announcement for monthly report
        trackMonthlyAction('admin_announcement', null, userName);
        
        // Collect all unique chat IDs to avoid duplicates
        const chatIdsToNotify = new Set();
        
        // Add adminChatIds
        adminChatIds.forEach(chatId => chatIdsToNotify.add(chatId));
        
        // Add chat IDs from authorized users who are admins
        [...authorizedUsers, ...admins].forEach(user => {
            let userChatId = userChatIds.get(user) || (user ? userChatIds.get(user.toLowerCase()) : null);
            
            // If not found in userChatIds, check if this user is an admin
            if (!userChatId && isUserAdmin(user)) {
                userChatId = adminNameToChatId.get(user) || (user ? adminNameToChatId.get(user.toLowerCase()) : null);
            }
            
            if (userChatId) {
                chatIdsToNotify.add(userChatId);
            }
        });
        
        // Send alert to each unique chat ID only once
        chatIdsToNotify.forEach(recipientChatId => {
            if (recipientChatId !== chatId) {
                // Get the correct userId for language preference
                const recipientUserId = getUserIdFromChatId(recipientChatId);
                
                // Create alert message in recipient's language
                const alertMessage = t(recipientUserId, 'dishwasher_alert_message', {user: translateName(currentUser, recipientUserId), sender: translateName(userName, recipientUserId)});
                console.log(`🔔 Sending dishwasher alert to chat ID: ${recipientChatId} (userId: ${recipientUserId})`);
                sendMessage(recipientChatId, alertMessage);
            }
        });
        
        // Send confirmation to admin
        sendMessage(chatId, `${t(userId, 'dishwasher_alert_sent')}\n\n${t(userId, 'alerted_user')} ${translateName(currentUser, userId)}\n${t(userId, 'sent_to_all')}`);
        
        // Mark that manual alert was sent and clear auto-alert timer
        global.dishwasherAlertSent = true;
        if (global.dishwasherAutoAlertTimer) {
            clearTimeout(global.dishwasherAutoAlertTimer);
            global.dishwasherAutoAlertTimer = null;
        }
        
    } else if (data === 'dishwasher_started') {
        // Check if this is an admin
        const isAdmin = isUserAdmin(userName, userId);
        
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        // Check if dishwasher is already running and not completed
        if (global.dishwasherStarted && !global.dishwasherCompleted) {
            // Case 1: Within 3 hours (alert not sent yet)
            // Case 2: After 3 hours (alert already sent)
            const isCase2 = global.dishwasherAlertSent;
            
            let confirmMessage;
            let buttonText;
            
            if (isCase2) {
                // Case 2: Alert was already sent - starting new cycle
                confirmMessage = t(userId, 'dishwasher_finished_not_done');
                buttonText = t(userId, 'yes_start_new');
            } else {
                // Case 1: Timer still running - reset timer
                confirmMessage = t(userId, 'dishwasher_already_running');
                buttonText = t(userId, 'yes_reset_timer');
            }
            
            const buttons = [
                [{ text: buttonText, callback_data: 'confirm_reset_dishwasher' }],
                [{ text: t(userId, 'cancel'), callback_data: 'cancel_reset_dishwasher' }]
            ];
            
            sendMessageWithButtons(chatId, confirmMessage, buttons);
            return; // Don't proceed with normal logic
        }
        
        // Get current user doing the dishes using score-based system
        const currentUser = getCurrentTurnUser();
        if (!currentUser) {
            sendMessage(chatId, t(userId, 'no_one_in_queue'));
            return;
        }
        
        // Track admin announcement for monthly report
        trackMonthlyAction('admin_announcement', null, userName);
        
        // Collect all unique chat IDs to avoid duplicates
        const chatIdsToNotify = new Set();
        
        // Add adminChatIds
        adminChatIds.forEach(chatId => chatIdsToNotify.add(chatId));
        
        // Add chat IDs from authorized users who are admins
        [...authorizedUsers, ...admins].forEach(user => {
            let userChatId = userChatIds.get(user) || (user ? userChatIds.get(user.toLowerCase()) : null);
            
            // If not found in userChatIds, check if this user is an admin
            if (!userChatId && isUserAdmin(user)) {
                userChatId = adminNameToChatId.get(user) || (user ? adminNameToChatId.get(user.toLowerCase()) : null);
            }
            
            if (userChatId) {
                chatIdsToNotify.add(userChatId);
            }
        });
        
        // Send notification to each unique chat ID only once
        chatIdsToNotify.forEach(recipientChatId => {
            if (recipientChatId !== chatId) {
                // Get the correct userId for language preference
                const recipientUserId = getUserIdFromChatId(recipientChatId);
                
                // Create started message in recipient's language
                const startedMessage = t(recipientUserId, 'dishwasher_started_message', {user: translateName(currentUser, recipientUserId), sender: translateName(userName, recipientUserId)});
                console.log(`🔔 Sending dishwasher started notification to chat ID: ${recipientChatId} (userId: ${recipientUserId})`);
                sendMessage(recipientChatId, startedMessage);
            }
        });
        
        // Clear any existing auto-alert timer
        if (global.dishwasherAutoAlertTimer) {
            clearTimeout(global.dishwasherAutoAlertTimer);
            global.dishwasherAutoAlertTimer = null;
        }
        
        // Set up auto-alert timer (3 hours)
        const autoAlertTimeout = setTimeout(async () => {
            // Check if we should still send the auto-alert
            if (global.dishwasherStarted && !global.dishwasherAlertSent && !global.dishwasherCompleted) {
                // Get the CURRENT turn user (in case there was a swap)
                const currentTurnUser = getCurrentTurnUser();
                
                // Check Israeli time for night hours restriction (11pm-7am)
                const now = new Date();
                const israeliHour = parseInt(now.toLocaleString('en-US', {timeZone: 'Asia/Jerusalem', hour: 'numeric', hour12: false}));
                const israeliMinute = parseInt(now.toLocaleString('en-US', {timeZone: 'Asia/Jerusalem', minute: 'numeric'}));
                const israeliTime = israeliHour + (israeliMinute / 60);
                
                console.log(`🌙 Auto-alert time check: Israeli time is ${israeliHour}:${israeliMinute.toString().padStart(2, '0')} (${israeliTime}), isNight: ${israeliTime >= 23 || israeliTime < 7}`);
                
                // Check if it's night hours (11pm-7am Israeli time)
                if (israeliTime >= 23 || israeliTime < 7) {
                    // Night hours - reschedule for 7:15 AM Israeli time
                    const israeliNow = new Date(now.toLocaleString('en-US', {timeZone: 'Asia/Jerusalem'}));
                    const next7AM = new Date(israeliNow);
                    next7AM.setHours(7, 15, 0, 0);
                    
                    // If it's already past 7:15 AM today, schedule for tomorrow 7:15 AM
                    if (next7AM <= israeliNow) {
                        next7AM.setDate(next7AM.getDate() + 1);
                    }
                    
                    // Use Israeli-local timestamps on both sides to avoid server timezone offset skew
                    const timeUntil7AM = next7AM.getTime() - israeliNow.getTime();
                    
                    console.log(`🌙 Night hours detected (${israeliHour}:${israeliMinute.toString().padStart(2, '0')} Israeli time), rescheduling alert for 7:15 AM Israeli time`);
                    
                    // Reschedule for 7:15 AM Israeli time
                    const rescheduledTimeout = setTimeout(async () => {
                        // Check again if we should still send the auto-alert
                        if (global.dishwasherStarted && !global.dishwasherAlertSent && !global.dishwasherCompleted) {
                            // Get the CURRENT turn user (in case there was a swap or DONE executed)
                            const currentTurnUserAtAlert = getCurrentTurnUser();
                            console.log(`⏰ Auto-alert triggered after night hours delay for ${currentTurnUserAtAlert}`);
                            
                            // Send dishwasher alert to all authorized users and admins
                            [...authorizedUsers, ...admins].forEach(user => {
                                let userChatId = userChatIds.get(user) || (user ? userChatIds.get(user.toLowerCase()) : null);
                                
                                // If not found in userChatIds, check if this user is an admin
                                if (!userChatId && isUserAdmin(user)) {
                                    userChatId = adminNameToChatId.get(user) || (user ? adminNameToChatId.get(user.toLowerCase()) : null);
                                }
                                
                                if (userChatId) {
                                    // Get the correct userId for language preference
                                    const recipientUserId = getUserIdFromChatId(userChatId);
                                    
                                    const alertMessage = t(recipientUserId, 'dishwasher_alert_message', {user: translateName(currentTurnUserAtAlert, recipientUserId), sender: t(recipientUserId, 'auto_timer')});
                                    console.log(`🔔 Sending delayed auto dishwasher alert to ${user} (${userChatId}, userId: ${recipientUserId})`);
                                    sendMessage(userChatId, alertMessage);
                                }
                            });
                            
                            // Mark alert as sent
                            global.dishwasherAlertSent = true;
                            
                            // Save alert state to database
                            await db.saveBotState('dishwasherAlertSent', true);
                        }
                    }, timeUntil7AM);
                    
                    // Store rescheduled timer reference for potential cleanup
                    global.dishwasherAutoAlertTimer = rescheduledTimeout;
                    
                    return; // Don't send now
                }
                
                // Day hours - send immediately
                console.log(`⏰ Auto-alert triggered after 3 hours for ${currentTurnUser}`);
                
                // Send dishwasher alert to all authorized users and admins
                [...authorizedUsers, ...admins].forEach(user => {
                    let userChatId = userChatIds.get(user) || (user ? userChatIds.get(user.toLowerCase()) : null);
                    
                    // If not found in userChatIds, check if this user is an admin
                    if (!userChatId && isUserAdmin(user)) {
                        userChatId = adminNameToChatId.get(user) || (user ? adminNameToChatId.get(user.toLowerCase()) : null);
                    }
                    
                    if (userChatId) {
                        // Get the correct userId for language preference
                        const recipientUserId = getUserIdFromChatId(userChatId);
                        
                        const alertMessage = t(recipientUserId, 'dishwasher_alert_message', {user: translateName(currentTurnUser, recipientUserId), sender: t(recipientUserId, 'auto_timer')});
                        console.log(`🔔 Sending auto dishwasher alert to ${user} (${userChatId}, userId: ${recipientUserId})`);
                        sendMessage(userChatId, alertMessage);
                    }
                });
                
                // Mark alert as sent
                global.dishwasherAlertSent = true;
                
                // Save alert state to database
                await db.saveBotState('dishwasherAlertSent', true);
            }
        }, 3 * 60 * 60 * 1000); // 3 hours in milliseconds
        
        // Store timer reference for potential cleanup
        global.dishwasherAutoAlertTimer = autoAlertTimeout;
        
        // Mark dishwasher as started
        global.dishwasherStarted = true;
        global.dishwasherAlertSent = false;
        global.dishwasherCompleted = false;
        global.dishwasherStartedAt = Date.now(); // Save timestamp for timer restoration
        
        // Save dishwasher state to database for persistence across restarts
        await db.saveBotState('dishwasherStarted', true);
        await db.saveBotState('dishwasherAlertSent', false);
        await db.saveBotState('dishwasherCompleted', false);
        await db.saveBotState('dishwasherStartedAt', global.dishwasherStartedAt);
        
        // Send confirmation to admin
        sendMessage(chatId, `${t(userId, 'dishwasher_started_sent')}\n\n${t(userId, 'alerted_user')} ${translateName(currentUser, userId)}\n${t(userId, 'sent_to_all')}`);
        
    } else if (data === 'authorize_menu') {
        const isAdmin = isUserAdmin(userName, userId);
        if (isAdmin) {
            const message = `🔧 **Authorize Users**\n\n` +
                `📋 **Available queue members:**\n` +
                `• ${translateName('Eden', userId)}\n` +
                `• ${translateName('Adele', userId)}\n` +
                `• ${translateName('Emma', userId)}\n\n` +
                `💡 **Usage:** Type \`/authorize Eden\` to authorize Eden`;
            sendMessage(chatId, message);
        } else {
            sendMessage(chatId, t(userId, 'admin_access_required'));
        }
    } else if (data === 'addadmin_menu') {
        const isAdmin = isUserAdmin(userName, userId);
        if (isAdmin) {
            const message = `➕ **Add Admin**\n\n` +
                `💡 **Usage:** Type \`/addadmin <username>\`\n\n` +
                `**Example:** \`/addadmin ${translateName('Marianna', userId)}\``;
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
            `• ${translateName('Eden', userId)}\n` +
            `• ${translateName('Adele', userId)}\n` +
            `• ${translateName('Emma', userId)}`;
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
        const isAdmin = isUserAdmin(userName, userId);
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        sendMessage(chatId, t(userId, 'type_announcement_message'));
        userStates.set(userId, 'typing_announcement');
        
    } else if (data === 'send_user_message') {
        // User or admin sends message
        const isAuthorized = isUserAuthorized(userName) || 
                           isUserAdmin(userName, userId);
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
        const isAdmin = isUserAdmin(userName, userId);
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
            ],
            [
                { text: t(userId, 'hard_reset_section'), callback_data: "hard_reset_section" }
            ]
        ];
        
        sendMessageWithButtons(chatId, maintenanceText, maintenanceButtons);
        
    } else if (data === 'hard_reset_section') {
        // Hard reset section - shows warning and options
        const isAdmin = isUserAdmin(userName, userId);
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        const warningText = `⚠️ **${t(userId, 'hard_reset_section')}**\n\n${t(userId, 'danger_zone_warning')}`;
        const hardResetButtons = [
            [
                { text: t(userId, 'remove_user'), callback_data: "remove_user_menu" },
                { text: t(userId, 'reset_bot_button'), callback_data: "reset_bot_menu" }
            ],
            [
                { text: t(userId, 'leave_bot_button'), callback_data: "leave_bot" }
            ],
            [
                { text: t(userId, 'back_to_admin_menu'), callback_data: "maintenance_menu" }
            ]
        ];
        
        sendMessageWithButtons(chatId, warningText, hardResetButtons);
        
    } else if (data === 'monthly_report_show') {
        // Show monthly report
        const isAdmin = isUserAdmin(userName, userId);
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        const currentMonthKey = getCurrentMonthKey();
        const report = generateMonthlyReport(currentMonthKey, userId);
        sendMessage(chatId, report);
        
    } else if (data === 'share_monthly_report') {
        // Share monthly report with all users
        const isAdmin = isUserAdmin(userName, userId);
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        const currentMonthKey = getCurrentMonthKey();
        const recipientCount = broadcastMonthlyReport(currentMonthKey, false);
        sendMessage(chatId, t(userId, 'monthly_report_shared', {count: recipientCount}));
        
    } else if (data === 'queue_management_menu') {
        // Queue Management submenu
        const isAdmin = isUserAdmin(userName, userId);
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
                { text: t(userId, 'remove_user'), callback_data: "remove_queue_user_menu" }
            ],
            [
                { text: t(userId, 'reset_scores'), callback_data: "reset_scores_menu" }
            ]
        ];
        
        sendMessageWithButtons(chatId, queueManagementText, queueManagementButtons);
        
    // Queue Management Handlers
    } else if (data === 'reorder_queue_menu') {
        // Show current turn order and options to change it (show originalQueue for tie-breaker priority)
        const currentOrder = originalQueue.map((user, index) => `${index + 1}. ${addRoyalEmojiTranslated(user, userId)}`).join('\n');
        const message = t(userId, 'reorder_tie_breaker_priority', {currentOrder: currentOrder});
        
        // DEBUG: Log translation values
        
        const buttons = [
            [
                { text: t(userId, 'set_custom_order'), callback_data: 'reorder_custom_order' },
                { text: t(userId, 'reset_to_default'), callback_data: 'reorder_reset_default' }
            ],
            [
                { text: t(userId, 'view_current_order'), callback_data: 'reorder_view_current' }
            ]
        ];
        
        sendMessageWithButtons(chatId, message, buttons);
        
    } else if (data === 'reorder_custom_order') {
        // Step 1: Select user to move
        const queueUsers = ['Eden', 'Adele', 'Emma'];
        const buttons = queueUsers.map(user => [{ text: addRoyalEmojiTranslated(user, userId), callback_data: `reorder_select_${user}` }]);
        sendMessageWithButtons(chatId, t(userId, 'select_user_move_priority'), buttons);
        
    } else if (data.startsWith('reorder_select_')) {
        // Step 2: Select new position for user
        const selectedUser = data ? data.replace('reorder_select_', '') : '';
        
        if (!selectedUser) {
            sendMessage(chatId, t(userId, 'error_invalid_selection'));
            return;
        }
        
        const positionButtons = [
            [{ text: t(userId, 'position_1'), callback_data: `reorder_position_${selectedUser}_1` }],
            [{ text: t(userId, 'position_2'), callback_data: `reorder_position_${selectedUser}_2` }],
            [{ text: t(userId, 'position_3'), callback_data: `reorder_position_${selectedUser}_3` }]
        ];
        sendMessageWithButtons(chatId, t(userId, 'select_new_position', {user: addRoyalEmoji(selectedUser)}), positionButtons);
        
    } else if (data.startsWith('reorder_position_')) {
        // Execute reorder (change tie-breaker priority order)
        const parts = data ? data.replace('reorder_position_', '').split('_') : [];
        const selectedUser = parts[0];
        const newPosition = parts[1] ? parseInt(parts[1]) - 1 : -1; // Convert to 0-based index
        
        if (!selectedUser || isNaN(newPosition) || newPosition < 0) {
            sendMessage(chatId, t(userId, 'error_invalid_position'));
            return;
        }
        
        // Create new priority order
        const newOrder = [...originalQueue];
        const currentIndex = newOrder.indexOf(selectedUser);
        
        if (currentIndex !== -1 && newPosition >= 0 && newPosition < newOrder.length) {
            // Remove user from current position
            newOrder.splice(currentIndex, 1);
            // Insert at new position
            newOrder.splice(newPosition, 0, selectedUser);
            
            // Update the originalQueue (tie-breaker order)
            originalQueue.length = 0;
            originalQueue.push(...newOrder);
            
            console.log(`🔄 Tie-breaker order updated: ${newOrder.join(' → ')}`);
            
            // Track for monthly report
            trackMonthlyAction('queue_reorder', null, userName);
            
                const newOrderText = newOrder.map((user, index) => `${index + 1}. ${addRoyalEmoji(user)}`).join('\n');
                const message = t(userId, 'tie_breaker_order_updated', {newOrder: newOrderText});
                
                sendMessage(chatId, message);
        } else {
            sendMessage(chatId, t(userId, 'invalid_position_selected'));
        }
        
    } else if (data === 'reorder_reset_default') {
        // Reset to default order
        const defaultOrder = ['Eden', 'Adele', 'Emma'];
        
        // Reset turn order to default
        turnOrder.clear();
        defaultOrder.forEach(user => turnOrder.add(user));
        
        // Reset originalQueue to default (CRITICAL FIX!)
        originalQueue.length = 0;
        originalQueue.push(...defaultOrder);
        
        // Reset current turn index
        currentTurnIndex = 0;
        
        console.log(`🔄 Turn order reset to default: ${defaultOrder.join(' → ')}`);
        
        // Save the changes
        await saveBotData();
        
        const defaultOrderText = defaultOrder.map((user, index) => `${index + 1}. ${addRoyalEmojiTranslated(user, userId)}`).join('\n');
        const message = t(userId, 'tie_breaker_order_reset', {defaultOrder: defaultOrderText});
        
        sendMessage(chatId, message);
        
    } else if (data === 'reorder_view_current') {
        // Show current tie-breaker priority order (show originalQueue)
        const currentOrder = originalQueue.map((user, index) => `${index + 1}. ${addRoyalEmojiTranslated(user, userId)}`).join('\n');
        const message = t(userId, 'current_tie_breaker_priority_order', {currentOrder: currentOrder});
        
        sendMessage(chatId, message);
        
    } else if (data === 'queue_statistics_show') {
        // Show queue statistics
        let statsMessage = t(userId, 'queue_statistics_title');
        
        // Sanitize helper: removes Telegram Markdown special chars to avoid parse errors
        const sanitize = (s) => typeof s === 'string' ? s.replace(/[_*\[\]()~`>#+\-=|{}.!]/g, '') : s;
        
        // If there are no authorized users yet, show a friendly message and exit early
        if (authorizedUsers.size === 0) {
            sendMessage(chatId, `${statsMessage}\n${t(userId, 'no_statistics_available') || 'No statistics available yet. Come back after some activity.'}`);
            return;
        }
        
        // Current tie-breaker priority order (only authorized users)
        statsMessage += t(userId, 'tie_breaker_priority_order');
        Array.from(authorizedUsers).forEach((user, index) => {
            const nameTranslated = addRoyalEmojiTranslated(user, userId);
            statsMessage += `${index + 1}. ${sanitize(nameTranslated)}\n`;
        });
        
        // Current scores (only for authorized users) - fetch from database for accuracy
        statsMessage += `\n${t(userId, 'current_scores')}`;
        const relativeScores = getRelativeScores();
        
        // Display scores in originalQueue order for consistency
        for (const user of originalQueue) {
            if (authorizedUsers.has(user)) {
                // Fetch score directly from database to ensure accuracy
                const score = await db.getUserScore(user) || 0;
            const relativeScore = relativeScores.get(user) || 0;
                const nameTranslated = addRoyalEmojiTranslated(user, userId);
                statsMessage += `${sanitize(nameTranslated)}: ${score} (${relativeScore >= 0 ? '+' : ''}${relativeScore})\n`;
            }
        }
        
        // Current turn and next 3 turns
        const currentUser = getCurrentTurnUser();
        const nextThreeTurns = getNextThreeTurns();
        statsMessage += `\n${t(userId, 'current_turn')} ${sanitize(addRoyalEmojiTranslated(currentUser, userId))}\n`;
        statsMessage += `${t(userId, 'next_3_turns')} ${nextThreeTurns.map(user => sanitize(addRoyalEmojiTranslated(user, userId))).join(' → ')}\n`;
        
        // Suspended users
        if (suspendedUsers.size > 0) {
            statsMessage += `\n${t(userId, 'suspended_users')}`;
            for (const [user, suspension] of suspendedUsers.entries()) {
                const emoji = sanitize(addRoyalEmojiTranslated(user, userId));
                const daysLeft = Math.ceil((suspension.suspendedUntil - new Date()) / (1000 * 60 * 60 * 24));
                const daysText = daysLeft > 1 ? t(userId, 'days_left_plural') : t(userId, 'days_left');
                statsMessage += `${emoji}: ${daysLeft} ${daysText}\n`;
            }
        }
        
        // Active turn assignments
        if (turnAssignments.size > 0) {
            statsMessage += `\n${t(userId, 'active_turn_assignments')}`;
            for (const [originalUser, assignedTo] of turnAssignments.entries()) {
                const originalEmoji = sanitize(addRoyalEmojiTranslated(originalUser, userId));
                const assignedEmoji = sanitize(addRoyalEmojiTranslated(assignedTo, userId));
                statsMessage += `${originalEmoji} → ${assignedEmoji}\n`;
            }
        }
        
        // If monthly stats are empty, append a friendly note
        const currentMonthKey = getCurrentMonthKey();
        const hasMonthlyStats = monthlyStats.has(currentMonthKey);
        if (!hasMonthlyStats) {
            statsMessage += `\n${t(userId, 'no_statistics_recorded_this_month') || 'No statistics recorded yet for this month.'}`;
        }
        
        // Send as plain text to fully avoid Markdown parsing issues
        sendMessagePlain(chatId, statsMessage);
        
    } else if (data === 'suspend_user_menu') {
        // Select user to suspend (show all users in originalQueue)
        const buttons = originalQueue.map(user => [{ text: addRoyalEmojiTranslated(user, userId), callback_data: `suspend_select_${user}` }]);
        sendMessageWithButtons(chatId, t(userId, 'select_user_to_suspend'), buttons);
        
    } else if (data.startsWith('suspend_select_')) {
        // Select suspension duration
        const selectedUser = data ? data.replace('suspend_select_', '') : '';
        
        if (!selectedUser) {
            sendMessage(chatId, t(userId, 'error_invalid_selection'));
            return;
        }
        
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
        const parts = data ? data.replace('suspend_duration_', '').split('_') : [];
        const selectedUser = parts[0];
        const days = parts[1] ? parseInt(parts[1]) : 0;
        
        if (!selectedUser || isNaN(days) || days <= 0) {
            sendMessage(chatId, t(userId, 'error_invalid_duration'));
            return;
        }
        
        const success = suspendUser(selectedUser, days);
        if (success) {
            // Save to database
            await saveBotData();
            
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
        const buttons = suspendedUsersList.map(user => [{ text: addRoyalEmojiTranslated(user, userId), callback_data: `reactivate_${user}` }]);
        sendMessageWithButtons(chatId, t(userId, 'select_user_to_reactivate'), buttons);
        
    } else if (data.startsWith('reactivate_')) {
        // Execute reactivation
        const selectedUser = data ? data.replace('reactivate_', '') : '';
        
        if (!selectedUser) {
            sendMessage(chatId, t(userId, 'error_invalid_selection'));
            return;
        }
        
        const success = reactivateUser(selectedUser);
        if (success) {
            // Save to database
            await saveBotData();
            
            sendMessage(chatId, t(userId, 'user_reactivated', {user: addRoyalEmoji(selectedUser)}));
        } else {
            sendMessage(chatId, `❌ Failed to reactivate ${addRoyalEmoji(selectedUser)}`);
        }
        
    } else if (data === 'remove_queue_user_menu') {
        if (queue.length === 0) {
            sendMessage(chatId, t(userId, 'no_users_to_remove'));
            return;
        }
        const buttons = queue.map(user => [{ text: addRoyalEmojiTranslated(user, userId), callback_data: `remove_${user}` }]);
        sendMessageWithButtons(chatId, t(userId, 'select_user_to_remove'), buttons);
        
    } else if (data.startsWith('remove_')) {
        // Execute permanent removal (100-year suspension)
        const selectedUser = data ? data.replace('remove_', '') : '';
        
        if (!selectedUser) {
            sendMessage(chatId, t(userId, 'error_invalid_selection'));
            return;
        }
        
        const success = suspendUser(selectedUser, 36500, t(userId, 'permanently_removed')); // 100 years
        if (success) {
            sendMessage(chatId, t(userId, 'user_removed', {user: addRoyalEmoji(selectedUser)}));
        } else {
            sendMessage(chatId, `❌ Failed to remove ${addRoyalEmoji(selectedUser)}`);
        }
        
    } else if (data === 'reset_scores_menu') {
        // Show reset scores options
        const currentScores = originalQueue.map(user => {
            const score = userScores.get(user) || 0;
            return `${addRoyalEmojiTranslated(user, userId)}: ${score}`;
        }).join('\n');
        
        const message = `${t(userId, 'reset_scores')} Menu\n\n📊 ${t(userId, 'current_scores')}\n${currentScores}\n\nOptions:`;
        
        const buttons = [
            [
                { text: t(userId, 'reset_all_scores'), callback_data: 'reset_all_scores_confirm' },
                { text: t(userId, 'reset_individual'), callback_data: 'reset_individual_scores' }
            ],
            [
                { text: t(userId, 'normalize_scores'), callback_data: 'normalize_scores_confirm' },
                { text: t(userId, 'reset_system'), callback_data: 'reset_system_confirm' }
            ]
        ];
        
        sendMessageWithButtons(chatId, message, buttons);
        
    } else if (data === 'reset_all_scores_confirm') {
        // Confirm reset all scores
        const confirmButtons = [
            [{ text: t(userId, 'confirm_reset_all'), callback_data: 'reset_all_scores_execute' }],
            [{ text: t(userId, 'cancel'), callback_data: 'reset_scores_menu' }]
        ];
        sendMessageWithButtons(chatId, t(userId, 'confirm_reset_all_scores'), confirmButtons);
        
    } else if (data === 'reset_all_scores_execute') {
        // Execute reset all scores
        originalQueue.forEach(user => {
            userScores.set(user, 0);
        });
        
        // Save to database
        await saveBotData();
        
        console.log('🔄 All scores reset to 0');
        
        // Track for monthly report
        trackMonthlyAction('queue_reorder', null, userName);
        
        const newScores = originalQueue.map(user => `${addRoyalEmojiTranslated(user, userId)}: 0`).join('\n');
        const message = t(userId, 'all_scores_reset', {newScores: newScores});
        
        sendMessage(chatId, message);
        
    } else if (data === 'reset_individual_scores') {
        // Select user to reset score
        const buttons = originalQueue.map(user => {
            const currentScore = userScores.get(user) || 0;
            return [{ text: `${addRoyalEmojiTranslated(user, userId)} (${currentScore})`, callback_data: `reset_score_select_${user}` }];
        });
        sendMessageWithButtons(chatId, t(userId, 'select_user_reset_score'), buttons);
        
    } else if (data.startsWith('reset_score_select_')) {
        // Confirm individual score reset
        const selectedUser = data ? data.replace('reset_score_select_', '') : '';
        
        if (!selectedUser) {
            sendMessage(chatId, t(userId, 'error_invalid_selection'));
            return;
        }
        
        const currentScore = userScores.get(selectedUser) || 0;
        
        const confirmButtons = [
            [{ text: `✅ ${t(userId, 'reset_scores')} ${addRoyalEmojiTranslated(selectedUser, userId)}`, callback_data: `reset_score_execute_${selectedUser}` }],
            [{ text: t(userId, 'cancel'), callback_data: 'reset_scores_menu' }]
        ];
        
        const message = t(userId, 'confirm_reset_score', {user: addRoyalEmojiTranslated(selectedUser, userId), score: currentScore});
        sendMessageWithButtons(chatId, message, confirmButtons);
        
    } else if (data.startsWith('reset_score_execute_')) {
        // Execute individual score reset
        const selectedUser = data ? data.replace('reset_score_execute_', '') : '';
        
        if (!selectedUser) {
            sendMessage(chatId, t(userId, 'error_invalid_selection'));
            return;
        }
        
        const oldScore = userScores.get(selectedUser) || 0;
        
        userScores.set(selectedUser, 0);
        
        // Save to database
        await saveBotData();
        
        console.log(`🔄 ${selectedUser} score reset: ${oldScore} → 0`);
        
        // Track for monthly report
        trackMonthlyAction('queue_reorder', null, userName);
        
        const message = t(userId, 'score_reset', {user: addRoyalEmojiTranslated(selectedUser, userId), oldScore: oldScore});
        sendMessage(chatId, message);
        
    } else if (data === 'reset_system_confirm') {
        // Confirm full system reset
        const confirmButtons = [
            [{ text: t(userId, 'reset_everything'), callback_data: 'reset_system_execute' }],
            [{ text: t(userId, 'cancel'), callback_data: 'reset_scores_menu' }]
        ];
        sendMessageWithButtons(chatId, t(userId, 'confirm_full_system_reset'), confirmButtons);
        
    } else if (data === 'reset_system_execute') {
        // Execute full system reset
        // Reset all scores
        originalQueue.forEach(user => {
            userScores.set(user, 0);
        });
        
        // Clear all assignments
        turnAssignments.clear();
        
        // Clear all suspensions
        suspendedUsers.clear();
        
        // Reset tie-breaker order to default
        originalQueue.length = 0;
        originalQueue.push('Eden', 'Adele', 'Emma');
        
        console.log('🔄 Full system reset completed');
        
        // Track for monthly report
        trackMonthlyAction('queue_reorder', null, userName);
        
        const message = t(userId, 'full_system_reset_complete');
        sendMessage(chatId, message);
        
    } else if (data === 'normalize_scores_confirm') {
        // Show what normalization will do
        const scores = Array.from(userScores.values());
        const minScore = Math.min(...scores);
        const maxScore = Math.max(...scores);
        
        const currentScores = originalQueue.map(user => {
            const score = userScores.get(user) || 0;
            const newScore = score - minScore;
            return `${addRoyalEmojiTranslated(user, userId)}: ${score} → ${newScore}`;
        }).join('\n');
        
        const message = t(userId, 'normalize_scores_title', {currentScores: currentScores, minScore: minScore});
        
        const confirmButtons = [
            [{ text: t(userId, 'normalize_now'), callback_data: 'normalize_scores_execute' }],
            [{ text: t(userId, 'cancel'), callback_data: 'reset_scores_menu' }]
        ];
        sendMessageWithButtons(chatId, message, confirmButtons);
        
    } else if (data === 'normalize_scores_execute') {
        // Execute score normalization
        const scores = Array.from(userScores.values());
        const minScore = Math.min(...scores);
        
        // Subtract the minimum score from all users
        for (const [user, score] of userScores.entries()) {
            userScores.set(user, score - minScore);
        }
        
        console.log(`🔄 Manual score normalization: subtracted ${minScore} from all users`);
        
        // Track for monthly report
        trackMonthlyAction('queue_reorder', null, userName);
        
        const newScores = originalQueue.map(user => {
            const score = userScores.get(user) || 0;
            return `${addRoyalEmoji(user)}: ${score}`;
        }).join('\n');
        
        const message = t(userId, 'scores_normalized', {newScores: newScores});
        sendMessage(chatId, message);
        
    } else if (data === 'language_switch') {
        const currentLang = getUserLanguage(userId);
        const newLang = currentLang === 'en' ? 'he' : 'en';
        userLanguage.set(String(userId), newLang);
        
        // PHASE 2: Track bot state changes for future batching
        dirtyKeys.add('userLanguage');
        isDirty = true;
        
        // PHASE 3: Trigger non-blocking critical save for immediate persistence
        await saveCriticalData();
        
        const switchMessage = newLang === 'he' ? 
            `🇮🇱 **שפה שונתה לעברית!** ✅\n\nהבוט יציג כעת הכל בעברית.\nשלח /start כדי לראות את התפריט החדש! 🎯` :
            `🇺🇸 **Language switched to English!** ✅\n\nThe bot will now display everything in English.\nSend /start to see the new menu! 🎯`;
        
        sendMessage(chatId, switchMessage);
        
    } else if (data === 'swap_menu') {
        const isAuthorized = isUserAuthorized(userName);
        if (!isAuthorized) {
            sendMessage(chatId, t(userId, 'not_authorized_swap_features'));
            return;
        }
        
        // For swap requests, we need to find the user's position in the queue
        // Since userName is canonical ("Adele"), we need to find their queue representation
        let currentUserQueueName = null;
        for (const [canonicalName, queueName] of userQueueMapping.entries()) {
            if (canonicalName && userName && canonicalName.toLowerCase() === userName.toLowerCase()) {
                currentUserQueueName = queueName;
                break;
            }
        }
        
        // Fallback: if not found in mapping, use userName directly
        if (!currentUserQueueName) {
            currentUserQueueName = userName;
        }
        
        // Show all users except the current user (can't swap with yourself) - case-insensitive comparison
        const uniqueUsers = [...new Set(queue)];
        const availableUsers = uniqueUsers.filter(name => {
            if (!name || !currentUserQueueName) return true;
            return name.toLowerCase() !== currentUserQueueName.toLowerCase();
        });
        const buttons = availableUsers.map(name => [{ text: addRoyalEmojiTranslated(name, userId), callback_data: `swap_request_${name}` }]);
        
        sendMessageWithButtons(chatId, 
            t(userId, 'request_swap_your_position', {position: currentUserQueueName || t(userId, 'undefined')}), 
            buttons
        );
        
    } else if (data.startsWith('swap_request_')) {
        const targetUser = data ? data.replace('swap_request_', '') : '';
        
        // For swap requests, we need to find the user's position in the queue
        // Since userName is canonical ("Adele"), we need to find their queue representation
        let currentUserQueueName = null;
        for (const [canonicalName, queueName] of userQueueMapping.entries()) {
            if (canonicalName && userName && canonicalName.toLowerCase() === userName.toLowerCase()) {
                currentUserQueueName = queueName;
                break;
            }
        }
        
        // Fallback: if not found in mapping, use userName directly
        if (!currentUserQueueName) {
            currentUserQueueName = userName;
        }
        
        if (!currentUserQueueName) {
            sendMessage(chatId, t(userId, 'error_queue_position'));
            return;
        }
        
        // Validate: userName must be either the original turn holder OR the currently performing user
        // (Same validation as force swap - allows swap from current turn)
        const originalTurnHolder = getOriginalTurnHolder();
        const currentPerformingUser = getCurrentTurnUser(); // The user currently performing the turn
        
        // Allow swap if:
        // 1. userName is the original turn holder (they have their own turn), OR
        // 2. userName is the currently performing user (they can swap the turn they're performing)
        if (!originalTurnHolder || !currentPerformingUser) {
            console.log(`⚠️ No current turn holder found. originalTurnHolder: ${originalTurnHolder}, currentPerformingUser: ${currentPerformingUser}`);
            sendMessage(chatId, t(userId, 'no_one_in_queue'));
            return;
        }
        
        if (userName !== originalTurnHolder && userName !== currentPerformingUser) {
            const royalUserName = addRoyalEmojiTranslated(userName, userId);
            const royalCurrentUser = addRoyalEmojiTranslated(currentPerformingUser, userId);
            sendMessage(chatId, t(userId, 'error_cannot_swap', {
                userName: royalUserName,
                currentUser: royalCurrentUser
            }));
            console.log(`⚠️ Swap request rejected: ${userName} is neither the original turn holder (${originalTurnHolder}) nor the performing user (${currentPerformingUser})`);
            return;
        }
        
        // Check if user already has a pending swap request
        for (const [requestId, request] of pendingSwaps.entries()) {
            if (request.fromUserId === chatId) {
                sendMessage(chatId, t(userId, 'pending_swap_exists', {fromUser: request.fromUser, toUser: request.toUser, requestId: requestId}));
                return;
            }
        }
        
        // Find the canonical name for the target user (targetUser is a queue name)
        // Handle case-insensitive matching and Hebrew names
        let targetCanonicalName = targetUser;
        
        // First, try to find exact match (case-insensitive)
        for (const [canonicalName, queueName] of userQueueMapping.entries()) {
            if (queueName && targetUser && queueName.toLowerCase() === targetUser.toLowerCase()) {
                targetCanonicalName = canonicalName;
                break;
            }
        }
        
        // If not found, try matching against Hebrew names or partial matches
        if (targetCanonicalName === targetUser) {
            // Check if targetUser contains a known English name (case-insensitive)
            const lowerTargetUser = targetUser.toLowerCase();
            for (const [englishName, hebrewName] of Object.entries(hebrewNames)) {
                // Check if targetUser contains the English name (case-insensitive)
                // or contains the Hebrew name (exact or partial match)
                const englishMatch = lowerTargetUser.includes(englishName.toLowerCase());
                const hebrewMatch = targetUser.includes(hebrewName);
                
                if (englishMatch || hebrewMatch) {
                    // Find the canonical name for this English name
                    for (const [canonicalName, queueName] of userQueueMapping.entries()) {
                        if (canonicalName && canonicalName.toLowerCase() === englishName.toLowerCase()) {
                            targetCanonicalName = canonicalName;
                            break;
                        }
                    }
                    // Also try direct match in userQueueMapping if queueName contains the English name
                    if (targetCanonicalName === targetUser) {
                        for (const [canonicalName, queueName] of userQueueMapping.entries()) {
                            if (queueName && (
                                queueName.toLowerCase().includes(englishName.toLowerCase()) ||
                                queueName.includes(hebrewName)
                            )) {
                                targetCanonicalName = canonicalName;
                                break;
                            }
                        }
                    }
                    if (targetCanonicalName !== targetUser) break;
                }
            }
        }
        
        // Get the actual chat ID for the target user using the canonical name
        let targetChatId = userChatIds.get(targetCanonicalName) || (targetCanonicalName ? userChatIds.get(targetCanonicalName.toLowerCase()) : null);
        
        // If not found in userChatIds, check if this user is an admin
        if (!targetChatId && isUserAdmin(targetCanonicalName)) {
            targetChatId = adminNameToChatId.get(targetCanonicalName) || (targetCanonicalName ? adminNameToChatId.get(targetCanonicalName.toLowerCase()) : null);
        }
        
        if (!targetChatId) {
            sendMessage(chatId, t(userId, 'target_user_not_found', {targetUser: targetUser}));
            return;
        }
        
        // Check if target user already has a pending swap request (using chat ID)
        for (const [requestId, request] of pendingSwaps.entries()) {
            if (request.toUserId === targetChatId || request.fromUserId === targetChatId) {
                sendMessage(chatId, t(userId, 'target_has_pending_swap', {targetUser: targetUser, fromUser: request.fromUser, toUser: request.toUser, requestId: requestId}));
                return;
            }
        }
        
        // Create swap request
        const requestId = ++swapRequestCounter;
        
        pendingSwaps.set(requestId, {
            fromUser: userName,
            toUser: targetUser,
            fromUserId: chatId, // Store the actual chat ID for consistency with toUserId
            toUserId: targetChatId, // Store the actual chat ID, not username
            timestamp: Date.now()
        });
        
        // Track swap request for monthly report
        trackMonthlyAction('swap_requested', userName);
        
        // Notify the target user
        if (targetChatId) {
            const buttons = createLocalizedButtons(targetChatId, [
                [
                { translationKey: 'approve', callback_data: `swap_approve_${requestId}` },
                { translationKey: 'reject', callback_data: `swap_reject_${requestId}` }
                ]
            ]);
            
            // Get the correct userId for language preference
            const targetUserId = getUserIdFromChatId(targetChatId);
            
            // Translate names based on target user's language preference
            const translatedFromUser = translateName(userName, targetUserId) || userName;
            const translatedTargetUser = translateName(targetUser, targetUserId) || targetUser;
            const translatedCurrentUserQueueName = translateName(currentUserQueueName, targetUserId) || currentUserQueueName;
            
            sendMessageWithButtons(targetChatId, 
                `🔄 **${t(targetUserId, 'swap_request_title')}**\n\n👤 **${t(targetUserId, 'from_user')}:** ${translatedFromUser} (${translatedCurrentUserQueueName})\n🎯 **${t(targetUserId, 'wants_to_swap_with')}:** ${translatedTargetUser}`, 
                buttons
            );
        } else {
            console.log(`❌ No chat ID found for target user: ${targetCanonicalName} (queue name: ${targetUser})`);
        }
        
        // Notify all admins about the swap request in their language
        for (const adminChatId of adminChatIds) {
            if (adminChatId !== chatId && adminChatId !== targetChatId) { // Don't notify the requester or target user
                // Get the correct userId for language preference
                const adminUserId = getUserIdFromChatId(adminChatId);
                
                // Translate names based on admin's language preference
                const translatedFromUser = translateName(userName, adminUserId) || userName;
                const translatedTargetUser = translateName(targetUser, adminUserId) || targetUser;
                const translatedCurrentUserQueueName = translateName(currentUserQueueName, adminUserId) || currentUserQueueName;
                
                // Create notification in admin's language
                const adminNotification = `🔄 **${t(adminUserId, 'new_swap_request')}**\n\n👤 **${t(adminUserId, 'from_user')}:** ${translatedFromUser} (${translatedCurrentUserQueueName})\n🎯 **${t(adminUserId, 'wants_to_swap_with')}:** ${translatedTargetUser}\n📅 **${t(adminUserId, 'time')}:** ${new Date().toLocaleString()}\n\n💡 **${t(adminUserId, 'request_id')}:** ${requestId}`;
                console.log(`🔔 Sending admin swap notification to chat ID: ${adminChatId} (userId: ${adminUserId})`);
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
            t(userId, 'swap_request_sent_detailed', {user: translateName(targetUser, userId)}), 
            cancelButtons
        );
        
    } else if (data.startsWith('swap_approve_')) {
        const requestId = data ? parseInt(data.replace('swap_approve_', '')) : 0;
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
        console.log(`🔍 Checking approval: swapRequest.toUserId (${swapRequest.toUserId}) === chatId (${chatId})`);
        if (swapRequest.toUserId !== chatId) {
            console.log(`❌ Swap request not for this user`);
            sendMessage(chatId, t(userId, 'swap_request_not_for_you'));
            return;
        }
        
        console.log(`✅ Approval valid, executing swap...`);
        // Execute the swap
        await executeSwap(swapRequest, requestId, 'approved');
        
    } else if (data.startsWith('swap_reject_')) {
        const requestId = data ? parseInt(data.replace('swap_reject_', '')) : 0;
        
        if (isNaN(requestId) || requestId <= 0) {
            sendMessage(chatId, t(userId, 'error_invalid_request_id'));
            return;
        }
        
        const swapRequest = pendingSwaps.get(requestId);
        
        if (!swapRequest) {
            sendMessage(chatId, t(userId, 'swap_request_not_found'));
            return;
        }
        
        // Check if this is the correct user rejecting
        if (swapRequest.toUserId !== chatId) {
            sendMessage(chatId, t(userId, 'swap_request_not_for_you'));
            return;
        }
        
        // Notify the requester
        const requesterUserId = getUserIdFromChatId(swapRequest.fromUserId);
        sendMessage(swapRequest.fromUserId, t(requesterUserId, 'swap_request_rejected_simple', {user: translateName(userName, requesterUserId)}));
        sendMessage(chatId, t(userId, 'you_declined_swap_request', {user: translateName(swapRequest.fromUser, userId)}));
        
        // Notify all admins about the rejection in their language
        for (const adminChatId of adminChatIds) {
            if (adminChatId !== chatId && adminChatId !== swapRequest.fromUserId) { // Don't notify the rejector or requester
                // Get the correct userId for language preference
                const adminUserId = getUserIdFromChatId(adminChatId);
                
                // Create rejection notification in admin's language
                const adminNotification = `❌ **${t(adminUserId, 'swap_request_rejected_title')}**\n\n👤 **${t(adminUserId, 'from_user')}:** ${translateName(swapRequest.fromUser, adminUserId)}\n👤 **${t(adminUserId, 'rejected_by')}:** ${translateName(userName, adminUserId)}\n📅 **${t(adminUserId, 'time')}:** ${new Date().toLocaleString()}`;
                console.log(`🔔 Sending admin swap rejection notification to chat ID: ${adminChatId} (userId: ${adminUserId})`);
                sendMessage(adminChatId, adminNotification);
            }
        }
        
        // Remove the request
        pendingSwaps.delete(requestId);
        
    } else if (data.startsWith('swap_cancel_')) {
        const requestId = data ? parseInt(data.replace('swap_cancel_', '')) : 0;
        
        if (isNaN(requestId) || requestId <= 0) {
            sendMessage(chatId, t(userId, 'error_invalid_request_id'));
            return;
        }
        
        const swapRequest = pendingSwaps.get(requestId);
        
        if (!swapRequest) {
            sendMessage(chatId, t(userId, 'swap_request_not_found'));
            return;
        }
        
        // Check if this is the correct user canceling
        if (swapRequest.fromUserId !== chatId) {
            sendMessage(chatId, t(userId, 'swap_request_not_yours'));
            return;
        }
        
        // Notify the target user that the request was canceled
        if (swapRequest.toUserId) {
            const targetUserId = getUserIdFromChatId(swapRequest.toUserId);
            sendMessage(swapRequest.toUserId, t(targetUserId, 'swap_request_canceled_notification', {user: translateName(userName, targetUserId)}));
        }
        
        // Notify the requester
        sendMessage(chatId, t(userId, 'swap_request_canceled_confirmation', {user: translateName(swapRequest.toUser, userId)}));
        
        // Notify all admins about the cancellation in their language
        for (const adminChatId of adminChatIds) {
            if (adminChatId !== chatId && adminChatId !== swapRequest.toUserId) { // Don't notify the canceler or target user
                // Get the correct userId for language preference
                const adminUserId = getUserIdFromChatId(adminChatId);
                
                // Create cancellation notification in admin's language
                const adminNotification = t(adminUserId, 'swap_request_canceled_admin', {
                    from: translateName(swapRequest.fromUser, adminUserId),
                    canceledBy: translateName(userName, adminUserId),
                    target: translateName(swapRequest.toUser, adminUserId),
                    time: new Date().toLocaleString()
                });
                console.log(`🔔 Sending admin swap cancellation notification to chat ID: ${adminChatId} (userId: ${adminUserId})`);
                sendMessage(adminChatId, adminNotification);
            }
        }
        
        // Remove the request
        pendingSwaps.delete(requestId);
        
    } else if (data === 'force_swap_menu') {
        const isAdmin = isUserAdmin(userName, userId);
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        console.log(`🔍 Queue contents:`, queue);
        
        // Get current turn user using score-based system
        const currentUser = getCurrentTurnUser();
        console.log(`🔍 Force Swap Menu - getCurrentTurnUser(): ${currentUser}`);
        console.log(`🔍 Force Swap Menu - turnAssignments:`, Array.from(turnAssignments.entries()));
        
        const royalCurrentUser = addRoyalEmojiTranslated(currentUser, userId);
        const buttons = [[{ text: t(userId, 'current_turn_button', {user: royalCurrentUser}), callback_data: `force_swap_select_${currentUser}` }]];
        
        sendMessageWithButtons(chatId, 
            `${t(userId, 'force_swap_current_turn')} **${royalCurrentUser}**\n\n${t(userId, 'swap_current_turn_with')}`, 
            buttons
        );
        
    } else if (data.startsWith('force_swap_select_')) {
        const firstUser = data ? data.replace('force_swap_select_', '') : '';
        
        if (!firstUser) {
            sendMessage(chatId, t(userId, 'error_invalid_selection'));
            return;
        }
        
        // Get all users from original queue excluding the current turn user
        const remainingUsers = originalQueue.filter(name => name !== firstUser);
        
        const buttons = remainingUsers.map(name => [{ text: addRoyalEmojiTranslated(name, userId), callback_data: `force_swap_execute_${firstUser}_${name}` }]);
        const royalFirstUser = addRoyalEmojiTranslated(firstUser, userId);
        
        sendMessageWithButtons(chatId, 
            `${t(userId, 'force_swap_step2')}\n\n🎯 **${t(userId, 'current_turn_label')}:** ${royalFirstUser}\n${t(userId, 'swap_with_select')}`, 
            buttons
        );
        
    } else if (data.startsWith('force_swap_execute_')) {
        const dataWithoutPrefix = data ? data.replace('force_swap_execute_', '') : '';
        const lastUnderscoreIndex = dataWithoutPrefix.lastIndexOf('_');
        
        if (lastUnderscoreIndex === -1 || dataWithoutPrefix.length === 0) {
            sendMessage(chatId, t(userId, 'error_invalid_swap_data'));
            return;
        }
        
        const firstUser = dataWithoutPrefix.substring(0, lastUnderscoreIndex);
        const secondUser = dataWithoutPrefix.substring(lastUnderscoreIndex + 1);
        
        if (!firstUser || !secondUser) {
            sendMessage(chatId, t(userId, 'error_invalid_swap_users'));
            return;
        }
        
        
        // In the new score-based system, force swap means:
        // The second user performs the first user's turn (favor/debt)
        // Only the performing user's score increases
        
        // Validate: firstUser must be either the original turn holder OR the currently performing user
        const originalTurnHolder = getOriginalTurnHolder();
        const currentPerformingUser = getCurrentTurnUser(); // The user currently performing the turn
        
        // Find the original turn holder for the current performing user (if they're performing someone's turn)
        let turnHolderForFirstUser = firstUser;
        for (const [user, assignedTo] of turnAssignments.entries()) {
            if (assignedTo === firstUser) {
                turnHolderForFirstUser = user; // firstUser is performing this user's turn
                break;
            }
        }
        
        // Allow swap if:
        // 1. firstUser is the original turn holder (they have their own turn), OR
        // 2. firstUser is the currently performing user (they can swap the turn they're performing)
        if (!originalTurnHolder || !currentPerformingUser) {
            console.log(`⚠️ No current turn holder found. originalTurnHolder: ${originalTurnHolder}, currentPerformingUser: ${currentPerformingUser}`);
            sendMessage(chatId, t(userId, 'no_one_in_queue'));
            return;
        }
        
        if (firstUser !== originalTurnHolder && firstUser !== currentPerformingUser) {
            const royalFirstUser = addRoyalEmojiTranslated(firstUser, userId);
            const royalCurrentUser = addRoyalEmojiTranslated(currentPerformingUser, userId);
            sendMessage(chatId, t(userId, 'error_cannot_force_swap', {
                firstUser: royalFirstUser,
                currentUser: royalCurrentUser
            }));
            console.log(`⚠️ Force swap rejected: ${firstUser} is neither the original turn holder (${originalTurnHolder}) nor the performing user (${currentPerformingUser})`);
            return;
        }
        
        // Determine the actual turn holder whose assignment will be updated
        let actualTurnHolder = firstUser;
        if (firstUser === currentPerformingUser && firstUser !== originalTurnHolder) {
            // firstUser is performing someone else's turn - find who they're performing for
            actualTurnHolder = turnHolderForFirstUser;
        }
        
        if (originalQueue.includes(firstUser) && originalQueue.includes(secondUser)) {
            // Initialize anti-cheating tracking for swaps
            if (!global.swapTimestamps) global.swapTimestamps = [];
            
            // Check for rapid swap activity (3+ swaps in 10 minutes)
            const now = Date.now();
            const tenMinutesAgo = now - (10 * 60 * 1000);
            
            // Remove old timestamps
            global.swapTimestamps = global.swapTimestamps.filter(timestamp => timestamp > tenMinutesAgo);
            
            // Add current timestamp
            global.swapTimestamps.push(now);
            
            // Check if too many swaps
            if (global.swapTimestamps.length >= 3) {
                alertAdminsAboutCheating(userId, userName, 'rapid_swaps', { 
                    swapCount: global.swapTimestamps.length,
                    timeWindow: '10 minutes'
                });
                console.log(`🚨 RAPID SWAPS DETECTED: ${userName} (${userId}) - ${global.swapTimestamps.length} swaps in 10 minutes`);
            }
            
            // OPTIMISTIC: Update in-memory state immediately
            // CRITICAL: Prevent circular assignments - clear any conflicting assignments first
            // Clear ALL assignments that could create circular references:
            // 1. If secondUser is already assigned to perform someone's turn
            for (const [existingHolder, existingAssignee] of turnAssignments.entries()) {
                if (existingAssignee === secondUser && existingHolder !== actualTurnHolder) {
                    // secondUser is already performing someone else's turn - clear it to prevent circular assignment
                    console.log(`🔄 Clearing conflicting assignment: ${existingHolder} -> ${secondUser} (to prevent circular assignment)`);
                    turnAssignments.delete(existingHolder);
                }
            }
            // 2. If secondUser's turn is assigned to someone else (and we're assigning actualTurnHolder to secondUser)
            if (turnAssignments.has(secondUser) && turnAssignments.get(secondUser) !== actualTurnHolder) {
                // secondUser has their turn assigned to someone else - clear it to prevent circular assignment
                console.log(`🔄 Clearing conflicting assignment: ${secondUser} -> ${turnAssignments.get(secondUser)} (to prevent circular assignment)`);
                turnAssignments.delete(secondUser);
            }
            // 3. If actualTurnHolder's turn is already assigned to secondUser, clear it first (avoid duplicate)
            if (turnAssignments.has(actualTurnHolder) && turnAssignments.get(actualTurnHolder) === secondUser) {
                // Already assigned correctly, but clear it first to ensure clean state
                console.log(`🔄 Clearing existing assignment: ${actualTurnHolder} -> ${secondUser} (will be re-set)`);
                turnAssignments.delete(actualTurnHolder);
            }
            // 4. If actualTurnHolder is assigned to perform someone else's turn, clear that too
            for (const [existingHolder, existingAssignee] of turnAssignments.entries()) {
                if (existingAssignee === actualTurnHolder && existingHolder !== actualTurnHolder) {
                    // actualTurnHolder is performing someone else's turn - this shouldn't happen, but clear it
                    console.log(`🔄 Clearing unexpected assignment: ${existingHolder} -> ${actualTurnHolder} (actualTurnHolder shouldn't be performing another turn)`);
                    turnAssignments.delete(existingHolder);
                }
            }
            
            // Handle swap-back: if swapping back to the original turn holder, clear the assignment
            if (secondUser === actualTurnHolder) {
                // Swapping back to original holder - remove assignment
                turnAssignments.delete(actualTurnHolder);
                console.log(`🔄 Force swap back: Removing assignment from ${actualTurnHolder} to ${firstUser}, now ${actualTurnHolder} performs their own turn`);
                // Mark as dirty for database save
                dirtyKeys.add('turnAssignments');
                isDirty = true;
            } else {
                // Regular swap: assign the actual turn holder to the second user
                turnAssignments.set(actualTurnHolder, secondUser);
                console.log(`🔄 Force swap: ${actualTurnHolder}'s turn assigned to ${secondUser}`);
                console.log(`📋 Debug: turnAssignments after set:`, Array.from(turnAssignments.entries()));
                // Mark as dirty for database save
                dirtyKeys.add('turnAssignments');
                isDirty = true;
            }
            
            // Verify assignment immediately after setting
            const verifyAssignment = turnAssignments.get(actualTurnHolder);
            console.log(`✅ Debug: Verifying assignment - ${actualTurnHolder} -> ${verifyAssignment} (expected: ${secondUser})`);
            const verifyCurrentTurn = getCurrentTurnUser();
            console.log(`✅ Debug: getCurrentTurnUser() after swap: ${verifyCurrentTurn} (expected: ${secondUser})`);
            
            // CRITICAL VERIFICATION: Ensure assignment is correctly set and getCurrentTurnUser() reflects it
            if (verifyAssignment !== secondUser) {
                console.error(`❌ CRITICAL ERROR: Assignment mismatch! Expected ${secondUser}, got ${verifyAssignment}`);
            }
            if (verifyCurrentTurn !== secondUser) {
                console.error(`❌ CRITICAL ERROR: getCurrentTurnUser() mismatch! Expected ${secondUser}, got ${verifyCurrentTurn}`);
                console.error(`❌ turnAssignments contents:`, Array.from(turnAssignments.entries()));
                console.error(`❌ originalTurnHolder: ${originalTurnHolder}, actualTurnHolder: ${actualTurnHolder}`);
            }
            
            // Track admin force swap for monthly report
            trackMonthlyAction('admin_force_swap', actualTurnHolder, userName);
            
            // OPTIMISTIC: Send notifications immediately (swap is logically done)
            // After the swap, the current turn is performed by secondUser (or actualTurnHolder if swap-back)
            const currentTurnUser = (secondUser === actualTurnHolder) ? actualTurnHolder : secondUser;
            
            // Notify all authorized users and admins immediately
            [...authorizedUsers, ...admins].forEach(user => {
                let userChatId = userChatIds.get(user) || (user ? userChatIds.get(user.toLowerCase()) : null);
                
                // If not found in userChatIds, check if this user is an admin
                if (!userChatId && isUserAdmin(user)) {
                    userChatId = adminNameToChatId.get(user) || (user ? adminNameToChatId.get(user.toLowerCase()) : null);
                }
                
                if (userChatId && userChatId !== chatId) {
                    // Get the correct userId for language preference
                    const recipientUserId = getUserIdFromChatId(userChatId);
                    
                    // Create message in recipient's language
                    let message;
                    if (secondUser === actualTurnHolder) {
                        // Swap back - assignment removed, actualTurnHolder performs their own turn
                        message = `⚡ **${t(recipientUserId, 'admin_force_swap_executed')}**\n\n🔄 **${translateName(actualTurnHolder, recipientUserId)} ${t(recipientUserId, 'assigned_to_perform')} ${translateName(actualTurnHolder, recipientUserId)} ${t(recipientUserId, 'turn')}** (Swap back)\n\n🎯 **${t(recipientUserId, 'current_turn_label')}:** ${translateName(currentTurnUser, recipientUserId)}`;
                    } else {
                        // Regular swap - secondUser is now performing the turn
                        message = `⚡ **${t(recipientUserId, 'admin_force_swap_executed')}**\n\n🔄 **${translateName(secondUser, recipientUserId)} ${t(recipientUserId, 'assigned_to_perform')} ${translateName(actualTurnHolder, recipientUserId)} ${t(recipientUserId, 'turn')}**\n\n🎯 **${t(recipientUserId, 'current_turn_label')}:** ${translateName(currentTurnUser, recipientUserId)}`;
                    }
                    console.log(`🔔 Sending force swap notification to ${user} (${userChatId}, userId: ${recipientUserId})`);
                    sendMessage(userChatId, message);
                } else {
                    console.log(`🔔 No chat ID found for ${user} or is the admin who performed swap`);
                }
            });
            
            // Send confirmation to admin
            let confirmationMessage;
            if (secondUser === actualTurnHolder) {
                // Swap back - actualTurnHolder performs their own turn
                confirmationMessage = `${t(userId, 'force_swap_completed')}\n\n🔄 **${translateName(actualTurnHolder, userId)} ${t(userId, 'assigned_to_perform')} ${translateName(actualTurnHolder, userId)} ${t(userId, 'turn')}** (Swap back)\n\n🎯 **${t(userId, 'current_turn_label')}:** ${translateName(currentTurnUser, userId)}`;
            } else {
                // Regular swap - secondUser is now performing the turn
                confirmationMessage = `${t(userId, 'force_swap_completed')}\n\n🔄 **${translateName(secondUser, userId)} ${t(userId, 'assigned_to_perform')} ${translateName(actualTurnHolder, userId)} ${t(userId, 'turn')}**\n\n🎯 **${t(userId, 'current_turn_label')}:** ${translateName(currentTurnUser, userId)}`;
            }
            sendMessage(chatId, confirmationMessage);
            
            // BACKGROUND: Retry database operations
            const dbSuccess = await retryDatabaseOperation(async () => {
                // PHASE 1: Track bot state changes
                dirtyKeys.add('turnAssignments');
                isDirty = true;
                
                // PHASE 2: Save to database
                await saveBotData();
            });
            
            if (!dbSuccess) {
                // Notify admins only after 2 failed attempts
                notifyDatabaseError(chatId, userId, userName, true);
                
                // Schedule retry after 5 seconds
                setTimeout(async () => {
                    console.log('🔄 Retrying force swap database save...');
                    const retrySuccess = await retryDatabaseOperation(async () => {
                        // PHASE 1: Track bot state changes
                        dirtyKeys.add('turnAssignments');
                        isDirty = true;
                        
                        // PHASE 2: Save to database
                        await saveBotData();
                    });
                    
                    if (retrySuccess) {
                        // Notify admins about success
                        [...admins].forEach(admin => {
                            let adminChatId = userChatIds.get(admin) || (admin ? userChatIds.get(admin.toLowerCase()) : null);
                            if (!adminChatId && isUserAdmin(admin)) {
                                adminChatId = adminNameToChatId.get(admin) || (admin ? adminNameToChatId.get(admin.toLowerCase()) : null);
                            }
                            if (adminChatId && adminChatId !== chatId) {
                                const recipientUserId = getUserIdFromChatId(adminChatId);
                                sendMessage(adminChatId, t(recipientUserId, 'database_updated_force_swap'));
                            }
                        });
                    } else {
                        console.log('❌ Force swap database save failed on retry');
                        // Notify both affected users and admins about final failure
                        sendMessage(chatId, t(userId, 'database_error_force_swap'));
                        
                        // Notify both affected users
                        [firstUser, secondUser].forEach(affectedUser => {
                            let affectedUserChatId = userChatIds.get(affectedUser) || (affectedUser ? userChatIds.get(affectedUser.toLowerCase()) : null);
                            if (affectedUserChatId && affectedUserChatId !== chatId) {
                                const affectedUserId = getUserIdFromChatId(affectedUserChatId);
                                sendMessage(affectedUserChatId, t(affectedUserId, 'database_error_force_swap'));
                            }
                        });
                        
                        // Notify admins
                        [...admins].forEach(admin => {
                            let adminChatId = userChatIds.get(admin) || (admin ? userChatIds.get(admin.toLowerCase()) : null);
                            if (!adminChatId && isUserAdmin(admin)) {
                                adminChatId = adminNameToChatId.get(admin) || (admin ? adminNameToChatId.get(admin.toLowerCase()) : null);
                            }
                            if (adminChatId && adminChatId !== chatId) {
                                const recipientUserId = getUserIdFromChatId(adminChatId);
                                sendMessage(adminChatId, t(recipientUserId, 'database_error_force_swap'));
                            }
                        });
                    }
                }, 5000);
            }
        } else {
            sendMessage(chatId, t(userId, 'error_users_not_found'));
        }
        
    } else if (data === 'assist_menu') {
        // Assist menu - execute /assist command functionality
        const isAdmin = isUserAdmin(userName, userId);
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        // Execute the same logic as /assist command
        const description = "Dishwasher cleaned by admin";
        
        // Check for rapid ASSIST activity (30 minutes) - global tracking
        const now = Date.now();
        const lastGlobalDone = global.lastDishwasherDone;
        
        if (lastGlobalDone && (now - lastGlobalDone) < 30 * 60 * 1000) { // 30 minutes
            const lastDoneTime = new Date(lastGlobalDone).toLocaleString();
            // Send alert for ANY ASSIST within 30 minutes of last dishwasher completion
            alertAdminsAboutCheating(userId, userName, 'rapid_done', { lastDone: lastDoneTime });
            console.log(`🚨 RAPID ASSIST DETECTED: ${userName} (${userId}) - Last dishwasher done: ${lastDoneTime}`);
        }
        
        // Update global dishwasher completion timestamp
        global.lastDishwasherDone = now;
        
        // Mark dishwasher as completed IMMEDIATELY (before async operations) to prevent race condition
        // This ensures that if "dishwasher started" is pressed during ASSIST execution, the state is already correct
        global.dishwasherCompleted = true;
        global.dishwasherStarted = false; // Reset for next cycle
        global.dishwasherStartedAt = null; // Clear timer timestamp
        
        // Save dishwasher state to database
        await db.saveBotState('dishwasherCompleted', true);
        await db.saveBotState('dishwasherStarted', false);
        await db.saveBotState('dishwasherStartedAt', null);
        
        if (global.dishwasherAutoAlertTimer) {
            clearTimeout(global.dishwasherAutoAlertTimer);
            global.dishwasherAutoAlertTimer = null;
        }
        
        // Track the assist action for monthly statistics
        trackMonthlyAction('admin_assist', null, userName);
        
        // Save bot data after tracking
        await saveBotData();
        
        // Send confirmation message
        const timeString = new Date().toLocaleString();
        const currentUser = getCurrentTurnUser();
        const assistMessage = t(userId, 'assist_logged', {
            description: description,
            admin: translateName(userName, userId),
            time: timeString,
            currentUser: translateName(currentUser, userId)
        });
        
        // Send confirmation to admin immediately
        sendMessage(chatId, assistMessage);
        
        // Notify all authorized users and admins immediately
        [...authorizedUsers, ...admins].forEach(user => {
            let userChatId = userChatIds.get(user) || (user ? userChatIds.get(user.toLowerCase()) : null);
            
            // If not found in userChatIds, check if this user is an admin
            if (!userChatId && isUserAdmin(user)) {
                userChatId = adminNameToChatId.get(user) || (user ? adminNameToChatId.get(user.toLowerCase()) : null);
            }
            
            if (userChatId && userChatId !== chatId) {
                const recipientUserId = getUserIdFromChatId(userChatId);
                
                // Translate description to recipient's language
                const translatedDescription = translateDescription(description, recipientUserId);
                
                const userAssistMessage = t(recipientUserId, 'assist_logged', {
                    description: translatedDescription,
                    admin: translateName(userName, recipientUserId),
                    time: timeString,
                    currentUser: translateName(currentUser, recipientUserId)
                });
                
                console.log(`🔔 Sending admin assist notification to ${user} (${userChatId}, userId: ${recipientUserId})`);
                sendMessage(userChatId, userAssistMessage);
            }
        });
        
        console.log(`🤝 Admin assist logged: ${userName} - ${description}`);
        
    } else if (data === 'request_punishment_menu') {
        const isAuthorized = isUserAuthorized(userName);
        if (!isAuthorized) {
            sendMessage(chatId, t(userId, 'not_authorized_punishment'));
            return;
        }
        
        // For punishment requests, we need to find the user's position in the queue
        // Since userName is canonical ("Adele"), we need to find their queue representation
        let currentUserQueueName = null;
        for (const [canonicalName, queueName] of userQueueMapping.entries()) {
            if (canonicalName === userName) {
                currentUserQueueName = queueName;
                break;
            }
        }
        
        // Fallback: if not found in mapping, use userName directly
        if (!currentUserQueueName) {
            currentUserQueueName = userName;
        }
        const availableUsers = queue.filter(name => name !== currentUserQueueName);
        
        if (availableUsers.length === 0) {
            sendMessage(chatId, t(userId, 'no_users_available_report'));
            return;
        }
        
        const buttons = availableUsers.map(name => [{ text: addRoyalEmojiTranslated(name, userId), callback_data: `punishment_target_${name}` }]);
        
        sendMessageWithButtons(chatId, 
            t(userId, 'request_punishment_select_user'), 
            buttons
        );
        
    } else if (data.startsWith('punishment_target_')) {
        const targetUser = data ? data.replace('punishment_target_', '') : '';
        
        if (!targetUser) {
            sendMessage(chatId, t(userId, 'error_invalid_selection'));
            return;
        }
        
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
        // Parse callback data: punishment_reason_${targetUser}_${reason}
        // Reason may contain spaces (e.g., "Household Rules"), so we need to split carefully
        const dataAfterPrefix = data.replace('punishment_reason_', '');
        const firstUnderscore = dataAfterPrefix.indexOf('_');
        const targetUser = firstUnderscore > 0 ? dataAfterPrefix.substring(0, firstUnderscore) : '';
        const reason = firstUnderscore > 0 ? dataAfterPrefix.substring(firstUnderscore + 1) : '';
        
        if (!targetUser || !reason) {
            sendMessage(chatId, t(userId, 'error_invalid_punishment_data'));
            return;
        }
        
        // Create punishment request (similar to swap request system)
        const requestId = ++punishmentRequestCounter;
        
        pendingPunishments.set(requestId, {
            fromUser: userName,
            targetUser: targetUser,
            reason: reason,
            fromUserId: chatId, // Store chatId for consistency with swap requests and for sendMessage
            timestamp: Date.now()
        });
        
        // Track punishment request for monthly report
        trackMonthlyAction('punishment_request', userName);
        
        // Notify all admins with approval/rejection buttons in their language
        // Send to all admins with localized message and buttons
        for (const adminChatId of adminChatIds) {
            if (adminChatId !== chatId) { // Don't notify the requester
                // Get the correct userId for language preference
                const adminUserId = getUserIdFromChatId(adminChatId);
                
                // Create message in admin's language
                const adminMessage = `${t(adminUserId, 'punishment_request_title')}\n\n${t(adminUserId, 'from_user')}: ${translateName(userName, adminUserId)}\n${t(adminUserId, 'target_user')}: ${translateName(targetUser, adminUserId)}\n${t(adminUserId, 'reason')}: ${translateReason(reason, adminUserId)}`;
                const buttons = createLocalizedButtons(adminUserId, [
                    [
                        { translationKey: 'approve', callback_data: `punishment_approve_${requestId}` },
                        { translationKey: 'reject', callback_data: `punishment_reject_${requestId}` }
                    ]
                ]);
                console.log(`🔔 Sending admin punishment notification to chat ID: ${adminChatId}`);
                sendMessageWithButtons(adminChatId, adminMessage, buttons);
            }
        }
        
        sendMessage(chatId, `${t(userId, 'punishment_request_submitted')}\n\n${t(userId, 'target_user')} ${translateName(targetUser, userId)}\n${t(userId, 'reason')} ${translateReason(reason, userId)}\n${t(userId, 'requested_by', {user: translateName(userName, userId)})}\n\n${t(userId, 'admins_notified')}`);
        
    } else if (data.startsWith('punishment_approve_')) {
        const requestId = data ? parseInt(data.replace('punishment_approve_', '')) : 0;
        
        if (isNaN(requestId) || requestId <= 0) {
            sendMessage(chatId, t(userId, 'error_invalid_request_id'));
            return;
        }
        
        const punishmentRequest = pendingPunishments.get(requestId);
        
        if (!punishmentRequest) {
            sendMessage(chatId, t(userId, 'punishment_request_expired'));
            return;
        }
        
        // Check if this is an admin
        const isAdmin = isUserAdmin(userName, userId);
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        // Apply punishment
        await applyPunishment(punishmentRequest.targetUser, punishmentRequest.reason, userName);
        
        // Send confirmation to admin who approved
        sendMessage(chatId, `${t(userId, 'punishment_approved')}\n\n${t(userId, 'target_user')} ${translateName(punishmentRequest.targetUser, userId)}\n${t(userId, 'reason')} ${translateReason(punishmentRequest.reason, userId)}\n${t(userId, 'approved_by')} ${translateName(userName, userId)}\n\n${t(userId, 'extra_turns_applied')}`);
        
        // Notify requester
        const requesterUserId = getUserIdFromChatId(punishmentRequest.fromUserId);
        sendMessage(punishmentRequest.fromUserId, `${t(requesterUserId, 'punishment_approved')}\n\n${t(requesterUserId, 'target_user')} ${translateName(punishmentRequest.targetUser, requesterUserId)}\n${t(requesterUserId, 'reason')} ${translateReason(punishmentRequest.reason, requesterUserId)}\n${t(requesterUserId, 'approved_by')} ${translateName(userName, requesterUserId)}`);
        
        // Notify all other authorized users and admins about the approval in their language
        
        // Notify all authorized users
        [...authorizedUsers].forEach(user => {
            let userChatId = userChatIds.get(user) || (user ? userChatIds.get(user.toLowerCase()) : null);
            if (userChatId && userChatId !== chatId && userChatId !== punishmentRequest.fromUserId) {
                // Get the correct userId for language preference
                const recipientUserId = getUserIdFromChatId(userChatId);
                
                // Create approval message in user's language
                const approvalMessage = `${t(recipientUserId, 'punishment_request_approved')}\n\n${t(recipientUserId, 'requested_by', {user: translateName(punishmentRequest.fromUser, recipientUserId)})}\n${t(recipientUserId, 'target_user')} ${translateName(punishmentRequest.targetUser, recipientUserId)}\n${t(recipientUserId, 'reason')} ${translateReason(punishmentRequest.reason, recipientUserId)}\n${t(recipientUserId, 'approved_by')} ${translateName(userName, recipientUserId)}\n\n${t(recipientUserId, 'extra_turns_applied')}`;
                console.log(`🔔 Sending punishment approval notification to ${user} (${userChatId}, userId: ${recipientUserId})`);
                sendMessage(userChatId, approvalMessage);
            }
        });
        
        // Notify all admins using adminChatIds
        for (const adminChatId of adminChatIds) {
            if (adminChatId !== chatId && adminChatId !== punishmentRequest.fromUserId) {
                // Get the correct userId for language preference
                const adminUserId = getUserIdFromChatId(adminChatId);
                
                // Create approval message in admin's language
                const approvalMessage = `${t(adminUserId, 'punishment_request_approved')}\n\n${t(adminUserId, 'requested_by', {user: translateName(punishmentRequest.fromUser, adminUserId)})}\n${t(adminUserId, 'target_user')} ${translateName(punishmentRequest.targetUser, adminUserId)}\n${t(adminUserId, 'reason')} ${translateReason(punishmentRequest.reason, adminUserId)}\n${t(adminUserId, 'approved_by')} ${translateName(userName, adminUserId)}\n\n${t(adminUserId, 'extra_turns_applied')}`;
                console.log(`🔔 Sending punishment approval notification to admin chat ID: ${adminChatId} (userId: ${adminUserId})`);
                sendMessage(adminChatId, approvalMessage);
            }
        }
        
        // Remove request
        pendingPunishments.delete(requestId);
        
    } else if (data.startsWith('punishment_reject_')) {
        const requestId = data ? parseInt(data.replace('punishment_reject_', '')) : 0;
        
        if (isNaN(requestId) || requestId <= 0) {
            sendMessage(chatId, t(userId, 'error_invalid_request_id'));
            return;
        }
        
        const punishmentRequest = pendingPunishments.get(requestId);
        
        if (!punishmentRequest) {
            sendMessage(chatId, t(userId, 'punishment_request_expired'));
            return;
        }
        
        // Check if this is an admin
        const isAdmin = isUserAdmin(userName, userId);
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        // Notify requester
        const requesterUserId = getUserIdFromChatId(punishmentRequest.fromUserId);
        sendMessage(punishmentRequest.fromUserId, `${t(requesterUserId, 'punishment_request_rejected')}\n\n${t(requesterUserId, 'declined_punishment_request', {admin: translateName(userName, requesterUserId), target: translateName(punishmentRequest.targetUser, requesterUserId)})}`);
        sendMessage(chatId, `${t(userId, 'punishment_request_rejected')}\n\n${t(userId, 'you_declined_punishment', {requester: translateName(punishmentRequest.fromUser, userId)})}`);
        
        // Notify all other authorized users and admins about the rejection in their language
        
        // Notify all authorized users
        [...authorizedUsers].forEach(user => {
            let userChatId = userChatIds.get(user) || (user ? userChatIds.get(user.toLowerCase()) : null);
            if (userChatId && userChatId !== chatId && userChatId !== punishmentRequest.fromUserId) {
                // Get the correct userId for language preference
                const recipientUserId = getUserIdFromChatId(userChatId);
                
                // Create rejection message in user's language
                const rejectionMessage = `${t(recipientUserId, 'punishment_request_rejected')}\n\n${t(recipientUserId, 'requested_by', {user: translateName(punishmentRequest.fromUser, recipientUserId)})}\n${t(recipientUserId, 'target_user')} ${translateName(punishmentRequest.targetUser, recipientUserId)}\n${t(recipientUserId, 'reason')} ${translateReason(punishmentRequest.reason, recipientUserId)}\n${t(recipientUserId, 'rejected_by', {user: translateName(userName, recipientUserId)})}`;
                console.log(`🔔 Sending punishment rejection notification to ${user} (${userChatId}, userId: ${recipientUserId})`);
                sendMessage(userChatId, rejectionMessage);
            }
        });
        
        // Notify all admins using adminChatIds
        for (const adminChatId of adminChatIds) {
            if (adminChatId !== chatId && adminChatId !== punishmentRequest.fromUserId) {
                // Get the correct userId for language preference
                const adminUserId = getUserIdFromChatId(adminChatId);
                
                // Create rejection message in admin's language
                const rejectionMessage = `${t(adminUserId, 'punishment_request_rejected')}\n\n${t(adminUserId, 'requested_by', {user: translateName(punishmentRequest.fromUser, adminUserId)})}\n${t(adminUserId, 'target_user')} ${translateName(punishmentRequest.targetUser, adminUserId)}\n${t(adminUserId, 'reason')} ${translateReason(punishmentRequest.reason, adminUserId)}\n${t(adminUserId, 'rejected_by', {user: translateName(userName, adminUserId)})}`;
                console.log(`🔔 Sending punishment rejection notification to admin chat ID: ${adminChatId} (userId: ${adminUserId})`);
                sendMessage(adminChatId, rejectionMessage);
            }
        }
        
        // Remove request
        pendingPunishments.delete(requestId);
        
    } else if (data === 'apply_punishment_menu') {
        const isAdmin = isUserAdmin(userName, userId);
        if (!isAdmin) {
            sendMessage(chatId, t(userId, 'admin_access_required'));
            return;
        }
        
        // Get unique users from the queue to avoid duplicate buttons
        const uniqueUsers = [...new Set(queue)];
        const buttons = uniqueUsers.map(name => [{ text: addRoyalEmojiTranslated(name, userId), callback_data: `admin_punish_${name}` }]);
        
        sendMessageWithButtons(chatId, 
            t(userId, 'apply_punishment_select_user'), 
            buttons
        );
        
    } else if (data.startsWith('admin_punish_')) {
        const targetUser = data ? data.replace('admin_punish_', '') : '';
        
        if (!targetUser) {
            sendMessage(chatId, t(userId, 'error_invalid_selection'));
            return;
        }
        
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
        // Parse callback data: admin_punishment_reason_${targetUser}_${reason}
        // Reason may contain spaces (e.g., "Household Rules"), so we need to split carefully
        const dataAfterPrefix = data.replace('admin_punishment_reason_', '');
        const firstUnderscore = dataAfterPrefix.indexOf('_');
        const targetUser = firstUnderscore > 0 ? dataAfterPrefix.substring(0, firstUnderscore) : '';
        const reason = firstUnderscore > 0 ? dataAfterPrefix.substring(firstUnderscore + 1) : '';
        
        if (!targetUser || !reason) {
            sendMessage(chatId, t(userId, 'error_invalid_punishment_data'));
            return;
        }
        
        // Apply punishment directly with selected reason
        await applyPunishment(targetUser, reason, userName);
        sendMessage(chatId, `${t(userId, 'punishment_applied')}\n\n${t(userId, 'target_user')} ${translateName(targetUser, userId)}\n${t(userId, 'reason')} ${translateReason(reason, userId)}\n${t(userId, 'applied_by')} ${translateName(userName, userId)}\n\n${t(userId, 'extra_turns_added')}`);
        
        // Notify all authorized users and admins about the admin direct punishment in their language
        
        // Notify all authorized users
        [...authorizedUsers].forEach(user => {
            let userChatId = userChatIds.get(user) || (user ? userChatIds.get(user.toLowerCase()) : null);
            if (userChatId && userChatId !== chatId) {
                // Get the correct userId for language preference
                const recipientUserId = getUserIdFromChatId(userChatId);
                
                // Create notification message in user's language with translated names and reason
                const notificationMessage = `${t(recipientUserId, 'admin_direct_punishment')}\n\n${t(recipientUserId, 'target_user')} ${translateName(targetUser, recipientUserId)}\n${t(recipientUserId, 'reason')} ${translateReason(reason, recipientUserId)}\n${t(recipientUserId, 'applied_by')} ${translateName(userName, recipientUserId)}\n\n${t(recipientUserId, 'extra_turns_added')}`;
                console.log(`🔔 Sending admin direct punishment notification to ${user} (${userChatId}, userId: ${recipientUserId})`);
                sendMessage(userChatId, notificationMessage);
            }
        });
        
        // Notify all admins using adminChatIds
        for (const adminChatId of adminChatIds) {
            if (adminChatId !== chatId) {
                // Get the correct userId for language preference
                const adminUserId = getUserIdFromChatId(adminChatId);
                
                // Create notification message in admin's language with translated names and reason
                const notificationMessage = `${t(adminUserId, 'admin_direct_punishment')}\n\n${t(adminUserId, 'target_user')} ${translateName(targetUser, adminUserId)}\n${t(adminUserId, 'reason')} ${translateReason(reason, adminUserId)}\n${t(adminUserId, 'applied_by')} ${translateName(userName, adminUserId)}\n\n${t(adminUserId, 'extra_turns_added')}`;
                console.log(`🔔 Sending admin direct punishment notification to admin chat ID: ${adminChatId} (userId: ${adminUserId})`);
                sendMessage(adminChatId, notificationMessage);
            }
        }
        
    } else {
        sendMessage(chatId, t(userId, 'unknown_button_action'));
    }
    } catch (error) {
        console.error('❌ Error in handleCallback:', error);
        sendMessage(chatId, t(userId, 'error_occurred'));
    }
}

// Get updates from Telegram
async function getUpdates(offset = 0) {
    const url = `${botUrl}/getUpdates?offset=${offset}&timeout=30`;
    
    https.get(url, async (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', async () => {
            try {
                const response = JSON.parse(data);
                
                if (response.ok && response.result.length > 0) {
                    let lastUpdateId = 0;
                    
                    for (const update of response.result) {
                        lastUpdateId = update.update_id;
                        
                        // Deduplication: Skip if this update was already processed
                        if (processedUpdates.has(update.update_id)) {
                            console.log(`🔄 Skipping duplicate update ${update.update_id} (instance: ${instanceId})`);
                            continue;
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
                            const fullName = update.message.from.first_name + 
                                (update.message.from.last_name ? ' ' + update.message.from.last_name : '');
                            const userName = getFirstName(fullName); // Use first name only
                            const text = update.message.text;
                            
                            await handleCommand(chatId, userId, userName, text);
                        }
                        
                        if (update.callback_query) {
                            const chatId = update.callback_query.message.chat.id;
                            const userId = update.callback_query.from.id;
                            const fullName = (update.callback_query.from.first_name || '') + 
                                (update.callback_query.from.last_name ? ' ' + update.callback_query.from.last_name : '');
                            const userName = getFirstName(fullName || 'Unknown User'); // Use first name only
                            
                            // Safety check for userName
                            if (!userName) {
                                console.log(`❌ Error: userName is undefined for callback query from userId ${userId}`);
                                continue;
                            }
                            
                            const data = update.callback_query.data;
                            
                            // Button click deduplication: prevent rapid multiple clicks on same button
                            const now = Date.now();
                            const lastAction = lastUserAction.get(userId);
                            
                            if (lastAction && lastAction.action === data && (now - lastAction.timestamp) < ACTION_COOLDOWN) {
                                console.log(`🔄 Skipping rapid button click: ${data} by ${userName} (cooldown: ${ACTION_COOLDOWN}ms)`);
                                continue;
                            }
                            
                            // Update last action
                            lastUserAction.set(userId, { action: data, timestamp: now });
                            
                            await handleCallback(chatId, userId, userName, data);
                            
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
                            
    const answerReq = https.request(answerUrl, { ...answerOptions, agent: telegramHttpsAgent });
                            answerReq.write(answerData);
                            answerReq.end();
                        }
                    }
                    
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
// Keep-alive mechanism removed - now handled by dedicated keep_alive.js process

// HTTP server for webhook and health check (Render expects health on main port)
const server = http.createServer(async (req, res) => {
    // Use WHATWG URL API instead of deprecated url.parse()
    try {
        const baseUrl = `http://${req.headers.host || 'localhost'}`;
        const urlObj = new URL(req.url, baseUrl);
        
        // Health check endpoint (Render expects this on main port)
        if (urlObj.pathname === '/health') {
        res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache'
        });
        
        const healthData = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            instance: instanceId,
            service: 'dishwasher-bot-main',
            uptime: process.uptime(),
            memory: {
                rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
                heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
                heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
            },
            queue: queue.length,
            currentTurnUser: getCurrentTurnUser()
        };
        
        res.end(JSON.stringify(healthData, null, 2));
        console.log(`✅ Health check responded: ${new Date().toISOString()}`);
        return;
    }
    
    // Simple test endpoint for debugging
    if (urlObj.pathname === '/test') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'ok', 
            message: 'Server is running',
            timestamp: new Date().toISOString(),
            port: PORT,
            host: '0.0.0.0'
        }));
        return;
    }
    
    // Webhook endpoint for Telegram
    if (urlObj.pathname === '/webhook' && req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', async () => {
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
                    const fullName = update.message.from.first_name + 
                        (update.message.from.last_name ? ' ' + update.message.from.last_name : '');
                    const userName = getFirstName(fullName); // Use first name only
                    const text = update.message.text;
                    
                    await handleCommand(chatId, userId, userName, text);
                }
                
                if (update.callback_query) {
                    const chatId = update.callback_query.message.chat.id;
                    const userId = update.callback_query.from.id;
                    const fullName = (update.callback_query.from.first_name || '') + 
                        (update.callback_query.from.last_name ? ' ' + update.callback_query.from.last_name : '');
                    const userName = getFirstName(fullName || 'Unknown User'); // Use first name only
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
                    
                    await handleCallback(chatId, userId, userName, data);
                    
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
    } catch (error) {
        // Handle URL parsing errors gracefully
        console.log(`❌ Error parsing URL: ${error.message}`);
        res.writeHead(400);
        res.end('Bad Request');
    }
});

// Start server for Render deployment or if PORT is explicitly set
// Broadcast functions for announcements and messages
function broadcastAnnouncement(announcementText, fromAdmin) {
    const timestamp = new Date().toLocaleString();
    
    // Send to all authorized users and admins
    [...authorizedUsers, ...admins].forEach(user => {
        let userChatId = userChatIds.get(user) || (user ? userChatIds.get(user.toLowerCase()) : null);
        
        // If not found in userChatIds, check if this user is an admin
        if (!userChatId && isUserAdmin(user)) {
            userChatId = adminNameToChatId.get(user) || (user ? adminNameToChatId.get(user.toLowerCase()) : null);
        }
        
        if (userChatId) {
            // Get the correct userId for language preference
            const recipientUserId = getUserIdFromChatId(userChatId);
            
            // Create announcement in recipient's language (interface only)
            const announcement = `📢 ${t(recipientUserId, 'announcement')}\n\n` +
                               `${announcementText}\n\n` +  // Content unchanged
                               `👨‍💼 ${t(recipientUserId, 'from_admin')}: ${translateName(fromAdmin, recipientUserId)}\n` +
                               `🕐 ${t(recipientUserId, 'time')}: ${timestamp}`;
            
            // Add acknowledgment button
            const buttons = [
                [{ text: t(recipientUserId, 'got_it'), callback_data: 'acknowledge_announcement' }]
            ];
            
            sendMessageWithButtons(userChatId, announcement, buttons);
        }
    });
}

function broadcastMessage(messageText, fromUser, isAnnouncement = false) {
    const timestamp = new Date().toLocaleString();
    
    // Send to all authorized users and admins (except sender)
    [...authorizedUsers, ...admins].forEach(user => {
        if (user === fromUser || (user && fromUser && user.toLowerCase() === fromUser.toLowerCase())) {
            return; // Don't send to sender
        }
        
        let userChatId = userChatIds.get(user) || (user ? userChatIds.get(user.toLowerCase()) : null);
        
        // If not found in userChatIds, check if this user is an admin
        if (!userChatId && isUserAdmin(user)) {
            userChatId = adminNameToChatId.get(user) || (user ? adminNameToChatId.get(user.toLowerCase()) : null);
        }
        
        if (userChatId) {
            // Get the correct userId for language preference
            const recipientUserId = getUserIdFromChatId(userChatId);
            
            // Create message in recipient's language (interface only)
            const message = `💬 ${t(recipientUserId, 'message_from')} ${translateName(fromUser, recipientUserId)}\n\n` +
                           `${messageText}\n\n` +  // Content unchanged
                           `🕐 ${t(recipientUserId, 'time')}: ${timestamp}`;
            
            // Add like button
            const buttons = [
                [{ text: t(recipientUserId, 'like'), callback_data: 'like_message' }]
            ];
            
            sendMessageWithButtons(userChatId, message, buttons);
        }
    });
}

const PORT = process.env.PORT || 3000;
if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    // Always start server on Render - bind to 0.0.0.0 for external access
    server.listen(PORT, '0.0.0.0', async () => {
        console.log(`🚀 Bot webhook server running on port ${PORT} (0.0.0.0)`);
        console.log(`🌐 Health check: https://${process.env.RENDER_EXTERNAL_HOSTNAME}/health`);
        console.log(`🔗 Webhook endpoint: https://${process.env.RENDER_EXTERNAL_HOSTNAME}/webhook`);
        
        // Data is already loaded in db.db.on('open') handler above
        console.log('✅ Bot startup complete - data already loaded');
});
} else {
    console.log(`🏠 Running in LOCAL MODE - No HTTP server, using polling only`);
    
    // Data is already loaded in db.db.on('open') handler above
    console.log('✅ Local mode startup complete - data already loaded');
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
    
    const webhookReq = https.request(`${botUrl}/setWebhook`, { ...webhookOptions, agent: telegramHttpsAgent }, (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
            responseData += chunk;
        });
        res.on('end', () => {
            console.log('🔗 Webhook response:', responseData);
            console.log('✅ Bot ready with webhook mode');
        });
    });
    
    webhookReq.write(webhookData);
    webhookReq.end();
} else {
    // Use polling for local development only
    console.log('🏠 Running in LOCAL MODE - Using polling only');
console.log('🤖 Simple Telegram Dishwasher Bot is ready!');
console.log('📱 Bot is now listening for commands...');
console.log('🔍 Search for: @aronov_dishwasher_bot');

    // Start polling for updates (only in local mode)
getUpdates();
}

// Keep-alive mechanism removed - now handled by dedicated keep_alive.js process

// Automatic monthly report system
function checkAndSendMonthlyReport() {
    const now = new Date();
    
    // Check Israeli time for consistency
    const israeliHour = parseInt(now.toLocaleString('en-US', {timeZone: 'Asia/Jerusalem', hour: 'numeric', hour12: false}));
    const israeliMinute = parseInt(now.toLocaleString('en-US', {timeZone: 'Asia/Jerusalem', minute: 'numeric'}));
    
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const isLastDayOfMonth = now.getDate() === lastDayOfMonth;
    const isMorningTime = israeliHour === 10 && israeliMinute >= 0 && israeliMinute < 5; // Between 10:00-10:04 Israeli time
    
    console.log(`📅 Monthly report check: ${now.toISOString()} - Last day: ${isLastDayOfMonth}, Morning time (Israeli): ${israeliHour}:${israeliMinute.toString().padStart(2, '0')}, isMorningTime: ${isMorningTime}`);
    
    if (isLastDayOfMonth && isMorningTime) {
        console.log('📊 Sending automatic monthly report...');
        const currentMonthKey = getCurrentMonthKey();
        broadcastMonthlyReport(currentMonthKey, true);
    }
}

// Check for monthly reports once daily at 10:00 AM
setInterval(checkAndSendMonthlyReport, 24 * 60 * 60 * 1000); // 24 hours

// Note: Cleanup timer removed - no time limitations on requests

// Global error handlers - restart on critical errors to prevent zombie processes
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    console.error('Stack trace:', error.stack);
    console.log('🔄 Critical error detected - restarting process...');
    
    // Give time for logs to be written
    setTimeout(() => {
        process.exit(1); // Exit with error code to trigger restart
    }, 1000);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Promise Rejection at:', promise);
    console.error('Reason:', reason);
    console.log('🔄 Critical promise rejection - restarting process...');
    
    // Give time for logs to be written
    setTimeout(() => {
        process.exit(1); // Exit with error code to trigger restart
    }, 1000);
});

// Graceful shutdown handler
process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 Received SIGINT, shutting down gracefully...');
    process.exit(0);
});

// Enhanced maintenance with memory monitoring and alerts
function performMaintenance() {
    // Log memory usage
    const used = process.memoryUsage();
    const rssMB = Math.round(used.rss / 1024 / 1024);
    const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
    
    console.log('📊 Memory Usage:', {
        rss: `${rssMB}MB`,
        heapTotal: `${Math.round(used.heapTotal / 1024 / 1024)}MB`,
        heapUsed: `${heapUsedMB}MB`,
        external: `${Math.round(used.external / 1024 / 1024)}MB`
    });
    
    // Alert if memory usage is getting high (Render free tier limit is ~512MB)
    if (rssMB > 400) {
        console.log(`⚠️ HIGH MEMORY USAGE WARNING: ${rssMB}MB (approaching Render free tier limit)`);
    }
    
    if (rssMB > 450) {
        console.log(`🚨 CRITICAL MEMORY USAGE: ${rssMB}MB (very close to Render free tier limit)`);
    }
    
    // Perform cleanup
    cleanupOldData();
}

// Run maintenance every hour (reduced from multiple separate timers)
setInterval(performMaintenance, 60 * 60 * 1000); // 1 hour

// Additional safeguards for Render free tier
// Memory monitoring without forced GC (GC can cause freezes on free tier)
setInterval(() => {
    const used = process.memoryUsage();
    console.log('📊 Memory usage:', {
        rss: `${Math.round(used.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(used.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(used.heapTotal / 1024 / 1024)}MB`
    });
    
    // Alert if memory usage is high (but don't force GC)
    if (used.rss > 400 * 1024 * 1024) { // 400MB threshold
        console.log('⚠️ High memory usage detected - consider restart');
    }
}, 30 * 60 * 1000); // 30 minutes

// Additional heartbeat to keep main bot active (prevent Render from killing it)
setInterval(() => {
    console.log(`💓 Main bot heartbeat: ${new Date().toISOString()}`);
}, 2 * 60 * 1000); // Every 2 minutes

// Integrated keep-alive mechanism (no separate process needed)
if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    console.log('🔄 Starting integrated keep-alive mechanism...');
    
    const keepAlive = () => {
        const keepAliveUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/health`;
        console.log(`🔄 Sending keep-alive ping to: ${keepAliveUrl}`);
        
        const request = https.get(keepAliveUrl, {
            timeout: 10000,
            headers: {
                'User-Agent': 'DishwasherBot-Integrated-KeepAlive/1.0'
            }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                console.log(`✅ Keep-alive ping successful: ${res.statusCode}`);
            });
        });
        
        request.on('error', (err) => {
            console.log(`❌ Keep-alive ping failed: ${err.message}`);
        });
        
        request.on('timeout', () => {
            console.log(`⏰ Keep-alive ping timed out`);
            request.destroy();
        });
    };
    
    // Initial keep-alive after 30 seconds
    setTimeout(keepAlive, 30 * 1000);
    
    // Then every 3 minutes
    setInterval(keepAlive, 3 * 60 * 1000);
}

// Memory cleanup function
function cleanupOldData() {
    const now = Date.now();
    const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000); // 1 week ago
    
    console.log('🧹 Starting memory cleanup...');
    
    // Clean up old swap requests (older than 1 week)
    let cleanedSwaps = 0;
    if (pendingSwaps && typeof pendingSwaps.entries === 'function') {
    for (const [requestId, request] of pendingSwaps.entries()) {
        if (request.timestamp < oneWeekAgo) {
            pendingSwaps.delete(requestId);
            cleanedSwaps++;
            }
        }
    }
    
    // Clean up old punishment requests (older than 1 week)
    let cleanedPunishments = 0;
    if (pendingPunishments && typeof pendingPunishments.entries === 'function') {
    for (const [requestId, request] of pendingPunishments.entries()) {
        if (request.timestamp < oneWeekAgo) {
            pendingPunishments.delete(requestId);
            cleanedPunishments++;
            }
        }
    }
    
    // Clean up old done timestamps (older than 1 day)
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    let cleanedDoneTimestamps = 0;
    if (global.doneTimestamps && typeof global.doneTimestamps.entries === 'function') {
    for (const [userKey, timestamp] of global.doneTimestamps.entries()) {
        if (timestamp < oneDayAgo) {
            global.doneTimestamps.delete(userKey);
            cleanedDoneTimestamps++;
            }
        }
    }
    
    // Clean up old swap timestamps (older than 1 day)
    let cleanedSwapTimestamps = 0;
    if (global.swapTimestamps && Array.isArray(global.swapTimestamps)) {
        // swapTimestamps is an array, filter out old entries
        const originalLength = global.swapTimestamps.length;
        global.swapTimestamps = global.swapTimestamps.filter(timestamp => timestamp > oneDayAgo);
        cleanedSwapTimestamps = originalLength - global.swapTimestamps.length;
    } else if (global.swapTimestamps && typeof global.swapTimestamps.delete === 'function' && typeof global.swapTimestamps.entries === 'function') {
        // swapTimestamps is a Map, use delete method
    for (const [userKey, timestamp] of global.swapTimestamps.entries()) {
        if (timestamp < oneDayAgo) {
            global.swapTimestamps.delete(userKey);
            cleanedSwapTimestamps++;
            }
        }
    }
    
    // Clean up old user states (older than 1 hour) - remove stale typing states
    const oneHourAgo = now - (60 * 60 * 1000);
    let cleanedStates = 0;
    if (userStates && typeof userStates.entries === 'function') {
        for (const [userId, state] of userStates.entries()) {
            if (state === 'typing_announcement' || state === 'typing_message') {
                userStates.delete(userId);
                cleanedStates++;
            }
        }
    }
    
    // Clean up old user actions (older than 1 hour)
    let cleanedActions = 0;
    if (lastUserAction && typeof lastUserAction.entries === 'function') {
        for (const [userId, action] of lastUserAction.entries()) {
            if (action.timestamp < oneHourAgo) {
                lastUserAction.delete(userId);
                cleanedActions++;
            }
        }
    }
    
    // Clean up old pending announcements (older than 1 hour)
    let cleanedAnnouncements = 0;
    if (pendingAnnouncements && typeof pendingAnnouncements.entries === 'function') {
        for (const [userId, announcement] of pendingAnnouncements.entries()) {
            if (announcement.timestamp < oneHourAgo) {
                pendingAnnouncements.delete(userId);
                cleanedAnnouncements++;
            }
        }
    }
    
        // Clean up global temp swaps (older than 1 hour)
        let cleanedTempSwaps = 0;
        if (global.tempSwaps && typeof global.tempSwaps.entries === 'function') {
            for (const [swapId, swap] of global.tempSwaps.entries()) {
                if (swap.timestamp < oneHourAgo) {
                    global.tempSwaps.delete(swapId);
                    cleanedTempSwaps++;
                }
            }
        }

        // Clean up expired grace periods (older than 24 hours)
        let cleanedGracePeriods = 0;
        if (global.gracePeriods && typeof global.gracePeriods.entries === 'function') {
            for (const [userName, graceData] of global.gracePeriods.entries()) {
                if (graceData.endTime < now) {
                    global.gracePeriods.delete(userName);
                    cleanedGracePeriods++;
                }
            }
        }

        console.log(`🧹 Comprehensive cleanup completed: ${cleanedSwaps} swaps, ${cleanedPunishments} punishments, ${cleanedDoneTimestamps} done timestamps, ${cleanedSwapTimestamps} swap timestamps, ${cleanedStates} states, ${cleanedActions} actions, ${cleanedAnnouncements} announcements, ${cleanedTempSwaps} temp swaps, ${cleanedGracePeriods} expired grace periods`);
}

// Cleanup timer removed - now combined with maintenance timer above

