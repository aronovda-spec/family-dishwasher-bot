// Test script to verify initial score initialization
const Database = require('./database');

// Simulate global variables
let userScores = new Map();
let db = null;

async function testInitialScores() {
    console.log('🧪 Testing initial score initialization...');
    
    // Initialize database
    db = new Database();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Load existing scores
    console.log('📂 Loading existing scores...');
    const userScoresData = await db.getAllUserScores();
    
    userScores.clear();
    Object.entries(userScoresData).forEach(([key, value]) => {
        userScores.set(key, value);
    });
    
    console.log('📊 Existing scores:', Object.fromEntries(userScores));
    
    // Initialize default scores for all users if not already set
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
        console.log(`🎯 Initialized ${initializedScores} default user scores (0 points each)`);
    } else {
        console.log('✅ All users already have scores');
    }
    
    // Show final scores
    console.log('📊 Final scores:', Object.fromEntries(userScores));
    
    // Close database
    db.close();
    console.log('✅ Test completed');
}

testInitialScores().catch(console.error);
