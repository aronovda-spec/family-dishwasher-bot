class PunishmentManager {
    constructor() {
        this.punishmentRequests = new Map(); // Map of requestId -> punishment data
        this.admins = new Set(); // Set of admin user IDs
        this.nextRequestId = 1;
    }

    // Add admin
    addAdmin(userId) {
        this.admins.add(userId);
    }

    // Remove admin
    removeAdmin(userId) {
        this.admins.delete(userId);
    }

    // Check if user is admin
    isAdmin(userId) {
        return this.admins.has(userId);
    }

    // Get list of admins
    getAdmins() {
        return Array.from(this.admins);
    }

    // Submit punishment request
    submitPunishmentRequest(submitterId, targetUserId, targetUserName, turns, reason) {
        const requestId = this.nextRequestId++;
        
        const punishmentRequest = {
            id: requestId,
            submitterId: submitterId,
            targetUserId: targetUserId,
            targetUserName: targetUserName,
            turns: turns,
            reason: reason,
            status: 'pending', // pending, approved, rejected
            submittedAt: new Date().toISOString(),
            approvedBy: null,
            rejectedBy: null,
            processedAt: null
        };

        this.punishmentRequests.set(requestId, punishmentRequest);
        
        return {
            requestId: requestId,
            message: `⚡ **Punishment Request #${requestId}**\n\n` +
                   `👤 Target: ${targetUserName}\n` +
                   `➕ Turns: +${turns}\n` +
                   `📝 Reason: ${reason}\n` +
                   `👨‍💼 Submitted by: ${submitterId}\n\n` +
                   `⏳ Waiting for admin approval...\n` +
                   `Admins can approve with: "approve punishment ${requestId}"\n` +
                   `Admins can reject with: "reject punishment ${requestId}"`
        };
    }

    // Approve punishment request
    approvePunishment(requestId, adminId) {
        if (!this.isAdmin(adminId)) {
            throw new Error('Only admins can approve punishment requests');
        }

        const request = this.punishmentRequests.get(requestId);
        if (!request) {
            throw new Error('Punishment request not found');
        }

        if (request.status !== 'pending') {
            throw new Error('This punishment request has already been processed');
        }

        // Update request status
        request.status = 'approved';
        request.approvedBy = adminId;
        request.processedAt = new Date().toISOString();

        return {
            request: request,
            message: `✅ **Punishment Request #${requestId} APPROVED**\n\n` +
                   `👤 Target: ${request.targetUserName}\n` +
                   `➕ Turns: +${request.turns}\n` +
                   `📝 Reason: ${request.reason}\n` +
                   `👨‍💼 Approved by: ${adminId}\n\n` +
                   `⚡ ${request.turns} punishment turn(s) will be added to ${request.targetUserName}!`
        };
    }

    // Reject punishment request
    rejectPunishment(requestId, adminId) {
        if (!this.isAdmin(adminId)) {
            throw new Error('Only admins can reject punishment requests');
        }

        const request = this.punishmentRequests.get(requestId);
        if (!request) {
            throw new Error('Punishment request not found');
        }

        if (request.status !== 'pending') {
            throw new Error('This punishment request has already been processed');
        }

        // Update request status
        request.status = 'rejected';
        request.rejectedBy = adminId;
        request.processedAt = new Date().toISOString();

        return {
            request: request,
            message: `❌ **Punishment Request #${requestId} REJECTED**\n\n` +
                   `👤 Target: ${request.targetUserName}\n` +
                   `➕ Turns: +${request.turns}\n` +
                   `📝 Reason: ${request.reason}\n` +
                   `👨‍💼 Rejected by: ${adminId}`
        };
    }

    // Get punishment request by ID
    getPunishmentRequest(requestId) {
        return this.punishmentRequests.get(requestId);
    }

    // Get all pending punishment requests
    getPendingPunishments() {
        const pending = [];
        this.punishmentRequests.forEach((request, id) => {
            if (request.status === 'pending') {
                pending.push(request);
            }
        });
        return pending;
    }

    // Get punishment history
    getPunishmentHistory(limit = 10) {
        const allRequests = Array.from(this.punishmentRequests.values())
            .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))
            .slice(0, limit);

        if (allRequests.length === 0) {
            return '📋 No punishment requests found.';
        }

        let history = '📋 **Punishment History:**\n\n';
        
        allRequests.forEach(request => {
            const status = request.status === 'approved' ? '✅' : 
                          request.status === 'rejected' ? '❌' : '⏳';
            
            history += `${status} **#${request.id}** - ${request.targetUserName} (+${request.turns})\n`;
            history += `   📝 ${request.reason}\n`;
            history += `   📅 ${new Date(request.submittedAt).toLocaleDateString()}\n`;
            
            if (request.status === 'approved') {
                history += `   👨‍💼 Approved by: ${request.approvedBy}\n`;
            } else if (request.status === 'rejected') {
                history += `   👨‍💼 Rejected by: ${request.rejectedBy}\n`;
            }
            
            history += '\n';
        });

        return history;
    }

    // Get punishment statistics
    getPunishmentStats() {
        const total = this.punishmentRequests.size;
        const pending = this.getPendingPunishments().length;
        const approved = Array.from(this.punishmentRequests.values())
            .filter(r => r.status === 'approved').length;
        const rejected = Array.from(this.punishmentRequests.values())
            .filter(r => r.status === 'rejected').length;

        return `📊 **Punishment Statistics:**\n\n` +
               `📋 Total Requests: ${total}\n` +
               `⏳ Pending: ${pending}\n` +
               `✅ Approved: ${approved}\n` +
               `❌ Rejected: ${rejected}\n` +
               `👨‍💼 Admins: ${this.admins.size}`;
    }

    // Clean up old processed requests (optional)
    cleanupOldRequests(daysOld = 30) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOld);
        
        let cleanedCount = 0;
        this.punishmentRequests.forEach((request, id) => {
            if (request.status !== 'pending' && new Date(request.processedAt) < cutoffDate) {
                this.punishmentRequests.delete(id);
                cleanedCount++;
            }
        });

        return cleanedCount;
    }

    // Get data for saving
    getData() {
        return {
            punishmentRequests: Array.from(this.punishmentRequests.entries()),
            admins: Array.from(this.admins),
            nextRequestId: this.nextRequestId
        };
    }

    // Load data from saved state
    loadFromData(data) {
        this.punishmentRequests = new Map(data.punishmentRequests || []);
        this.admins = new Set(data.admins || []);
        this.nextRequestId = data.nextRequestId || 1;
    }
}

module.exports = PunishmentManager;
