// Test script to simulate bot restart and data persistence
const Database = require('./database');

// Simulate global variables
let authorizedUsers = new Set();
let userScores = new Map();
let db = null;

async function simulateBotStart() {
    console.log('🚀 Simulating bot startup...');
    
    // Initialize database
    db = new Database();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Load data
    console.log('📂 Loading data...');
    const authorizedUsersData = await db.getBotState('authorizedUsers') || [];
    const userScoresData = await db.getAllUserScores();
    
    // Restore global variables
    authorizedUsers.clear();
    authorizedUsersData.forEach(user => authorizedUsers.add(user));
    
    userScores.clear();
    Object.entries(userScoresData).forEach(([key, value]) => {
        userScores.set(key, value);
    });
    
    console.log('📊 Loaded data:');
    console.log('Authorized users:', Array.from(authorizedUsers));
    console.log('User scores:', Object.fromEntries(userScores));
    
    return { authorizedUsers, userScores };
}

async function simulateBotOperation() {
    console.log('🤖 Simulating bot operations...');
    
    // Add some users
    authorizedUsers.add('Eden');
    authorizedUsers.add('Adele');
    userScores.set('Eden', 5);
    userScores.set('Adele', 3);
    
    // Save data
    console.log('💾 Saving data...');
    await db.saveBotState('authorizedUsers', Array.from(authorizedUsers));
    for (const [userName, score] of userScores.entries()) {
        await db.setUserScore(userName, score);
    }
    
    console.log('📊 Saved data:');
    console.log('Authorized users:', Array.from(authorizedUsers));
    console.log('User scores:', Object.fromEntries(userScores));
}

async function testPersistence() {
    console.log('🧪 Testing bot persistence...');
    
    // First startup
    await simulateBotStart();
    
    // Simulate operations
    await simulateBotOperation();
    
    // Close database (simulate restart)
    db.close();
    console.log('🔄 Simulating restart...');
    
    // Second startup (should load previous data)
    await simulateBotStart();
    
    console.log('✅ Test completed');
}

testPersistence().catch(console.error);
