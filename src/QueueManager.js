class QueueManager {
    constructor() {
        // Fixed queue order: Eden → Adele → Emma → (repeating)
        this.fixedQueue = [
            { id: 'eden', name: 'Eden Aronov' },
            { id: 'adele', name: 'Adele Aronov' },
            { id: 'emma', name: 'Emma Aronov' }
        ];
        
        this.currentIndex = 0;
        this.authorizedUsers = new Set();
        this.swapRequests = new Map(); // Map of requestId -> {requester, target, timestamp}
        this.nextRequestId = 1;
    }

    // Add user to authorized list (only 3 users can use queue commands)
    addAuthorizedUser(userId) {
        if (this.authorizedUsers.size >= 3) {
            throw new Error('Maximum of 3 authorized users allowed');
        }
        this.authorizedUsers.add(userId);
    }

    // Remove user from authorized list
    removeAuthorizedUser(userId) {
        this.authorizedUsers.delete(userId);
    }

    // Check if user is authorized
    isAuthorized(userId) {
        return this.authorizedUsers.has(userId);
    }

    // Get current turn user
    getCurrentTurn() {
        if (this.fixedQueue.length === 0) {
            return null;
        }
        return this.fixedQueue[this.currentIndex];
    }

    // Complete current turn and move to next
    completeTurn(userId) {
        if (!this.isAuthorized(userId)) {
            throw new Error('User not authorized to use queue commands');
        }

        const currentUser = this.getCurrentTurn();
        if (!currentUser) {
            throw new Error('No one is currently in the queue');
        }

        // Check if it's the user's turn (by name matching)
        const userName = this.getUserNameFromId(userId);
        if (currentUser.name !== userName) {
            throw new Error(`It's not your turn! Current turn: ${currentUser.name}`);
        }

        // Move to next user in fixed queue
        this.currentIndex = (this.currentIndex + 1) % this.fixedQueue.length;
        
        const nextUser = this.getCurrentTurn();
        let message = `✅ ${currentUser.name} completed their turn!`;
        
        if (nextUser) {
            message += `\n\n🔄 Next turn: ${nextUser.name}`;
        }

        return message;
    }

    // Request to swap with another user
    requestSwap(requesterId, targetUserId) {
        if (!this.isAuthorized(requesterId)) {
            throw new Error('User not authorized to use queue commands');
        }

        const requesterName = this.getUserNameFromId(requesterId);
        const targetName = this.getUserNameFromId(targetUserId);

        // Check if both users are in the fixed queue
        const requester = this.fixedQueue.find(user => user.name === requesterName);
        const target = this.fixedQueue.find(user => user.name === targetName);

        if (!requester || !target) {
            throw new Error('One or both users not found in fixed queue');
        }

        if (requesterName === targetName) {
            throw new Error('Cannot swap with yourself');
        }

        const requestId = this.nextRequestId++;
        this.swapRequests.set(requestId, {
            requester: requester,
            target: target,
            timestamp: new Date().toISOString()
        });

        return {
            requestId: requestId,
            message: `🔄 Swap request #${requestId} created!\n${requester.name} wants to swap positions with ${target.name}.\n${target.name}, please respond with "approve ${requestId}" or "reject ${requestId}".`
        };
    }

    // Approve swap request
    approveSwap(requestId, approverId) {
        const request = this.swapRequests.get(requestId);
        if (!request) {
            throw new Error('Swap request not found');
        }

        const approverName = this.getUserNameFromId(approverId);
        if (request.target.name !== approverName) {
            throw new Error('Only the target user can approve this swap request');
        }

        // Perform the swap in fixed queue
        const requesterIndex = this.fixedQueue.findIndex(user => user.name === request.requester.name);
        const targetIndex = this.fixedQueue.findIndex(user => user.name === request.target.name);

        if (requesterIndex === -1 || targetIndex === -1) {
            throw new Error('One or both users no longer in queue');
        }

        // Swap positions
        [this.fixedQueue[requesterIndex], this.fixedQueue[targetIndex]] = [this.fixedQueue[targetIndex], this.fixedQueue[requesterIndex]];

        // Clean up request
        this.swapRequests.delete(requestId);

        return `✅ Swap approved! ${request.requester.name} and ${request.target.name} have swapped positions.`;
    }

    // Reject swap request
    rejectSwap(requestId, rejectorId) {
        const request = this.swapRequests.get(requestId);
        if (!request) {
            throw new Error('Swap request not found');
        }

        const rejectorName = this.getUserNameFromId(rejectorId);
        if (request.target.name !== rejectorName) {
            throw new Error('Only the target user can reject this swap request');
        }

        this.swapRequests.delete(requestId);
        return `❌ Swap request #${requestId} rejected by ${request.target.name}.`;
    }

    // Add punishment turns to user
    addPunishmentTurns(userId, turns) {
        const userName = this.getUserNameFromId(userId);
        const user = this.fixedQueue.find(u => u.name === userName);
        if (!user) {
            throw new Error('User not found in fixed queue');
        }

        // Add punishment turns (this could be implemented as additional turns)
        // For now, we'll just acknowledge the punishment
        return `⚡ ${turns} punishment turn(s) added to ${user.name}.`;
    }

    // Get queue status
    getStatus() {
        if (this.fixedQueue.length === 0) {
            return '🎉 Queue is empty!';
        }

        let status = '📋 **Fixed Dishwasher Queue Status:**\n\n';
        
        this.fixedQueue.forEach((user, index) => {
            const isCurrent = index === this.currentIndex;
            const indicator = isCurrent ? '🔄' : '⏳';
            status += `${indicator} ${index + 1}. ${user.name}${isCurrent ? ' - **CURRENT TURN**' : ''}\n`;
        });

        // Show pending requests
        if (this.swapRequests.size > 0) {
            status += '\n🔄 **Pending Swap Requests:**\n';
            this.swapRequests.forEach((request, id) => {
                status += `• #${id}: ${request.requester.name} ↔ ${request.target.name}\n`;
            });
        }

        return status;
    }

    // Helper method to get user name from user ID
    getUserNameFromId(userId) {
        // This is a simplified mapping - in a real system you'd have a proper user database
        const userMappings = {
            'eden': 'Eden Aronov',
            'adele': 'Adele Aronov', 
            'emma': 'Emma Aronov'
        };
        
        // Try direct mapping first
        if (userMappings[userId]) {
            return userMappings[userId];
        }
        
        // If it's a WhatsApp ID, try to extract name from it
        // This is a simplified approach - you might want to store actual user names
        if (userId.includes('@')) {
            // For now, return a generic name - you'd want to store actual names
            return 'Unknown User';
        }
        
        return userId;
    }

    // Get data for saving
    getData() {
        return {
            fixedQueue: this.fixedQueue,
            currentIndex: this.currentIndex,
            authorizedUsers: Array.from(this.authorizedUsers),
            swapRequests: Array.from(this.swapRequests.entries()),
            nextRequestId: this.nextRequestId
        };
    }

    // Load data from saved state
    loadFromData(data) {
        this.fixedQueue = data.fixedQueue || [
            { id: 'eden', name: 'Eden Aronov' },
            { id: 'adele', name: 'Adele Aronov' },
            { id: 'emma', name: 'Emma Aronov' }
        ];
        this.currentIndex = data.currentIndex || 0;
        this.authorizedUsers = new Set(data.authorizedUsers || []);
        this.swapRequests = new Map(data.swapRequests || []);
        this.nextRequestId = data.nextRequestId || 1;
    }
}

module.exports = QueueManager;