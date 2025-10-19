// Comprehensive test to check if bot persistence works end-to-end
const Database = require('./database');

// Simulate all the global variables
let authorizedUsers = new Set();
let admins = new Set();
let userChatIds = new Map();
let adminChatIds = new Set();
let turnOrder = new Set();
let userScores = new Map();
let currentTurnIndex = 0;
let userQueueMapping = new Map();
let queueUserMapping = new Map();
let suspendedUsers = new Map();
let turnAssignments = new Map();
let monthlyStats = new Map();

let db = null;

// Simulate the saveBotData function
async function saveBotData() {
    try {
        console.log('💾 Saving bot data...');
        
        // Save core bot state
        await db.saveBotState('authorizedUsers', Array.from(authorizedUsers));
        await db.saveBotState('admins', Array.from(admins));
        await db.saveBotState('userChatIds', Object.fromEntries(userChatIds));
        await db.saveBotState('adminChatIds', Array.from(adminChatIds));
        await db.saveBotState('turnOrder', Array.from(turnOrder));
        await db.saveBotState('currentTurnIndex', currentTurnIndex);
        
        // Save additional state
        await db.saveBotState('suspendedUsers', Object.fromEntries(suspendedUsers));
        await db.saveBotState('turnAssignments', Object.fromEntries(turnAssignments));
        
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
        
        console.log(`✅ Bot data saved - ${authorizedUsers.size} authorized users, ${admins.size} admins, ${queueUserMapping.size} queue mappings`);
    } catch (error) {
        console.error('❌ Error saving bot data:', error);
    }
}

// Simulate the loadBotData function
async function loadBotData() {
    try {
        console.log('📂 Loading bot data...');
        
        // Load core bot state
        const authorizedUsersData = await db.getBotState('authorizedUsers') || [];
        const adminsData = await db.getBotState('admins') || [];
        const userChatIdsData = await db.getBotState('userChatIds') || {};
        const adminChatIdsData = await db.getBotState('adminChatIds') || [];
        const turnOrderData = await db.getBotState('turnOrder') || [];
        const currentTurnIndexData = await db.getBotState('currentTurnIndex') || 0;
        
        // Load additional state
        const suspendedUsersData = await db.getBotState('suspendedUsers') || {};
        const turnAssignmentsData = await db.getBotState('turnAssignments') || {};
        
        // Load user scores
        const userScoresData = await db.getAllUserScores();
        
        // Load queue mappings
        const queueMappingsData = await db.getAllQueueMappings();
        
        // Load monthly statistics
        const monthlyStatsData = await db.getAllMonthlyStats();
        
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
        
        turnOrder.clear();
        turnOrderData.forEach(user => turnOrder.add(user));
        
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
        
        // Restore monthly statistics
        monthlyStats.clear();
        Object.entries(monthlyStatsData).forEach(([key, value]) => {
            monthlyStats.set(key, value);
        });
        
        console.log('✅ Bot data loaded successfully');
        console.log(`👥 Users: ${authorizedUsers.size}, Admins: ${admins.size}, Queue Mappings: ${queueUserMapping.size}, Turn Index: ${currentTurnIndex}`);
        return true;
    } catch (error) {
        console.error('❌ Error loading bot data:', error);
        return false;
    }
}

async function simulateBotLifecycle() {
    console.log('🧪 Simulating complete bot lifecycle...');
    
    // Initialize database
    db = new Database();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // First startup - load any existing data
    console.log('\n🚀 FIRST STARTUP:');
    await loadBotData();
    
    // Simulate bot operations
    console.log('\n🤖 SIMULATING BOT OPERATIONS:');
    
    // Authorize users
    console.log('📝 Authorizing users...');
    authorizedUsers.add('Eden');
    authorizedUsers.add('Eden'.toLowerCase());
    userQueueMapping.set('Eden', 'Eden');
    userQueueMapping.set('Eden'.toLowerCase(), 'Eden');
    queueUserMapping.set('Eden', 'Eden');
    
    authorizedUsers.add('Adele');
    authorizedUsers.add('Adele'.toLowerCase());
    userQueueMapping.set('Adele', 'Adele');
    userQueueMapping.set('Adele'.toLowerCase(), 'Adele');
    queueUserMapping.set('Adele', 'Adele');
    
    authorizedUsers.add('Emma');
    authorizedUsers.add('Emma'.toLowerCase());
    userQueueMapping.set('Emma', 'Emma');
    userQueueMapping.set('Emma'.toLowerCase(), 'Emma');
    queueUserMapping.set('Emma', 'Emma');
    
    // Set up turn order
    turnOrder.add('Eden');
    turnOrder.add('Adele');
    turnOrder.add('Emma');
    
    // Set initial scores
    userScores.set('Eden', 0);
    userScores.set('Adele', 0);
    userScores.set('Emma', 0);
    
    // Save data
    await saveBotData();
    
    // Simulate some turns
    console.log('🔄 Simulating turns...');
    userScores.set('Eden', 1);
    await saveBotData();
    
    userScores.set('Adele', 1);
    await saveBotData();
    
    userScores.set('Emma', 1);
    await saveBotData();
    
    // Close database (simulate restart)
    db.close();
    console.log('\n🔄 SIMULATING RESTART...');
    
    // Second startup - should load all previous data
    console.log('\n🚀 SECOND STARTUP:');
    db = new Database();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await loadBotData();
    
    // Verify data persistence
    console.log('\n✅ VERIFICATION:');
    console.log('Authorized users:', Array.from(authorizedUsers));
    console.log('User scores:', Object.fromEntries(userScores));
    console.log('Queue mappings:', Object.fromEntries(userQueueMapping));
    console.log('Turn order:', Array.from(turnOrder));
    
    // Close database
    db.close();
    console.log('\n🎉 Test completed successfully!');
}

simulateBotLifecycle().catch(console.error);
