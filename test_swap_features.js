// Test script to verify swap, force swap, and punishment features with SQLite database
const Database = require('./database');

// Simulate global variables
let userScores = new Map();
let turnOrder = new Set();
let suspendedUsers = new Map();
let turnAssignments = new Map();
let db = null;

// Global variables for tracking
global.swapTimestamps = [];
global.doneTimestamps = new Map();

async function testSwapFeatures() {
    console.log('🧪 Testing swap, force swap, and punishment features...');
    
    // Initialize database
    db = new Database();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Load existing data
    console.log('📂 Loading existing data...');
    const userScoresData = await db.getAllUserScores();
    const turnOrderData = await db.getBotState('turnOrder') || [];
    const suspendedUsersData = await db.getBotState('suspendedUsers') || {};
    const turnAssignmentsData = await db.getBotState('turnAssignments') || {};
    const swapTimestampsData = await db.getBotState('swapTimestamps') || [];
    const doneTimestampsData = await db.getBotState('doneTimestamps') || {};
    
    // Restore global variables
    userScores.clear();
    Object.entries(userScoresData).forEach(([key, value]) => {
        userScores.set(key, value);
    });
    
    turnOrder.clear();
    turnOrderData.forEach(user => turnOrder.add(user));
    
    suspendedUsers.clear();
    Object.entries(suspendedUsersData).forEach(([key, value]) => {
        suspendedUsers.set(key, value);
    });
    
    turnAssignments.clear();
    Object.entries(turnAssignmentsData).forEach(([key, value]) => {
        turnAssignments.set(key, value);
    });
    
    global.swapTimestamps = swapTimestampsData;
    global.doneTimestamps = new Map(Object.entries(doneTimestampsData));
    
    console.log('📊 Initial state:');
    console.log('User scores:', Object.fromEntries(userScores));
    console.log('Turn order:', Array.from(turnOrder));
    console.log('Suspended users:', Object.fromEntries(suspendedUsers));
    console.log('Turn assignments:', Object.fromEntries(turnAssignments));
    console.log('Swap timestamps:', global.swapTimestamps);
    console.log('Done timestamps:', Object.fromEntries(global.doneTimestamps));
    
    // Test 1: Initialize users with scores
    console.log('\n🎯 Test 1: Initialize users with scores');
    userScores.set('Eden', 0);
    userScores.set('Adele', 1);
    userScores.set('Emma', 2);
    
    turnOrder.add('Eden');
    turnOrder.add('Adele');
    turnOrder.add('Emma');
    
    // Save data
    await saveBotData();
    console.log('✅ Users initialized and saved');
    
    // Test 2: Test swap functionality
    console.log('\n🔄 Test 2: Test swap functionality');
    const swapData = {
        fromUser: 'Eden',
        toUser: 'Adele',
        timestamp: Date.now(),
        reason: 'test swap'
    };
    global.swapTimestamps.push(swapData);
    
    // Save swap data
    await saveBotData();
    console.log('✅ Swap data saved');
    
    // Test 3: Test punishment functionality
    console.log('\n⚠️ Test 3: Test punishment functionality');
    const punishmentData = {
        suspendedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
        reason: 'test punishment',
        originalPosition: 1
    };
    suspendedUsers.set('Emma', punishmentData);
    
    // Save punishment data
    await saveBotData();
    console.log('✅ Punishment data saved');
    
    // Test 4: Test turn assignment
    console.log('\n📋 Test 4: Test turn assignment');
    turnAssignments.set('Eden', 'Adele'); // Eden assigned Adele's turn
    
    // Save assignment data
    await saveBotData();
    console.log('✅ Turn assignment saved');
    
    // Test 5: Test done timestamps
    console.log('\n✅ Test 5: Test done timestamps');
    global.doneTimestamps.set('Eden', Date.now());
    global.doneTimestamps.set('Adele', Date.now() - 1000);
    
    // Save done timestamps
    await saveBotData();
    console.log('✅ Done timestamps saved');
    
    // Close database (simulate restart)
    db.close();
    console.log('\n🔄 Simulating restart...');
    
    // Reopen database and load data
    db = new Database();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Load all data again
    console.log('\n📂 Loading data after restart...');
    const userScoresData2 = await db.getAllUserScores();
    const turnOrderData2 = await db.getBotState('turnOrder') || [];
    const suspendedUsersData2 = await db.getBotState('suspendedUsers') || {};
    const turnAssignmentsData2 = await db.getBotState('turnAssignments') || {};
    const swapTimestampsData2 = await db.getBotState('swapTimestamps') || [];
    const doneTimestampsData2 = await db.getBotState('doneTimestamps') || {};
    
    console.log('📊 Data after restart:');
    console.log('User scores:', userScoresData2);
    console.log('Turn order:', turnOrderData2);
    console.log('Suspended users:', suspendedUsersData2);
    console.log('Turn assignments:', turnAssignmentsData2);
    console.log('Swap timestamps:', swapTimestampsData2);
    console.log('Done timestamps:', doneTimestampsData2);
    
    // Verify data persistence
    console.log('\n✅ VERIFICATION:');
    const scoresMatch = userScoresData2.Eden === 0 && userScoresData2.Adele === 1 && userScoresData2.Emma === 2;
    const turnOrderMatch = turnOrderData2.length === 3;
    const suspendedMatch = suspendedUsersData2.Emma && suspendedUsersData2.Emma.reason === 'test punishment';
    const assignmentsMatch = turnAssignmentsData2.Eden === 'Adele';
    const swapsMatch = swapTimestampsData2.length === 1 && swapTimestampsData2[0].reason === 'test swap';
    const doneMatch = Object.keys(doneTimestampsData2).length === 2;
    
    console.log('Scores persisted:', scoresMatch ? '✅' : '❌');
    console.log('Turn order persisted:', turnOrderMatch ? '✅' : '❌');
    console.log('Suspended users persisted:', suspendedMatch ? '✅' : '❌');
    console.log('Turn assignments persisted:', assignmentsMatch ? '✅' : '❌');
    console.log('Swap timestamps persisted:', swapsMatch ? '✅' : '❌');
    console.log('Done timestamps persisted:', doneMatch ? '✅' : '❌');
    
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
        await db.saveBotState('turnOrder', Array.from(turnOrder));
        await db.saveBotState('suspendedUsers', Object.fromEntries(suspendedUsers));
        await db.saveBotState('turnAssignments', Object.fromEntries(turnAssignments));
        await db.saveBotState('swapTimestamps', global.swapTimestamps);
        await db.saveBotState('doneTimestamps', Object.fromEntries(global.doneTimestamps));
        
        console.log('💾 Bot data saved');
    } catch (error) {
        console.error('❌ Error saving bot data:', error);
    }
}

testSwapFeatures().catch(console.error);
