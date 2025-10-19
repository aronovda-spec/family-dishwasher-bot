// Test script to verify database user removal directly
const Database = require('./database');

async function testDatabaseUserRemoval() {
    console.log('🧪 Testing database user removal directly...');
    
    // Initialize database
    const db = new Database();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Test 1: Add some users to the database
    console.log('\n🎯 Test 1: Add users to database');
    await db.setUserScore('Eden', 2);
    await db.setUserScore('Adele', 1);
    await db.setUserScore('Emma', 3);
    
    // Verify users were added
    const allScores = await db.getAllUserScores();
    console.log('Users in database:', allScores);
    
    // Test 2: Remove Adele
    console.log('\n🗑️ Test 2: Remove Adele from database');
    const result = await db.removeUser('Adele');
    console.log('Removal result:', result);
    
    // Test 3: Verify Adele was removed
    console.log('\n✅ Test 3: Verify Adele was removed');
    const scoresAfterRemoval = await db.getAllUserScores();
    console.log('Users after removal:', scoresAfterRemoval);
    
    // Test 4: Try to remove non-existent user
    console.log('\n🔍 Test 4: Try to remove non-existent user');
    const result2 = await db.removeUser('NonExistent');
    console.log('Removal result for non-existent user:', result2);
    
    // Close database
    db.close();
    console.log('\n🎉 Test completed!');
}

testDatabaseUserRemoval().catch(console.error);
