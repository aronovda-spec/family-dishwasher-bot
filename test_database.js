// Test script to check database persistence
const Database = require('./database');

async function testDatabase() {
    console.log('🧪 Testing database persistence...');
    
    const db = new Database();
    
    // Wait a bit for database to initialize
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Test saving some data
    console.log('💾 Saving test data...');
    await db.saveBotState('test_authorizedUsers', ['user1', 'user2', 'user3']);
    await db.setUserScore('Eden', 5);
    await db.setUserScore('Adele', 3);
    await db.setUserScore('Emma', 1);
    
    // Test loading data
    console.log('📂 Loading test data...');
    const authorizedUsers = await db.getBotState('test_authorizedUsers');
    const edenScore = await db.getUserScore('Eden');
    const adeleScore = await db.getUserScore('Adele');
    const emmaScore = await db.getUserScore('Emma');
    
    console.log('📊 Results:');
    console.log('Authorized users:', authorizedUsers);
    console.log('Eden score:', edenScore);
    console.log('Adele score:', adeleScore);
    console.log('Emma score:', emmaScore);
    
    // Close database
    db.close();
    console.log('✅ Test completed');
}

testDatabase().catch(console.error);
