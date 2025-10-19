// Test script to verify complete user removal functionality
const Database = require('./database');

// Simulate global variables
let userScores = new Map();
let turnOrder = new Set();
let currentTurnIndex = 0;
let userQueueMapping = new Map();
let queueUserMapping = new Map();
let authorizedUsers = new Set();
let admins = new Set();
let suspendedUsers = new Map();
let turnAssignments = new Map();
let monthlyStats = new Map();
let db = null;

// Global variables for tracking
global.swapTimestamps = [];
global.doneTimestamps = new Map();
global.lastDishwasherDone = null;

async function testUserRemoval() {
    console.log('🧪 Testing complete user removal functionality...');
    
    // Initialize database
    db = new Database();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Load existing data
    console.log('📂 Loading existing data...');
    await loadBotData();
    
    // Test 1: Initialize users with complete data
    console.log('\n🎯 Test 1: Initialize users with complete data');
    authorizedUsers.add('Eden');
    authorizedUsers.add('Adele');
    authorizedUsers.add('Emma');
    
    userScores.set('Eden', 2);
    userScores.set('Adele', 1);
    userScores.set('Emma', 3);
    
    turnOrder.add('Eden');
    turnOrder.add('Adele');
    turnOrder.add('Emma');
    currentTurnIndex = 1; // Adele's turn
    
    userQueueMapping.set('Eden', 'Eden');
    userQueueMapping.set('Adele', 'Adele');
    userQueueMapping.set('Emma', 'Emma');
    
    queueUserMapping.set('Eden', 'Eden');
    queueUserMapping.set('Adele', 'Adele');
    queueUserMapping.set('Emma', 'Emma');
    
    // Add some suspended user data
    suspendedUsers.set('Emma', {
        suspendedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
        reason: 'test suspension',
        originalPosition: 2
    });
    
    // Add turn assignments
    turnAssignments.set('Eden', 'Adele'); // Eden assigned to Adele's turn
    
    // Add monthly stats
    monthlyStats.set('2024-10', { totalTurns: 15, averageScore: 1.2 });
    
    await saveBotData();
    console.log('✅ Complete user data initialized');
    
    console.log('\n📊 BEFORE REMOVAL:');
    console.log('Authorized users:', Array.from(authorizedUsers));
    console.log('User scores:', Object.fromEntries(userScores));
    console.log('Turn order:', Array.from(turnOrder));
    console.log('Current turn index:', currentTurnIndex);
    console.log('Queue mappings:', Object.fromEntries(userQueueMapping));
    console.log('Suspended users:', Object.fromEntries(suspendedUsers));
    console.log('Turn assignments:', Object.fromEntries(turnAssignments));
    console.log('Monthly stats:', Object.fromEntries(monthlyStats));
    
    // Test 2: Remove Adele (user in the middle)
    console.log('\n🗑️ Test 2: Remove Adele (user in the middle)');
    const userToRemove = 'Adele';
    
    // Find the actual user name (case-insensitive)
    let actualUserName = null;
    for (const authorizedUser of authorizedUsers) {
        if (authorizedUser.toLowerCase() === userToRemove.toLowerCase()) {
            actualUserName = authorizedUser;
            break;
        }
    }
    
    if (actualUserName) {
        console.log(`Removing user: ${actualUserName}`);
        
        // Remove user from ALL data structures
        authorizedUsers.delete(actualUserName);
        turnOrder.delete(actualUserName);
        userScores.delete(actualUserName);
        
        // Remove from queue mappings
        userQueueMapping.delete(actualUserName);
        queueUserMapping.delete(actualUserName);
        
        // Remove from suspended users
        suspendedUsers.delete(actualUserName);
        
        // Remove from turn assignments
        turnAssignments.delete(actualUserName);
        
        // Adjust current turn index if needed
        if (currentTurnIndex >= turnOrder.size) {
            currentTurnIndex = 0;
        }
        
        await saveBotData();
        console.log('✅ User removed from all data structures');
    }
    
    console.log('\n📊 AFTER REMOVAL:');
    console.log('Authorized users:', Array.from(authorizedUsers));
    console.log('User scores:', Object.fromEntries(userScores));
    console.log('Turn order:', Array.from(turnOrder));
    console.log('Current turn index:', currentTurnIndex);
    console.log('Queue mappings:', Object.fromEntries(userQueueMapping));
    console.log('Suspended users:', Object.fromEntries(suspendedUsers));
    console.log('Turn assignments:', Object.fromEntries(turnAssignments));
    console.log('Monthly stats:', Object.fromEntries(monthlyStats));
    
    // Test 3: Verify data persistence after restart
    console.log('\n🔄 Test 3: Verify data persistence after restart');
    db.close();
    
    // Reopen database and load data
    db = new Database();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await loadBotData();
    
    console.log('\n📊 AFTER RESTART:');
    console.log('Authorized users:', Array.from(authorizedUsers));
    console.log('User scores:', Object.fromEntries(userScores));
    console.log('Turn order:', Array.from(turnOrder));
    console.log('Current turn index:', currentTurnIndex);
    console.log('Queue mappings:', Object.fromEntries(userQueueMapping));
    console.log('Suspended users:', Object.fromEntries(suspendedUsers));
    console.log('Turn assignments:', Object.fromEntries(turnAssignments));
    console.log('Monthly stats:', Object.fromEntries(monthlyStats));
    
    // Verify removal was complete
    console.log('\n✅ VERIFICATION:');
    const userRemovedFromAuthorized = !authorizedUsers.has('Adele');
    const userRemovedFromScores = !userScores.has('Adele');
    const userRemovedFromTurnOrder = !turnOrder.has('Adele');
    const userRemovedFromQueueMappings = !userQueueMapping.has('Adele') && !queueUserMapping.has('Adele');
    const userRemovedFromSuspended = !suspendedUsers.has('Adele');
    const userRemovedFromAssignments = !turnAssignments.has('Adele');
    const turnIndexAdjusted = currentTurnIndex === 0; // Should reset to 0 since Adele was at index 1
    const remainingUsersCorrect = authorizedUsers.size === 2 && authorizedUsers.has('Eden') && authorizedUsers.has('Emma');
    
    console.log('User removed from authorized users:', userRemovedFromAuthorized ? '✅' : '❌');
    console.log('User removed from scores:', userRemovedFromScores ? '✅' : '❌');
    console.log('User removed from turn order:', userRemovedFromTurnOrder ? '✅' : '❌');
    console.log('User removed from queue mappings:', userRemovedFromQueueMappings ? '✅' : '❌');
    console.log('User removed from suspended users:', userRemovedFromSuspended ? '✅' : '❌');
    console.log('User removed from turn assignments:', userRemovedFromAssignments ? '✅' : '❌');
    console.log('Turn index adjusted:', turnIndexAdjusted ? '✅' : '❌');
    console.log('Remaining users correct:', remainingUsersCorrect ? '✅' : '❌');
    
    // Close database
    db.close();
    console.log('\n🎉 Test completed!');
}

async function saveBotData() {
    try {
        // Save user scores
        for (const [userName, score] of userScores.entries()) {
            await db.setUserScore(userName, score);
        }
        
        // Save bot state
        await db.saveBotState('authorizedUsers', Array.from(authorizedUsers));
        await db.saveBotState('admins', Array.from(admins));
        await db.saveBotState('turnOrder', Array.from(turnOrder));
        await db.saveBotState('currentTurnIndex', currentTurnIndex);
        await db.saveBotState('userQueueMapping', Object.fromEntries(userQueueMapping));
        await db.saveBotState('queueUserMapping', Object.fromEntries(queueUserMapping));
        await db.saveBotState('suspendedUsers', Object.fromEntries(suspendedUsers));
        await db.saveBotState('turnAssignments', Object.fromEntries(turnAssignments));
        await db.saveBotState('monthlyStats', Object.fromEntries(monthlyStats));
        await db.saveBotState('swapTimestamps', global.swapTimestamps);
        await db.saveBotState('doneTimestamps', Object.fromEntries(global.doneTimestamps));
        await db.saveBotState('lastDishwasherDone', global.lastDishwasherDone);
        
        console.log('💾 Bot data saved');
    } catch (error) {
        console.error('❌ Error saving bot data:', error);
    }
}

async function loadBotData() {
    try {
        // Load user scores
        const userScoresData = await db.getAllUserScores();
        userScores.clear();
        Object.entries(userScoresData).forEach(([key, value]) => {
            userScores.set(key, value);
        });
        
        // Load bot state
        const authorizedUsersData = await db.getBotState('authorizedUsers') || [];
        const adminsData = await db.getBotState('admins') || [];
        const turnOrderData = await db.getBotState('turnOrder') || [];
        const currentTurnIndexData = await db.getBotState('currentTurnIndex') || 0;
        const userQueueMappingData = await db.getBotState('userQueueMapping') || {};
        const queueUserMappingData = await db.getBotState('queueUserMapping') || {};
        const suspendedUsersData = await db.getBotState('suspendedUsers') || {};
        const turnAssignmentsData = await db.getBotState('turnAssignments') || {};
        const monthlyStatsData = await db.getBotState('monthlyStats') || {};
        const swapTimestampsData = await db.getBotState('swapTimestamps') || [];
        const doneTimestampsData = await db.getBotState('doneTimestamps') || {};
        const lastDishwasherDoneData = await db.getBotState('lastDishwasherDone') || null;
        
        // Restore global variables
        authorizedUsers.clear();
        authorizedUsersData.forEach(user => authorizedUsers.add(user));
        
        admins.clear();
        adminsData.forEach(admin => admins.add(admin));
        
        turnOrder.clear();
        turnOrderData.forEach(user => turnOrder.add(user));
        
        currentTurnIndex = currentTurnIndexData;
        
        userQueueMapping.clear();
        Object.entries(userQueueMappingData).forEach(([key, value]) => {
            userQueueMapping.set(key, value);
        });
        
        queueUserMapping.clear();
        Object.entries(queueUserMappingData).forEach(([key, value]) => {
            queueUserMapping.set(key, value);
        });
        
        suspendedUsers.clear();
        Object.entries(suspendedUsersData).forEach(([key, value]) => {
            suspendedUsers.set(key, value);
        });
        
        turnAssignments.clear();
        Object.entries(turnAssignmentsData).forEach(([key, value]) => {
            turnAssignments.set(key, value);
        });
        
        monthlyStats.clear();
        Object.entries(monthlyStatsData).forEach(([key, value]) => {
            monthlyStats.set(key, value);
        });
        
        global.swapTimestamps = swapTimestampsData;
        global.doneTimestamps = new Map(Object.entries(doneTimestampsData));
        global.lastDishwasherDone = lastDishwasherDoneData;
        
        console.log('📂 Bot data loaded successfully');
    } catch (error) {
        console.error('❌ Error loading bot data:', error);
    }
}

testUserRemoval().catch(console.error);
