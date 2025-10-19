// Test script to verify queue management and hard reset features with SQLite database
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

async function testQueueAndResetFeatures() {
    console.log('🧪 Testing queue management and hard reset features...');
    
    // Initialize database
    db = new Database();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Load existing data
    console.log('📂 Loading existing data...');
    await loadBotData();
    
    console.log('📊 Initial state:');
    console.log('Authorized users:', Array.from(authorizedUsers));
    console.log('Admins:', Array.from(admins));
    console.log('User scores:', Object.fromEntries(userScores));
    console.log('Turn order:', Array.from(turnOrder));
    console.log('Current turn index:', currentTurnIndex);
    console.log('Queue mappings:', Object.fromEntries(userQueueMapping));
    console.log('Suspended users:', Object.fromEntries(suspendedUsers));
    console.log('Turn assignments:', Object.fromEntries(turnAssignments));
    console.log('Monthly stats:', Object.fromEntries(monthlyStats));
    
    // Test 1: Initialize queue management
    console.log('\n🎯 Test 1: Initialize queue management');
    authorizedUsers.add('Eden');
    authorizedUsers.add('Adele');
    authorizedUsers.add('Emma');
    
    userScores.set('Eden', 0);
    userScores.set('Adele', 1);
    userScores.set('Emma', 2);
    
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
    
    // Add some monthly stats
    monthlyStats.set('2024-10', { totalTurns: 15, averageScore: 1.2 });
    monthlyStats.set('2024-11', { totalTurns: 18, averageScore: 1.5 });
    
    await saveBotData();
    console.log('✅ Queue management initialized and saved');
    
    // Test 2: Test turn progression
    console.log('\n🔄 Test 2: Test turn progression');
    currentTurnIndex = (currentTurnIndex + 1) % turnOrder.size;
    await saveBotData();
    console.log('✅ Turn progressed to index:', currentTurnIndex);
    
    // Test 3: Test queue modifications
    console.log('\n📋 Test 3: Test queue modifications');
    // Add a turn assignment
    turnAssignments.set('Emma', 'Eden'); // Emma assigned to Eden's turn
    
    // Add suspension
    suspendedUsers.set('Adele', {
        suspendedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
        reason: 'test suspension',
        originalPosition: 1
    });
    
    await saveBotData();
    console.log('✅ Queue modifications saved');
    
    // Test 4: Test hard reset functionality
    console.log('\n⚠️ Test 4: Test hard reset functionality');
    console.log('Before reset:');
    console.log('- Authorized users:', Array.from(authorizedUsers).length);
    console.log('- User scores:', Object.fromEntries(userScores));
    console.log('- Turn order:', Array.from(turnOrder).length);
    console.log('- Monthly stats:', Object.fromEntries(monthlyStats).length);
    
    // Simulate hard reset
    authorizedUsers.clear();
    userScores.clear();
    turnOrder.clear();
    currentTurnIndex = 0;
    userQueueMapping.clear();
    queueUserMapping.clear();
    suspendedUsers.clear();
    turnAssignments.clear();
    monthlyStats.clear();
    global.swapTimestamps = [];
    global.doneTimestamps.clear();
    global.lastDishwasherDone = null;
    
    await saveBotData();
    console.log('✅ Hard reset completed');
    
    console.log('After reset:');
    console.log('- Authorized users:', Array.from(authorizedUsers).length);
    console.log('- User scores:', Object.fromEntries(userScores));
    console.log('- Turn order:', Array.from(turnOrder).length);
    console.log('- Monthly stats:', Object.fromEntries(monthlyStats).length);
    
    // Test 5: Test queue reconstruction
    console.log('\n🔧 Test 5: Test queue reconstruction');
    authorizedUsers.add('Eden');
    authorizedUsers.add('Adele');
    authorizedUsers.add('Emma');
    
    userScores.set('Eden', 0);
    userScores.set('Adele', 0);
    userScores.set('Emma', 0);
    
    turnOrder.add('Eden');
    turnOrder.add('Adele');
    turnOrder.add('Emma');
    currentTurnIndex = 0;
    
    userQueueMapping.set('Eden', 'Eden');
    userQueueMapping.set('Adele', 'Adele');
    userQueueMapping.set('Emma', 'Emma');
    
    queueUserMapping.set('Eden', 'Eden');
    queueUserMapping.set('Adele', 'Adele');
    queueUserMapping.set('Emma', 'Emma');
    
    await saveBotData();
    console.log('✅ Queue reconstructed');
    
    // Close database (simulate restart)
    db.close();
    console.log('\n🔄 Simulating restart...');
    
    // Reopen database and load data
    db = new Database();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Load all data again
    console.log('\n📂 Loading data after restart...');
    await loadBotData();
    
    console.log('📊 Data after restart:');
    console.log('Authorized users:', Array.from(authorizedUsers));
    console.log('Admins:', Array.from(admins));
    console.log('User scores:', Object.fromEntries(userScores));
    console.log('Turn order:', Array.from(turnOrder));
    console.log('Current turn index:', currentTurnIndex);
    console.log('Queue mappings:', Object.fromEntries(userQueueMapping));
    console.log('Suspended users:', Object.fromEntries(suspendedUsers));
    console.log('Turn assignments:', Object.fromEntries(turnAssignments));
    console.log('Monthly stats:', Object.fromEntries(monthlyStats));
    
    // Verify data persistence
    console.log('\n✅ VERIFICATION:');
    const authorizedMatch = authorizedUsers.size === 3 && authorizedUsers.has('Eden') && authorizedUsers.has('Adele') && authorizedUsers.has('Emma');
    const scoresMatch = userScores.size === 3 && userScores.get('Eden') === 0 && userScores.get('Adele') === 0 && userScores.get('Emma') === 0;
    const turnOrderMatch = turnOrder.size === 3 && turnOrder.has('Eden') && turnOrder.has('Adele') && turnOrder.has('Emma');
    const indexMatch = currentTurnIndex === 0;
    const queueMappingMatch = userQueueMapping.size === 3 && queueUserMapping.size === 3;
    const cleanStateMatch = suspendedUsers.size === 0 && turnAssignments.size === 0 && monthlyStats.size === 0;
    
    console.log('Authorized users persisted:', authorizedMatch ? '✅' : '❌');
    console.log('User scores persisted:', scoresMatch ? '✅' : '❌');
    console.log('Turn order persisted:', turnOrderMatch ? '✅' : '❌');
    console.log('Turn index persisted:', indexMatch ? '✅' : '❌');
    console.log('Queue mappings persisted:', queueMappingMatch ? '✅' : '❌');
    console.log('Clean state after reset:', cleanStateMatch ? '✅' : '❌');
    
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

testQueueAndResetFeatures().catch(console.error);
