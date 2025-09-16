// Simple Telegram Dishwasher Bot (no external dependencies)
const https = require('https');
const fs = require('fs');

const token = process.env.TELEGRAM_BOT_TOKEN || '8488813166:AAEk3G5Qe8Yw0B3OlAfLLYq8qszdPL0obUI';
const botUrl = `https://api.telegram.org/bot${token}`;

// Simple queue management
let currentTurn = 0;
const queue = ['Eden Aronov', 'Adele Aronov', 'Emma Aronov'];

// User management
const admins = new Set(); // Set of admin user IDs
const adminChatIds = new Set(); // Set of admin chat IDs for notifications
const authorizedUsers = new Set(); // Set of authorized user IDs (max 3)
const userChatIds = new Map(); // Map: userName -> chatId for notifications

// Link Telegram users to queue names
const userQueueMapping = new Map(); // Map: Telegram user ID -> Queue name
const queueUserMapping = new Map(); // Map: Queue name -> Telegram user ID

// Swap request tracking
const pendingSwaps = new Map(); // Map: requestId -> {fromUser, toUser, fromUserId, toUserId, timestamp}
let swapRequestCounter = 0;

// Punishment system (simplified - no strike counting)
const userPunishments = new Map(); // Map: userName -> {punishmentCount, extraTurns, endDate}
const pendingPunishments = new Map(); // Map: requestId -> {fromUser, targetUser, reason, fromUserId, timestamp}
const punishmentTurns = new Map(); // Map: userName -> number of punishment turns remaining
let punishmentRequestCounter = 0;

// Deduplication for cloud deployment (prevents multiple popups in Render)
const processedUpdates = new Set(); // Track processed update IDs
const instanceId = process.env.RENDER_INSTANCE_ID || `local-${Date.now()}`;

// Button click deduplication (prevents rapid multiple clicks on same button)
const lastUserAction = new Map(); // Map: userId -> {action, timestamp}
const ACTION_COOLDOWN = 1000; // 1 second cooldown between same actions

// Language preference storage
const userLanguage = new Map(); // Map: userId -> 'en' or 'he'

// Royal emoji mapping for elegant display
const royalEmojis = {
    // Admins (by order of addition)
    'admin_1': '👑', // King - First admin
    'admin_2': '💎', // Queen - Second admin
    // Queue members
    'Eden Aronov': '🔱', // Princess 1
    'Adele Aronov': '⭐', // Princess 2  
    'Emma Aronov': '✨'  // Princess 3
};

// Translation dictionaries
const translations = {
    en: {
        // Menu titles
        'admin_menu': 'Admin Menu - Full Access',
        'user_menu': 'User Menu - Queue Access',
        'guest_menu': 'Guest Menu - Limited Access',
        
        // Button texts
        'status': '📊 Status',
        'done': '✅ Done',
        'help': '❓ Help',
        'request_access': '🔐 Request Access',
        'users': '👥 Users',
        'admins': '🔑 Admins',
        'authorize': '🎫 Authorize',
        'add_admin': '👑 Add Admin',
        'force_swap': '⚡ Force Swap',
        'apply_punishment': '⚖️ Apply Punishment',
        'dishwasher_alert': '🚨 Dishwasher Alert!',
        'swap': '🔄 Swap',
        'request_punishment': '⚖️ Request Punishment',
        'language_switch': '🇮🇱 עברית',
        
        // Punishment reasons
        'reason_behavior': '😠 Behavior',
        'reason_household': '🏠 Household Rules',
        'reason_respect': '🤝 Respect',
        'reason_other': '📝 Other',
        
        // Messages
        'dishwasher_queue_status': '📋 **Dishwasher Queue Status:**',
        'current_turn': '- **CURRENT TURN**',
        'not_authorized_user': '(Not authorized)',
        'authorized_users': '👥 **Authorized Users:**',
        'force_swap_current_turn': '⚡ **Force Swap** - Current turn:',
        'swap_current_turn_with': 'Swap current turn with another user:',
        'force_swap_step2': '⚡ **Force Swap** - Step 2',
        'swap_with_select': '🔄 **Swap with:** Select user below',
        
        // Common messages
        'not_authorized': '❌ **Not authorized!**',
        'admin_access_required': '❌ **Admin access required!**',
        'not_your_turn': '❌ **Not your turn!**',
        'current_turn_user': '🔄 **Current turn:**',
        'your_queue_position': '👤 **Your queue position:**',
        'please_wait_turn': '⏳ Please wait for your turn.',
        'dishwasher_alert_sent': '✅ **Dishwasher Alert Sent!**',
        'alerted_user': '👤 **Alerted:**',
        'sent_to_all': '📢 **Sent to:** All authorized users and admins',
        'swap_request_sent': '✅ **Swap request sent to admins!**',
        'punishment_request_sent': '✅ **Punishment request sent to admins!**',
        'target_user': '🎯 **Target:**',
        'reason': '📝 **Reason:**',
        'waiting_approval': '⏰ **Waiting for admin approval...**',
        'punishment_applied': '✅ **Punishment Applied!**',
        'applied_by': '👨‍💼 **Applied by:**',
        'user_authorized': '✅ **User Authorized!**',
        'total_authorized': '📊 **Total authorized users:**',
        'swap_completed': '✅ **Swap completed!**',
        'next_up': '🎯 Next up:',
        'completed_turn': 'completed their turn!',
        'punishment_remaining': '⚖️ Punishment:',
        'extra_turns_remaining': 'extra turn(s) remaining.',
        
        // More popup messages
        'force_swap_completed': '✅ **Force swap completed!**',
        'swap_users': '🔄 **{user1} ↔ {user2}**',
        'punishment_approved': '✅ **Punishment Approved!**',
        'approved_by': '👨‍💼 **Approved by:**',
        'extra_turns_applied': '⚡ **3 extra turns applied immediately!**',
        'admin_direct_punishment': '⚡ **Admin Direct Punishment Applied!**',
        'extra_turns_added': '⚡ **3 extra turns added immediately!**',
        'swap_request_approved': '✅ **Swap request approved!**',
        'swap_request_rejected': '❌ **Swap request rejected!**',
        'swap_request_canceled': '❌ **Swap request canceled!**',
        'keep_current_turn': '🔄 **You keep your current turn.**',
        'declined_swap': 'declined your swap request.',
        'canceled_swap_with': 'You canceled your swap request with',
        'error_users_not_found': '❌ **Error:** Could not find users in queue.',
        'error_queue_position': '❌ **Error:** Could not find your queue position.',
        'punishment_request_expired': '❌ **Punishment request not found or expired!**',
        'not_your_punishment': '❌ **This punishment request is not yours!**',
        'not_your_swap': '❌ **This swap request is not for you!**',
        
        // Done command messages
        'admin_intervention': '✅ **ADMIN INTERVENTION!**',
        'admin_completed_duty': '👨‍💼 **Admin:** {admin} completed dishwasher duty',
        'helped_user': '👤 **Helped user:** {user}',
        'next_turn': '🔄 **Next turn:** {user}',
        'punishment_turns_remaining': '⚡ **Punishment turns remaining:** {count}',
        'admin_can_apply_punishment': '💡 **Admin can manually apply punishment to {user} if needed**',
        'turn_completed': '✅ **TURN COMPLETED!**',
        'completed_by': '👤 **Completed by:** {user}',
        
        // Punishment selection messages
        'apply_punishment_select_reason': 'Apply Punishment - Select reason for {user}:',
        'request_punishment_select_reason': 'Request Punishment - Select reason for {user}:',
        
        // Punishment approval/rejection messages
        'punishment_request_approved': '✅ **Punishment Request Approved!**',
        'punishment_request_rejected': '❌ **Punishment Request Rejected!**',
        'requested_by': '👤 **Requested by:** {user}',
        'rejected_by': '👨‍💼 **Rejected by:** {user}',
        'declined_punishment_request': '👨‍💼 {admin} declined your punishment request for {target}.',
        'you_declined_punishment': '👤 You declined {requester}\'s punishment request.',
        
        // Additional punishment messages
        'punishment_request_submitted': 'Punishment Request Submitted!',
        'admins_notified': 'Admins have been notified!',
        'request_punishment_select_user': 'Request Punishment - Select user to report:',
        
        // Swap messages
        'request_swap_your_position': 'Request Swap - Your position: {position} - Select user to swap with:',
        
        // Authorization messages
        'not_authorized_queue_commands': '❌ **Not authorized!**\n\n👤 {user} is not authorized to use queue commands.\n\n💡 **Ask an admin to authorize you:**\n`/authorize {user}`',
        'not_authorized_swap_features': '❌ **Not authorized!** You need to be authorized to use swap features.',
        
        // Additional swap messages
        'swap_request_sent_detailed': 'Swap request sent! Requested swap with: {user} - Waiting for approval - You can cancel your request if needed',
        'cancel_request': '❌ Cancel Request',
        'swap_request_canceled_notification': '❌ **Swap request canceled!**\n\n👤 {user} canceled their swap request with you.',
        'swap_request_canceled_confirmation': '❌ **Swap request canceled!**\n\n👤 You canceled your swap request with {user}.\n\n🔄 **You keep your current turn.**',
        'swap_request_canceled_admin': '❌ **Swap Request Canceled**\n\n👤 **From:** {from}\n👤 **Canceled by:** {canceledBy}\n👤 **Target was:** {target}\n📅 **Time:** {time}'
    },
    he: {
        // Menu titles
        'admin_menu': 'תפריט מנהל - גישה מלאה',
        'user_menu': 'תפריט משתמש - גישה לתור',
        'guest_menu': 'תפריט אורח - גישה מוגבלת',
        
        // Button texts
        'status': '📊 מצב',
        'done': '✅ סיים',
        'help': '❓ עזרה',
        'request_access': '🔐 בקש גישה',
        'users': '👥 משתמשים',
        'admins': '🔑 מנהלים',
        'authorize': '🎫 הרשה',
        'add_admin': '👑 הוסף מנהל',
        'force_swap': '⚡ החלף בכוח',
        'apply_punishment': '⚖️ הפעל עונש',
        'dishwasher_alert': '🚨 התראת כלים!',
        'swap': '🔄 החלף',
        'request_punishment': '⚖️ בקש עונש',
        'language_switch': '🇺🇸 English',
        
        // Punishment reasons
        'reason_behavior': '😠 התנהגות',
        'reason_household': '🏠 חוקי הבית',
        'reason_respect': '🤝 כבוד',
        'reason_other': '📝 אחר',
        
        // Messages
        'dishwasher_queue_status': '📋 **סטטוס תור הכלים:**',
        'current_turn': '- **התור הנוכחי**',
        'not_authorized_user': '(לא מורשה)',
        'authorized_users': '👥 **משתמשים מורשים:**',
        'force_swap_current_turn': '⚡ **החלפה בכוח** - התור הנוכחי:',
        'swap_current_turn_with': 'החלף את התור הנוכחי עם משתמש אחר:',
        'force_swap_step2': '⚡ **החלפה בכוח** - שלב 2',
        'swap_with_select': '🔄 **החלף עם:** בחר משתמש למטה',
        
        // Common messages
        'not_authorized': '❌ **לא מורשה!**',
        'admin_access_required': '❌ **נדרשת גישת מנהל!**',
        'not_your_turn': '❌ **לא התור שלך!**',
        'current_turn_user': '🔄 **התור הנוכחי:**',
        'your_queue_position': '👤 **המיקום שלך בתור:**',
        'please_wait_turn': '⏳ אנא המתן לתורך.',
        'dishwasher_alert_sent': '✅ **התראת כלים נשלחה!**',
        'alerted_user': '👤 **הותרע:**',
        'sent_to_all': '📢 **נשלח אל:** כל המשתמשים והמנהלים',
        'swap_request_sent': '✅ **בקשת החלפה נשלחה למנהלים!**',
        'punishment_request_sent': '✅ **בקשת עונש נשלחה למנהלים!**',
        'target_user': '🎯 **יעד:**',
        'reason': '📝 **סיבה:**',
        'waiting_approval': '⏰ **ממתין לאישור מנהל...**',
        'punishment_applied': '✅ **עונש הופעל!**',
        'applied_by': '👨‍💼 **הופעל על ידי:**',
        'user_authorized': '✅ **משתמש הורשה!**',
        'total_authorized': '📊 **סך משתמשים מורשים:**',
        'swap_completed': '✅ **החלפה הושלמה!**',
        'next_up': '🎯 הבא בתור:',
        'completed_turn': 'סיים את התור!',
        'punishment_remaining': '⚖️ עונש:',
        'extra_turns_remaining': 'תורות נוספים נותרו.',
        
        // More popup messages
        'force_swap_completed': '✅ **החלפה בכוח הושלמה!**',
        'swap_users': '🔄 **{user1} ↔ {user2}**',
        'punishment_approved': '✅ **עונש אושר!**',
        'approved_by': '👨‍💼 **אושר על ידי:**',
        'extra_turns_applied': '⚡ **3 תורות נוספים הופעלו מיד!**',
        'admin_direct_punishment': '⚡ **עונש ישיר של מנהל הופעל!**',
        'extra_turns_added': '⚡ **3 תורות נוספים נוספו מיד!**',
        'swap_request_approved': '✅ **בקשת החלפה אושרה!**',
        'swap_request_rejected': '❌ **בקשת החלפה נדחתה!**',
        'swap_request_canceled': '❌ **בקשת החלפה בוטלה!**',
        'keep_current_turn': '🔄 **אתה שומר על התור הנוכחי שלך.**',
        'declined_swap': 'דחה את בקשת החלפה שלך.',
        'canceled_swap_with': 'ביטלת את בקשת החלפה שלך עם',
        'error_users_not_found': '❌ **שגיאה:** לא ניתן למצוא משתמשים בתור.',
        'error_queue_position': '❌ **שגיאה:** לא ניתן למצוא את מיקומך בתור.',
        'punishment_request_expired': '❌ **בקשת עונש לא נמצאה או פגה תוקפה!**',
        'not_your_punishment': '❌ **בקשת עונש זו לא שלך!**',
        'not_your_swap': '❌ **בקשת החלפה זו לא מיועדת לך!**',
        
        // Done command messages
        'admin_intervention': '✅ **התערבות מנהל!**',
        'admin_completed_duty': '👨‍💼 **מנהל:** {admin} השלים את חובת הכלים',
        'helped_user': '👤 **עזר למשתמש:** {user}',
        'next_turn': '🔄 **התור הבא:** {user}',
        'punishment_turns_remaining': '⚡ **תורות עונש נותרו:** {count}',
        'admin_can_apply_punishment': '💡 **מנהל יכול להפעיל עונש על {user} במידת הצורך**',
        'turn_completed': '✅ **התור הושלם!**',
        'completed_by': '👤 **הושלם על ידי:** {user}',
        
        // Punishment selection messages
        'apply_punishment_select_reason': 'הפעל עונש - בחר סיבה עבור {user}:',
        'request_punishment_select_reason': 'בקש עונש - בחר סיבה עבור {user}:',
        
        // Punishment approval/rejection messages
        'punishment_request_approved': '✅ **בקשת עונש אושרה!**',
        'punishment_request_rejected': '❌ **בקשת עונש נדחתה!**',
        'requested_by': '👤 **התבקש על ידי:** {user}',
        'rejected_by': '👨‍💼 **נדחה על ידי:** {user}',
        'declined_punishment_request': '👨‍💼 {admin} דחה את בקשת העונש שלך עבור {target}.',
        'you_declined_punishment': '👤 דחית את בקשת העונש של {requester}.',
        
        // Additional punishment messages
        'punishment_request_submitted': 'בקשת עונש הוגשה!',
        'admins_notified': 'המנהלים הותרעו!',
        'request_punishment_select_user': 'בקש עונש - בחר משתמש לדיווח:',
        
        // Swap messages
        'request_swap_your_position': 'בקש החלפה - המיקום שלך: {position} - בחר משתמש להחלפה:',
        
        // Authorization messages
        'not_authorized_queue_commands': '❌ **לא מורשה!**\n\n👤 {user} לא מורשה להשתמש בפקודות התור.\n\n💡 **בקש ממנהל להרשות אותך:**\n`/authorize {user}`',
        'not_authorized_swap_features': '❌ **לא מורשה!** אתה צריך להיות מורשה כדי להשתמש בתכונות החלפה.',
        
        // Additional swap messages
        'swap_request_sent_detailed': 'בקשת החלפה נשלחה! ביקשת החלפה עם: {user} - ממתין לאישור - אתה יכול לבטל את הבקשה שלך במידת הצורך',
        'cancel_request': '❌ בטל בקשה',
        'swap_request_canceled_notification': '❌ **בקשת החלפה בוטלה!**\n\n👤 {user} ביטל את בקשת החלפה שלו איתך.',
        'swap_request_canceled_confirmation': '❌ **בקשת החלפה בוטלה!**\n\n👤 ביטלת את בקשת החלפה שלך עם {user}.\n\n🔄 **אתה שומר על התור הנוכחי שלך.**',
        'swap_request_canceled_admin': '❌ **בקשת החלפה בוטלה**\n\n👤 **מאת:** {from}\n👤 **בוטל על ידי:** {canceledBy}\n👤 **היעד היה:** {target}\n📅 **זמן:** {time}'
    }
};

// Get user's language preference
function getUserLanguage(userId) {
    return userLanguage.get(userId) || 'en'; // Default to English
}

// Get translated text
function t(userId, key, replacements = {}) {
    const lang = getUserLanguage(userId);
    let text = translations[lang][key] || translations.en[key] || key;
    
    // Replace placeholders like {user}, {admin}, {count}
    for (const [placeholder, value] of Object.entries(replacements)) {
        text = text.replace(new RegExp(`{${placeholder}}`, 'g'), value);
    }
    
    return text;
}

// Function to add royal emoji to user names
function addRoyalEmoji(userName) {
    // Check if it's a queue member first
    if (royalEmojis[userName]) {
        return `${royalEmojis[userName]} ${userName}`;
    }
    
    // Check if it's an admin (by order)
    const adminArray = Array.from(admins);
    if (adminArray.length > 0 && (adminArray[0] === userName || adminArray[0] === userName.toLowerCase())) {
        return `${royalEmojis.admin_1} ${userName}`; // King
    }
    if (adminArray.length > 1 && (adminArray[1] === userName || adminArray[1] === userName.toLowerCase())) {
        return `${royalEmojis.admin_2} ${userName}`; // Queen
    }
    
    // Return plain name if no royal emoji found
    return userName;
}

// Send message to Telegram
function sendMessage(chatId, text) {
    const url = `${botUrl}/sendMessage`;
    const data = JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown'
    });
    
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    };
    
    const req = https.request(url, options, (res) => {
        console.log(`📤 Sent message to ${chatId}`);
    });
    
    req.write(data);
    req.end();
}

// Send message with buttons
function sendMessageWithButtons(chatId, text, buttons) {
    const url = `${botUrl}/sendMessage`;
    const data = JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: buttons
        }
    });
    
    console.log(`🔘 Sending buttons to ${chatId}:`, JSON.stringify(buttons, null, 2));
    console.log(`🔘 Full request data:`, data);
    
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    };
    
    const req = https.request(url, options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
            responseData += chunk;
        });
        res.on('end', () => {
            console.log(`📤 Button response:`, responseData);
            try {
                const response = JSON.parse(responseData);
                if (response.ok) {
                    console.log(`✅ Buttons sent successfully!`);
                } else {
                    console.log(`❌ Button error:`, response.description);
                }
            } catch (e) {
                console.log(`❌ Error parsing button response:`, e.message);
            }
        });
    });
    
    req.write(data);
    req.end();
}

// Handle commands
function handleCommand(chatId, userId, userName, text) {
    const command = text.toLowerCase().trim();
    
    console.log(`🔍 Processing: "${command}" from ${userName}`);
    
    if (command === '/start') {
        // Store chat ID for this user (for notifications)
        userChatIds.set(userName, chatId);
        userChatIds.set(userName.toLowerCase(), chatId);
        
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        const isAuthorized = authorizedUsers.has(userName) || authorizedUsers.has(userName.toLowerCase());
        
        // If this user is an admin, store their chat ID for admin notifications
        if (isAdmin) {
            adminChatIds.add(chatId);
            console.log(`👨‍💼 Admin ${userName} (${userId}) chat ID ${chatId} added to adminChatIds`);
        }
        
        let text = `Dishwasher Bot Menu`;
        let buttons = [];
        
        if (isAdmin) {
            text += t(userId, 'admin_menu');
            buttons = [
                [
                    { text: t(userId, 'status'), callback_data: "status" },
                    { text: t(userId, 'done'), callback_data: "done" }
                ],
                [
                    { text: t(userId, 'users'), callback_data: "users" },
                    { text: t(userId, 'admins'), callback_data: "admins" }
                ],
                [
                    { text: t(userId, 'authorize'), callback_data: "authorize_menu" },
                    { text: t(userId, 'add_admin'), callback_data: "addadmin_menu" }
                ],
                [
                    { text: t(userId, 'force_swap'), callback_data: "force_swap_menu" },
                    { text: t(userId, 'apply_punishment'), callback_data: "apply_punishment_menu" }
                ],
                [
                    { text: t(userId, 'dishwasher_alert'), callback_data: "dishwasher_alert" }
                ],
                [
                    { text: t(userId, 'language_switch'), callback_data: "language_switch" }
                ]
            ];
        } else if (isAuthorized) {
            text += t(userId, 'user_menu');
            buttons = [
                [
                    { text: t(userId, 'status'), callback_data: "status" },
                    { text: t(userId, 'done'), callback_data: "done" }
                ],
                [
                    { text: t(userId, 'swap'), callback_data: "swap_menu" },
                    { text: t(userId, 'request_punishment'), callback_data: "request_punishment_menu" }
                ],
                [
                    { text: t(userId, 'help'), callback_data: "help" }
                ],
                [
                    { text: t(userId, 'language_switch'), callback_data: "language_switch" }
                ]
            ];
        } else {
            text += t(userId, 'guest_menu');
            buttons = [
                [
                    { text: t(userId, 'status'), callback_data: "status" },
                    { text: t(userId, 'help'), callback_data: "help" }
                ],
                [
                    { text: t(userId, 'request_access'), callback_data: "request_access" }
                ],
                [
                    { text: t(userId, 'language_switch'), callback_data: "language_switch" }
                ]
            ];
        }
        
        const url = `${botUrl}/sendMessage`;
        const data = JSON.stringify({
            chat_id: chatId,
            text: text,
            reply_markup: {
                inline_keyboard: buttons
            }
        });
        
        console.log(`🔘 Sending role-based buttons:`, JSON.stringify(buttons, null, 2));
        
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };
        
        const req = https.request(url, options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => {
                responseData += chunk;
            });
            res.on('end', () => {
                console.log(`📤 Role-based response:`, responseData);
                try {
                    const response = JSON.parse(responseData);
                    if (response.ok) {
                        console.log(`✅ Buttons sent successfully!`);
                        if (response.result.reply_markup) {
                            console.log(`🔘 Reply markup present:`, JSON.stringify(response.result.reply_markup, null, 2));
                        } else {
                            console.log(`❌ No reply_markup in response!`);
                        }
                    } else {
                        console.log(`❌ Button error:`, response.description);
                    }
                } catch (e) {
                    console.log(`❌ Error parsing response:`, e.message);
                }
            });
        });
        
        req.write(data);
        req.end();
        
    } else if (command === '/status' || command === 'status') {
        let statusMessage = `${t(userId, 'dishwasher_queue_status')}\n\n`;
        
        // Debug: Show current queue state
        console.log(`🔍 DEBUG - Current queue: [${queue.join(', ')}]`);
        console.log(`🔍 DEBUG - Current turn: ${currentTurn}`);
        console.log(`🔍 DEBUG - Queue length: ${queue.length}`);
        
        // Show only the next 3 consecutive turns (current + next 2)
        for (let i = 0; i < 3; i++) {
            const turnIndex = (currentTurn + i) % queue.length;
            const name = queue[turnIndex];
            const royalName = addRoyalEmoji(name); // Add royal emoji
            const isCurrentTurn = i === 0;
            const turnIcon = isCurrentTurn ? '🔄' : '⏳';
            const turnText = isCurrentTurn ? ` ${t(userId, 'current_turn')}` : '';
            
            // Check if this queue member is authorized
            const authorizedUser = queueUserMapping.get(name);
            const authText = authorizedUser ? ` (${authorizedUser})` : ` ${t(userId, 'not_authorized_user')}`;
            
            statusMessage += `${turnIcon} ${i + 1}. ${royalName}${turnText}${authText}\n`;
        }
        
        statusMessage += `\n${t(userId, 'authorized_users')} ${authorizedUsers.size}/3`;
        
        // Show punishment information
        const usersWithPunishments = Array.from(punishmentTurns.entries()).filter(([user, turns]) => turns > 0);
        if (usersWithPunishments.length > 0) {
            statusMessage += `\n\n⚡ **Active Punishments:**`;
            usersWithPunishments.forEach(([user, turns]) => {
                statusMessage += `\n• ${user}: ${turns} punishment turn${turns > 1 ? 's' : ''} remaining`;
            });
        }
        
        sendMessage(chatId, statusMessage);
        
    } else if (command === '/done' || command === 'done') {
        // Check if user is admin
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        
        if (isAdmin) {
            // Admin "Done" - Admin takes over dishwasher duty
            const currentUser = queue[currentTurn];
            
            // Check if this was a punishment turn and remove it BEFORE advancing
            const punishmentTurnsRemaining = punishmentTurns.get(currentUser) || 0;
            if (punishmentTurnsRemaining > 0) {
                punishmentTurns.set(currentUser, punishmentTurnsRemaining - 1);
                
                // Remove the FIRST occurrence of the punished user (always the punishment turn)
                const punishmentIndex = queue.indexOf(currentUser);
                if (punishmentIndex !== -1) {
                    queue.splice(punishmentIndex, 1);
                    console.log(`⚡ Punishment turn completed for ${currentUser}. Removed from queue. Remaining: ${punishmentTurnsRemaining - 1}`);
                }
                
                // For punishment turns, don't advance currentTurn since queue has already shifted
                // currentTurn stays the same because we removed the current position
            } else {
                // Only advance currentTurn for normal turns
                currentTurn = (currentTurn + 1) % queue.length;
            }
            
            // Check for temporary swap reversion
            if (global.tempSwaps && global.tempSwaps.has('current')) {
                const tempSwap = global.tempSwaps.get('current');
                if (tempSwap.isActive) {
                    // Revert the temporary swap
                    const firstIndex = queue.indexOf(tempSwap.firstUser);
                    const secondIndex = queue.indexOf(tempSwap.secondUser);
                    
                    if (firstIndex !== -1 && secondIndex !== -1) {
                        [queue[firstIndex], queue[secondIndex]] = [queue[secondIndex], queue[firstIndex]];
                        console.log(`🔄 Temporary swap reverted: ${tempSwap.firstUser} ↔ ${tempSwap.secondUser}`);
                        console.log(`🔍 DEBUG - After reversion: [${queue.join(', ')}]`);
                    }
                    
                    // Mark swap as inactive
                    tempSwap.isActive = false;
                    global.tempSwaps.delete('current');
                }
            }
            
            const nextUser = queue[currentTurn];
            
            const adminDoneMessage = `${t(userId, 'admin_intervention')}\n\n` +
                `${t(userId, 'admin_completed_duty', {admin: userName})}\n` +
                `${t(userId, 'helped_user', {user: currentUser})}\n` +
                `${t(userId, 'next_turn', {user: nextUser})}` +
                (punishmentTurnsRemaining > 0 ? `\n${t(userId, 'punishment_turns_remaining', {count: punishmentTurnsRemaining - 1})}` : '') +
                `\n\n${t(userId, 'admin_can_apply_punishment', {user: currentUser})}`;
            
            // Send confirmation to admin
            sendMessage(chatId, adminDoneMessage);
            
            // Notify all authorized users and admins
            [...authorizedUsers, ...admins].forEach(user => {
                // Try to find chat ID for this user
                let userChatId = userChatIds.get(user) || userChatIds.get(user.toLowerCase());
                
                if (userChatId && userChatId !== chatId) {
                    console.log(`🔔 Sending admin DONE notification to ${user} (${userChatId})`);
                    sendMessage(userChatId, adminDoneMessage);
                } else {
                    console.log(`🔔 No chat ID found for ${user}`);
                }
            });
            
        } else {
            // Regular user "Done" - Check if user is authorized
            if (!authorizedUsers.has(userName) && !authorizedUsers.has(userName.toLowerCase())) {
                sendMessage(chatId, t(userId, 'not_authorized_queue_commands', {user: userName}));
                return;
            }
            
            const currentUser = queue[currentTurn];
            const userQueueName = userQueueMapping.get(userName) || userQueueMapping.get(userName.toLowerCase());
            
            // Check if it's actually their turn
            if (userQueueName !== currentUser) {
                sendMessage(chatId, `${t(userId, 'not_your_turn')}\n\n${t(userId, 'current_turn_user')} ${currentUser}\n${t(userId, 'your_queue_position')} ${userQueueName}\n\n${t(userId, 'please_wait_turn')}`);
                return;
            }
            
            // Check if this was a punishment turn and remove it BEFORE advancing
            const punishmentTurnsRemaining = punishmentTurns.get(currentUser) || 0;
            if (punishmentTurnsRemaining > 0) {
                punishmentTurns.set(currentUser, punishmentTurnsRemaining - 1);
                
                // Remove the FIRST occurrence of the punished user (always the punishment turn)
                const punishmentIndex = queue.indexOf(currentUser);
                if (punishmentIndex !== -1) {
                    queue.splice(punishmentIndex, 1);
                    console.log(`⚡ Punishment turn completed for ${currentUser}. Removed from queue. Remaining: ${punishmentTurnsRemaining - 1}`);
                }
                
                // For punishment turns, don't advance currentTurn since queue has already shifted
                // currentTurn stays the same because we removed the current position
            } else {
                // Only advance currentTurn for normal turns
                currentTurn = (currentTurn + 1) % queue.length;
            }
            
            // Check for temporary swap reversion
            if (global.tempSwaps && global.tempSwaps.has('current')) {
                const tempSwap = global.tempSwaps.get('current');
                if (tempSwap.isActive) {
                    // Revert the temporary swap
                    const firstIndex = queue.indexOf(tempSwap.firstUser);
                    const secondIndex = queue.indexOf(tempSwap.secondUser);
                    
                    if (firstIndex !== -1 && secondIndex !== -1) {
                        [queue[firstIndex], queue[secondIndex]] = [queue[secondIndex], queue[firstIndex]];
                        console.log(`🔄 Temporary swap reverted: ${tempSwap.firstUser} ↔ ${tempSwap.secondUser}`);
                        console.log(`🔍 DEBUG - After reversion: [${queue.join(', ')}]`);
                    }
                    
                    // Mark swap as inactive
                    tempSwap.isActive = false;
                    global.tempSwaps.delete('current');
                }
            }
            
            const nextUser = queue[currentTurn];
            
            const doneMessage = `${t(userId, 'turn_completed')}\n\n` +
                `${t(userId, 'completed_by', {user: currentUser})}\n` +
                `${t(userId, 'next_turn', {user: nextUser})}` +
                (punishmentTurnsRemaining > 0 ? `\n${t(userId, 'punishment_turns_remaining', {count: punishmentTurnsRemaining - 1})}` : '');
            
            // Notify all authorized users and admins
            [...authorizedUsers, ...admins].forEach(user => {
                // Try to find chat ID for this user
                let userChatId = userChatIds.get(user) || userChatIds.get(user.toLowerCase());
                
                if (userChatId && userChatId !== chatId) {
                    console.log(`🔔 Sending user DONE notification to ${user} (${userChatId})`);
                    sendMessage(userChatId, doneMessage);
                } else {
                    console.log(`🔔 No chat ID found for ${user}`);
                }
            });
        }
        
    } else if (command === '/help' || command === 'help') {
        const helpMessage = `🤖 **בוט מדיח הכלים של המשפחה (Family Dishwasher Bot):**\n\n` +
            `📋 **פקודות התור (Queue Commands):**\n` +
            `• \`/status\` - הצגת התור הנוכחי (Show current queue)\n` +
            `• \`/done\` - השלמת התור שלך (Complete your turn)\n\n` +
            `🔄 **החלפת תורות (Swap Turns):**\n` +
            `• **החלפה (Swap)** - בקשה להחלפה עם משתמש אחר\n` +
            `• **תהליך:** בחר משתמש → המשתמש מקבל הודעה → צריך לאשר או לדחות\n` +
            `• **אישור:** שני הצדדים צריכים להסכים להחלפה\n` +
            `• **ביטול:** אתה יכול לבטל את הבקשה שלך בכל עת (כפתור "Cancel Request")\n\n` +
            `⚡ **דיווח על משתמש (Report User):**\n` +
            `• **בקשת ענישה (Request Punishment)** - דיווח על משתמש אחר\n` +
            `• **תהליך:** בחר משתמש → בחר סיבה → מנהלים מקבלים הודעה\n` +
            `• **אישור:** מנהל צריך לאשר את הענישה (3 תורות נוספים)\n\n` +
            `🎯 **תור קבוע (Fixed Queue):** עדן (Eden) → עדלה (Adele) → אמה (Emma) → (חוזר)\n\n` +
            `💡 **טיפ (Tip):** השתמש בכפתורים לניווט קל יותר! (Use buttons for easier mobile interaction!)`;
        
        sendMessage(chatId, helpMessage);
        
    } else if (command === '/admins' || command === 'admins') {
        if (admins.size === 0) {
            sendMessage(chatId, '👨‍💼 **No admins set yet.**\n\nUse `/addadmin <user>` to add an admin.');
        } else {
            const adminList = Array.from(admins).map(id => {
                // Check if it's a numeric ID or username
                if (/^\d+$/.test(id)) {
                    return `• User ID: ${id}`;
                } else {
                    return `• Username: ${id}`;
                }
            }).join('\n');
            sendMessage(chatId, `👨‍💼 **Current Admins:**\n\n${adminList}\n\n📊 **Total admins:** ${admins.size}`);
        }
        
    } else if (command === '/users' || command === 'users') {
        if (authorizedUsers.size === 0) {
            sendMessage(chatId, '👥 **No authorized users set yet.**\n\nUse `/authorize <user>` to authorize a user.\n\n📋 **Available queue members:**\n• Eden Aronov\n• Adele Aronov\n• Emma Aronov');
        } else {
            let userList = '👥 **Authorized Users:**\n\n';
            authorizedUsers.forEach(user => {
                const queueName = userQueueMapping.get(user);
                userList += `• ${user} → ${queueName}\n`;
            });
            userList += `\n📝 **Note:** Maximum 3 authorized users allowed.`;
            sendMessage(chatId, userList);
        }
        
    } else if (command.startsWith('/addadmin ')) {
        const userToAdd = command.replace('/addadmin ', '').trim();
        
        if (!userToAdd) {
            sendMessage(chatId, '❌ **Usage:** `/addadmin <username>`\n\nExample: `/addadmin Dani`');
            return;
        }
        
        // Check if this is the first admin (no existing admins)
        if (admins.size === 0) {
            // First admin can add themselves or anyone
            admins.add(userToAdd);
            admins.add(userToAdd.toLowerCase()); // Add lowercase version for case-insensitive matching
            
            // Note: We don't add chatId here because we don't know the new admin's chat ID yet
            // The new admin's chat ID will be stored when they send /start or interact with the bot
            sendMessage(chatId, `✅ **First Admin Added!**\n\n👨‍💼 ${userToAdd} is now the first admin.\n\n🔑 **Admin privileges:**\n• Manage queue\n• Authorize users\n• Add/remove admins\n• Force swaps\n• Apply punishments\n\n💡 **Note:** ${userToAdd} needs to send /start to the bot to receive notifications.`);
            return;
        }
        
        // If there are existing admins, check if current user is an admin
        if (!admins.has(userName) && !admins.has(userName.toLowerCase()) && !admins.has(userId.toString())) {
            sendMessage(chatId, `❌ **Admin access required!**\n\n👤 ${userName} is not an admin.\n\n💡 **Ask an existing admin to add you:**\n\`/addadmin ${userName}\``);
            return;
        }
        
        // Prevent self-promotion for existing admins
        if (userToAdd.toLowerCase() === userName.toLowerCase() || userToAdd === userId.toString()) {
            sendMessage(chatId, `❌ **Cannot add yourself as admin!**\n\n🛡️ **Security protection:** Only other admins can promote you.\n\n💡 **Ask another admin to add you:**\n\`/addadmin ${userName}\``);
            return;
        }
        
        // Add the new admin
        admins.add(userToAdd);
        admins.add(userToAdd.toLowerCase()); // Add lowercase version for case-insensitive matching
        
        // Note: We don't add chatId here because we don't know the new admin's chat ID yet
        // The new admin's chat ID will be stored when they send /start or interact with the bot
        sendMessage(chatId, `✅ **Admin Added!**\n\n👨‍💼 ${userToAdd} is now an admin.\n\n🔑 **Admin privileges:**\n• Manage queue\n• Authorize users\n• Add/remove admins\n• Force swaps\n• Apply punishments\n\n💡 **Note:** ${userToAdd} needs to send /start to the bot to receive notifications.`);
        
    } else if (command.startsWith('/removeadmin ')) {
        // Check if user is already an admin
        if (!admins.has(userName) && !admins.has(userName.toLowerCase()) && !admins.has(userId.toString())) {
            sendMessage(chatId, `❌ **Admin access required!**\n\n👤 ${userName} is not an admin.`);
            return;
        }
        
        const userToRemove = command.replace('/removeadmin ', '').trim();
        if (userToRemove) {
            // Prevent self-removal (security protection)
            if (userToRemove.toLowerCase() === userName.toLowerCase() || userToRemove === userId.toString()) {
                sendMessage(chatId, `❌ **Cannot remove yourself as admin!**\n\n🛡️ **Security protection:** Only other admins can remove you.\n\n💡 **Ask another admin to remove you:**\n\`/removeadmin ${userName}\``);
                return;
            }
            
            // Check if user exists in admins
            if (admins.has(userToRemove)) {
                admins.delete(userToRemove);
                sendMessage(chatId, `✅ **Admin Removed!**\n\n👤 ${userToRemove} is no longer an admin.\n\n🔒 **Admin privileges revoked.**`);
            } else {
                sendMessage(chatId, `❌ **User not found!**\n\n👤 ${userToRemove} is not an admin.\n\n💡 **Use \`/admins\` to see current admins.**`);
            }
        } else {
            sendMessage(chatId, '❌ **Usage:** `/removeadmin <username>`\n\nExample: `/removeadmin Dani`');
        }
        
    } else if (command.startsWith('punishment_reason_')) {
        // Handle punishment reason input
        const parts = command.split(' ');
        const requestId = parseInt(parts[0].replace('punishment_reason_', ''));
        const reason = parts.slice(1).join(' ');
        
        const punishmentRequest = pendingPunishments.get(requestId);
        if (!punishmentRequest) {
            sendMessage(chatId, t(userId, 'punishment_request_expired'));
            return;
        }
        
        if (punishmentRequest.fromUserId !== userId) {
            sendMessage(chatId, t(userId, 'not_your_punishment'));
            return;
        }
        
        // Update the request with reason
        punishmentRequest.reason = reason;
        
        // Notify all admins
        const adminMessage = `⚡ **Punishment Request**\n\n👤 **From:** ${userName}\n🎯 **Target:** ${punishmentRequest.targetUser}\n📝 **Reason:** ${reason}`;
        
        const buttons = [
            [
                { text: "✅ Approve", callback_data: `punishment_approve_${requestId}` },
                { text: "❌ Reject", callback_data: `punishment_reject_${requestId}` }
            ]
        ];
        
        // Send to all admins
        admins.forEach(admin => {
            const adminChatId = userQueueMapping.get(admin) ? queueUserMapping.get(userQueueMapping.get(admin)) : null;
            if (adminChatId) {
                sendMessageWithButtons(adminChatId, adminMessage, buttons);
            }
        });
        
        sendMessage(chatId, `${t(userId, 'punishment_request_sent')}\n\n${t(userId, 'target_user')} ${punishmentRequest.targetUser}\n${t(userId, 'reason')} ${reason}\n${t(userId, 'waiting_approval')}`);
        
    } else if (command.startsWith('admin_punishment_reason_')) {
        // Handle admin punishment reason input
        const parts = command.split(' ');
        const requestId = parseInt(parts[0].replace('admin_punishment_reason_', ''));
        const reason = parts.slice(1).join(' ');
        
        const punishmentRequest = pendingPunishments.get(requestId);
        if (!punishmentRequest) {
            sendMessage(chatId, t(userId, 'punishment_request_expired'));
            return;
        }
        
        if (punishmentRequest.fromUserId !== userId) {
            sendMessage(chatId, t(userId, 'not_your_punishment'));
            return;
        }
        
        // Apply punishment directly (admin doesn't need approval)
        applyPunishment(punishmentRequest.targetUser, reason, userName);
        
        sendMessage(chatId, `${t(userId, 'punishment_applied')}\n\n${t(userId, 'target_user')} ${punishmentRequest.targetUser}\n${t(userId, 'reason')} ${reason}\n${t(userId, 'applied_by')} ${userName}`);
        
        // Remove request
        pendingPunishments.delete(requestId);
        
    } else if (command.startsWith('/authorize ')) {
        // Check if user is an admin
        if (!admins.has(userName) && !admins.has(userName.toLowerCase()) && !admins.has(userId.toString())) {
            sendMessage(chatId, `❌ **Admin access required!**\n\n👤 ${userName} is not an admin.\n\n💡 **Only admins can authorize users.**`);
            return;
        }
        
        const userToAuth = command.replace('/authorize ', '').trim();
        if (userToAuth) {
            if (authorizedUsers.size >= 3) {
                sendMessage(chatId, '❌ **Maximum 3 authorized users reached!**\n\nRemove a user first before adding another.');
            } else {
                // Check if user is one of the queue members
                const queueMember = queue.find(name => 
                    name.toLowerCase().includes(userToAuth.toLowerCase()) ||
                    userToAuth.toLowerCase().includes(name.toLowerCase())
                );
                
                if (queueMember) {
                    authorizedUsers.add(userToAuth);
                    authorizedUsers.add(userToAuth.toLowerCase()); // Add lowercase version for case-insensitive matching
                    userQueueMapping.set(userToAuth, queueMember);
                    userQueueMapping.set(userToAuth.toLowerCase(), queueMember); // Add lowercase mapping
                    queueUserMapping.set(queueMember, userToAuth);
                    
                    // Store chat ID for notifications (we'll need to get this from the user when they interact)
                    // For now, we'll store it when they send /start
                    sendMessage(chatId, `${t(userId, 'user_authorized')}\n\n👥 ${userToAuth} → ${queueMember}\n\n${t(userId, 'total_authorized')} ${authorizedUsers.size}/3`);
                } else {
                    sendMessage(chatId, `❌ **User not in queue!**\n\n👥 **Available queue members:**\n• Eden Aronov\n• Adele Aronov\n• Emma Aronov\n\n💡 **Usage:** \`/authorize Eden\` or \`/authorize Eden Aronov\``);
                }
            }
        } else {
            sendMessage(chatId, '❌ **Usage:** `/authorize <username>`\n\nExample: `/authorize Eden`');
        }
        
    } else {
        sendMessage(chatId, '❌ Unknown command. Type /help to see available commands.');
    }
}

// Apply punishment to a user (ONLY called by admin approval or admin direct action)
function applyPunishment(targetUser, reason, appliedBy) {
    // Apply punishment: 3 EXTRA turns IMMEDIATELY
    const punishmentCount = (userPunishments.get(targetUser)?.punishmentCount || 0) + 1;
    const extraTurns = 3;
    const endDate = new Date(Date.now() + (extraTurns * 24 * 60 * 60 * 1000)); // 3 days from now
    
    userPunishments.set(targetUser, {
        punishmentCount: punishmentCount,
        extraTurns: extraTurns,
        endDate: endDate
    });
    
    // Track punishment turns remaining
    const currentPunishmentTurns = punishmentTurns.get(targetUser) || 0;
    punishmentTurns.set(targetUser, currentPunishmentTurns + extraTurns);
    
    // Apply punishment IMMEDIATELY by adding 3 extra turns to the queue
    console.log(`🔍 DEBUG - Before punishment: queue=[${queue.join(', ')}], currentTurn=${currentTurn}`);
    
    // Insert the punished user 3 times consecutively at the current position (immediately)
    for (let i = 0; i < extraTurns; i++) {
        queue.splice(currentTurn, 0, targetUser);
        console.log(`🔍 DEBUG - After inserting turn ${i + 1}: queue=[${queue.join(', ')}]`);
    }
    
    console.log(`🔍 DEBUG - After punishment: queue=[${queue.join(', ')}], currentTurn=${currentTurn}`);
    
    // Notify all users
    const message = `⚡ **PUNISHMENT APPLIED IMMEDIATELY!**\n\n🎯 **Target:** ${targetUser}\n📝 **Reason:** ${reason}\n👨‍💼 **Applied by:** ${appliedBy}\n\n🚫 **Punishment:** ${extraTurns} EXTRA turns added RIGHT NOW!\n📊 **Total punishment turns:** ${currentPunishmentTurns + extraTurns}\n📅 **Ends:** ${endDate.toLocaleDateString()}`;
    
    // Send to all authorized users and admins
    [...authorizedUsers, ...admins].forEach(user => {
        const userChatId = userQueueMapping.get(user) ? queueUserMapping.get(userQueueMapping.get(user)) : null;
        if (userChatId) {
            sendMessage(userChatId, message);
        }
    });
    
    console.log(`⚡ Punishment applied IMMEDIATELY to ${targetUser}: ${reason} (by ${appliedBy}) - ${extraTurns} extra turns added to queue`);
}

// Report user for punishment (NO strike counting)
function reportUser(targetUser, reason, reportedBy) {
    // Just notify admins about the report
    const message = `📢 **PUNISHMENT REQUEST!**\n\n🎯 **Target:** ${targetUser}\n📝 **Reason:** ${reason}\n👨‍💼 **Reported by:** ${reportedBy}\n\n⚡ **Action:** Admin can use "Apply Punishment" button if needed`;
    
    // Send to all admins
    admins.forEach(admin => {
        const adminChatId = userQueueMapping.get(admin) ? queueUserMapping.get(userQueueMapping.get(admin)) : null;
        if (adminChatId) {
            sendMessage(adminChatId, message);
        }
    });
    
    console.log(`📢 Punishment request for ${targetUser}: ${reason} (by ${reportedBy})`);
}

// Execute approved swap
function executeSwap(swapRequest, requestId, status) {
    const { fromUser, toUser, fromUserId, toUserId } = swapRequest;
    
    // Find queue positions
    const fromIndex = queue.indexOf(userQueueMapping.get(fromUser));
    const toIndex = queue.indexOf(toUser);
    
    if (fromIndex !== -1 && toIndex !== -1) {
        // Swap positions in queue
        [queue[fromIndex], queue[toIndex]] = [queue[toIndex], queue[fromIndex]];
        
        // Update current turn if needed
        if (currentTurn === fromIndex) {
            currentTurn = toIndex;
        } else if (currentTurn === toIndex) {
            currentTurn = fromIndex;
        }
        
        // Notify both users
        const message = `✅ **Swap Approved!**\n\n🔄 **${fromUser} ↔ ${toUser}**\n\n📋 **New queue order:**\n${queue.map((name, index) => `${index + 1}. ${name}${index === currentTurn ? ' (CURRENT TURN)' : ''}`).join('\n')}`;
        
        sendMessage(fromUserId, message);
        sendMessage(toUserId, message);
        
        // Notify all other authorized users and admins using userChatIds
        [...authorizedUsers, ...admins].forEach(user => {
            if (user !== fromUser && user !== toUser) {
                let userChatId = userChatIds.get(user) || userChatIds.get(user.toLowerCase());
                if (userChatId) {
                    console.log(`🔔 Sending swap approval notification to ${user} (${userChatId})`);
                    sendMessage(userChatId, `🔄 **Queue Update:** ${fromUser} ↔ ${toUser} swapped positions!`);
                } else {
                    console.log(`🔔 No chat ID found for ${user}`);
                }
            }
        });
    }
    
    // Remove the request
    pendingSwaps.delete(requestId);
}

// Handle callback queries (button presses)
function handleCallback(chatId, userId, userName, data) {
    console.log(`🔘 Button pressed: "${data}" by ${userName}`);
    
    if (data === 'test') {
        sendMessage(chatId, `🧪 **Test Button Works!**\n\n✅ Inline buttons are working correctly!\n\n👤 **Pressed by:** ${userName}\n🆔 **User ID:** ${userId}\n🔘 **Button data:** ${data}`);
    } else if (data === 'status') {
        handleCommand(chatId, userId, userName, 'status');
    } else if (data === 'done') {
        handleCommand(chatId, userId, userName, 'done');
    } else if (data === 'users') {
        handleCommand(chatId, userId, userName, 'users');
    } else if (data === 'admins') {
        handleCommand(chatId, userId, userName, 'admins');
    } else if (data === 'help') {
        handleCommand(chatId, userId, userName, 'help');
    } else if (data === 'dishwasher_alert') {
        console.log(`🔍 DEBUG - Dishwasher alert handler triggered by ${userName} (${userId})`);
        
        // Check if this is an admin
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        console.log(`🔍 DEBUG - Is admin check: ${isAdmin} (userName: ${userName}, userId: ${userId})`);
        
        if (!isAdmin) {
            console.log(`🔍 DEBUG - Access denied for ${userName}`);
            sendMessage(chatId, '❌ **Admin access required!**');
            return;
        }
        
        // Get current turn user
        const currentUser = queue[currentTurn];
        if (!currentUser) {
            sendMessage(chatId, '❌ **No one is currently in the queue!**');
            return;
        }
        
        // Send alert to all authorized users and admins
        const alertMessage = `🚨 **DISHWASHER ALERT!** 🚨\n\n👤 **It's ${currentUser}'s turn!**\n⏰ **Time to do the dishes!**\n\n📢 **Reminder sent by:** ${userName}`;
        
        // Notify all authorized users and admins
        [...authorizedUsers, ...admins].forEach(user => {
            let userChatId = userChatIds.get(user) || userChatIds.get(user.toLowerCase());
            if (userChatId && userChatId !== chatId) {
                console.log(`🔔 Sending dishwasher alert to ${user} (${userChatId})`);
                sendMessage(userChatId, alertMessage);
            }
        });
        
        // Also notify admins using adminChatIds (in case they're not in userChatIds)
        adminChatIds.forEach(adminChatId => {
            if (adminChatId !== chatId) {
                console.log(`🔔 Sending dishwasher alert to admin chat ID: ${adminChatId}`);
                sendMessage(adminChatId, alertMessage);
            }
        });
        
        // Send confirmation to admin
        sendMessage(chatId, `${t(userId, 'dishwasher_alert_sent')}\n\n${t(userId, 'alerted_user')} ${currentUser}\n${t(userId, 'sent_to_all')}`);
        
    } else if (data === 'authorize_menu') {
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        if (isAdmin) {
            const message = `🔧 **Authorize Users**\n\n` +
                `📋 **Available queue members:**\n` +
                `• Eden Aronov\n` +
                `• Adele Aronov\n` +
                `• Emma Aronov\n\n` +
                `💡 **Usage:** Type \`/authorize Eden\` to authorize Eden`;
            sendMessage(chatId, message);
        } else {
            sendMessage(chatId, '❌ **Admin access required!**');
        }
    } else if (data === 'addadmin_menu') {
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        if (isAdmin) {
            const message = `➕ **Add Admin**\n\n` +
                `💡 **Usage:** Type \`/addadmin <username>\`\n\n` +
                `**Example:** \`/addadmin Marianna\``;
            sendMessage(chatId, message);
        } else {
            sendMessage(chatId, '❌ **Admin access required!**');
        }
    } else if (data === 'request_access') {
        const message = `🔐 **Request Access**\n\n` +
            `👤 ${userName}, you need to be authorized to use queue commands.\n\n` +
            `💡 **Ask an admin to authorize you:**\n` +
            `\`/authorize ${userName}\`\n\n` +
            `📋 **Available queue positions:**\n` +
            `• Eden Aronov\n` +
            `• Adele Aronov\n` +
            `• Emma Aronov`;
        sendMessage(chatId, message);
        
        // Notify all admins about the authorization request
        const adminNotification = `🔔 **New Authorization Request**\n\n` +
            `👤 **User:** ${userName}\n` +
            `🆔 **User ID:** ${userId}\n` +
            `📅 **Time:** ${new Date().toLocaleString()}\n\n` +
            `💡 **To authorize:** \`/authorize ${userName}\``;
        
        // Send notification to all admins
        for (const adminChatId of adminChatIds) {
            if (adminChatId !== chatId) { // Don't notify the user themselves
                console.log(`🔔 Sending admin notification to chat ID: ${adminChatId}`);
                sendMessage(adminChatId, adminNotification);
            }
        }
        
    } else if (data === 'language_switch') {
        const currentLang = getUserLanguage(userId);
        const newLang = currentLang === 'en' ? 'he' : 'en';
        userLanguage.set(userId, newLang);
        
        const switchMessage = newLang === 'he' ? 
            `🇮🇱 **שפה שונתה לעברית!** ✅\n\nהבוט יציג כעת הכל בעברית.\nשלח /start כדי לראות את התפריט החדש! 🎯` :
            `🇺🇸 **Language switched to English!** ✅\n\nThe bot will now display everything in English.\nSend /start to see the new menu! 🎯`;
        
        sendMessage(chatId, switchMessage);
        
    } else if (data === 'swap_menu') {
        const isAuthorized = authorizedUsers.has(userName) || authorizedUsers.has(userName.toLowerCase());
        if (!isAuthorized) {
            sendMessage(chatId, t(userId, 'not_authorized_swap_features'));
            return;
        }
        
        const currentUserQueueName = userQueueMapping.get(userName) || userQueueMapping.get(userName.toLowerCase());
        
        // Show all users except the current user (can't swap with yourself)
        const uniqueUsers = [...new Set(queue)];
        const availableUsers = uniqueUsers.filter(name => name !== currentUserQueueName);
        const buttons = availableUsers.map(name => [{ text: addRoyalEmoji(name), callback_data: `swap_request_${name}` }]);
        
        sendMessageWithButtons(chatId, 
            t(userId, 'request_swap_your_position', {position: currentUserQueueName}), 
            buttons
        );
        
    } else if (data.startsWith('swap_request_')) {
        const targetUser = data.replace('swap_request_', '');
        const currentUserQueueName = userQueueMapping.get(userName) || userQueueMapping.get(userName.toLowerCase());
        
        if (!currentUserQueueName) {
            sendMessage(chatId, t(userId, 'error_queue_position'));
            return;
        }
        
        // Check if it's the current user's turn
        const currentUserIndex = queue.indexOf(currentUserQueueName);
        if (currentTurn !== currentUserIndex) {
            sendMessage(chatId, '❌ **Not your turn!** You can only request swaps during your turn.');
            return;
        }
        
        // Check if user already has a pending swap request
        for (const [requestId, request] of pendingSwaps.entries()) {
            if (request.fromUserId === userId) {
                sendMessage(chatId, `❌ **You already have a pending swap request!**\n\n🎯 **Current request:** ${request.fromUser} ↔ ${request.toUser}\n⏰ **Request ID:** ${requestId}\n\n💡 **You can cancel your current request before creating a new one.**`);
                return;
            }
        }
        
        // Check if target user already has a pending swap request
        for (const [requestId, request] of pendingSwaps.entries()) {
            if (request.toUserId === targetUserId || request.fromUserId === targetUserId) {
                sendMessage(chatId, `❌ **${targetUser} already has a pending swap request!**\n\n🎯 **Current request:** ${request.fromUser} ↔ ${request.toUser}\n⏰ **Request ID:** ${requestId}\n\n💡 **Please wait for this request to be resolved before creating a new one.**`);
                return;
            }
        }
        
        // Create swap request
        const requestId = ++swapRequestCounter;
        const targetUserId = queueUserMapping.get(targetUser);
        
        pendingSwaps.set(requestId, {
            fromUser: userName,
            toUser: targetUser,
            fromUserId: userId,
            toUserId: targetUserId,
            timestamp: Date.now()
        });
        
        // Notify the target user
        if (targetUserId) {
            const buttons = [
                [
                    { text: "✅ Approve", callback_data: `swap_approve_${requestId}` },
                    { text: "❌ Reject", callback_data: `swap_reject_${requestId}` }
                ]
            ];
            
            sendMessageWithButtons(targetUserId, 
                `🔄 **Swap Request**\n\n👤 **From:** ${userName} (${currentUserQueueName})\n🎯 **Wants to swap with:** ${targetUser}`, 
                buttons
            );
        }
        
        // Notify all admins about the swap request
        const adminNotification = `🔄 **New Swap Request**\n\n👤 **From:** ${userName} (${currentUserQueueName})\n🎯 **Wants to swap with:** ${targetUser}\n📅 **Time:** ${new Date().toLocaleString()}\n\n💡 **Request ID:** ${requestId}`;
        
        for (const adminChatId of adminChatIds) {
            if (adminChatId !== chatId && adminChatId !== targetUserId) { // Don't notify the requester or target user
                console.log(`🔔 Sending admin swap notification to chat ID: ${adminChatId}`);
                sendMessage(adminChatId, adminNotification);
            }
        }
        
        // Send confirmation to the requester with cancel option
        const cancelButtons = [
            [
                { text: t(userId, 'cancel_request'), callback_data: `swap_cancel_${requestId}` }
            ]
        ];
        
        sendMessageWithButtons(chatId, 
            t(userId, 'swap_request_sent_detailed', {user: targetUser}), 
            cancelButtons
        );
        
    } else if (data.startsWith('swap_approve_')) {
        const requestId = parseInt(data.replace('swap_approve_', ''));
        const swapRequest = pendingSwaps.get(requestId);
        
        if (!swapRequest) {
            sendMessage(chatId, '❌ **Swap request not found or expired!**');
            return;
        }
        
        // Check if this is the correct user approving
        if (swapRequest.toUserId !== userId) {
            sendMessage(chatId, '❌ **This swap request is not for you!**');
            return;
        }
        
        // Execute the swap
        executeSwap(swapRequest, requestId, 'approved');
        
    } else if (data.startsWith('swap_reject_')) {
        const requestId = parseInt(data.replace('swap_reject_', ''));
        const swapRequest = pendingSwaps.get(requestId);
        
        if (!swapRequest) {
            sendMessage(chatId, '❌ **Swap request not found or expired!**');
            return;
        }
        
        // Check if this is the correct user rejecting
        if (swapRequest.toUserId !== userId) {
            sendMessage(chatId, '❌ **This swap request is not for you!**');
            return;
        }
        
        // Notify the requester
        sendMessage(swapRequest.fromUserId, `❌ **Swap request rejected!**\n\n👤 ${userName} declined your swap request.`);
        sendMessage(chatId, `❌ **Swap request rejected!**\n\n👤 You declined ${swapRequest.fromUser}'s swap request.`);
        
        // Notify all admins about the rejection
        const adminNotification = `❌ **Swap Request Rejected**\n\n👤 **From:** ${swapRequest.fromUser}\n👤 **Rejected by:** ${userName}\n📅 **Time:** ${new Date().toLocaleString()}`;
        
        for (const adminChatId of adminChatIds) {
            if (adminChatId !== chatId && adminChatId !== swapRequest.fromUserId) { // Don't notify the rejector or requester
                console.log(`🔔 Sending admin swap rejection notification to chat ID: ${adminChatId}`);
                sendMessage(adminChatId, adminNotification);
            }
        }
        
        // Remove the request
        pendingSwaps.delete(requestId);
        
    } else if (data.startsWith('swap_cancel_')) {
        const requestId = parseInt(data.replace('swap_cancel_', ''));
        const swapRequest = pendingSwaps.get(requestId);
        
        if (!swapRequest) {
            sendMessage(chatId, '❌ **Swap request not found or expired!**');
            return;
        }
        
        // Check if this is the correct user canceling
        if (swapRequest.fromUserId !== userId) {
            sendMessage(chatId, '❌ **This swap request is not yours!**');
            return;
        }
        
        // Notify the target user that the request was canceled
        if (swapRequest.toUserId) {
            sendMessage(swapRequest.toUserId, t(swapRequest.toUserId, 'swap_request_canceled_notification', {user: userName}));
        }
        
        // Notify the requester
        sendMessage(chatId, t(userId, 'swap_request_canceled_confirmation', {user: swapRequest.toUser}));
        
        // Notify all admins about the cancellation
        const adminNotification = t(userId, 'swap_request_canceled_admin', {
            from: swapRequest.fromUser,
            canceledBy: userName,
            target: swapRequest.toUser,
            time: new Date().toLocaleString()
        });
        
        for (const adminChatId of adminChatIds) {
            if (adminChatId !== chatId && adminChatId !== swapRequest.toUserId) { // Don't notify the canceler or target user
                console.log(`🔔 Sending admin swap cancellation notification to chat ID: ${adminChatId}`);
                sendMessage(adminChatId, adminNotification);
            }
        }
        
        // Remove the request
        pendingSwaps.delete(requestId);
        
    } else if (data === 'force_swap_menu') {
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        if (!isAdmin) {
            sendMessage(chatId, '❌ **Admin access required!**');
            return;
        }
        
        console.log(`🔍 Queue contents:`, queue);
        console.log(`🔍 Current turn:`, currentTurn);
        
        // Only show current turn user for Force Swap (avoid misleading)
        const currentUser = queue[currentTurn];
        const royalCurrentUser = addRoyalEmoji(currentUser);
        const buttons = [[{ text: `🎯 ${royalCurrentUser} (Current Turn)`, callback_data: `force_swap_select_${currentUser}` }]];
        
        console.log(`🔍 Force Swap - Current turn user: ${currentUser}`);
        
        sendMessageWithButtons(chatId, 
            `${t(userId, 'force_swap_current_turn')} **${royalCurrentUser}**\n\n${t(userId, 'swap_current_turn_with')}`, 
            buttons
        );
        
    } else if (data.startsWith('force_swap_select_')) {
        const firstUser = data.replace('force_swap_select_', '');
        
        // Get unique users excluding the current turn user
        const uniqueUsers = [...new Set(queue)];
        const remainingUsers = uniqueUsers.filter(name => name !== firstUser);
        
        const buttons = remainingUsers.map(name => [{ text: addRoyalEmoji(name), callback_data: `force_swap_execute_${firstUser}_${name}` }]);
        const royalFirstUser = addRoyalEmoji(firstUser);
        
        sendMessageWithButtons(chatId, 
            `${t(userId, 'force_swap_step2')}\n\n🎯 **Current turn:** ${royalFirstUser}\n${t(userId, 'swap_with_select')}`, 
            buttons
        );
        
    } else if (data.startsWith('force_swap_execute_')) {
        const dataWithoutPrefix = data.replace('force_swap_execute_', '');
        const lastUnderscoreIndex = dataWithoutPrefix.lastIndexOf('_');
        const firstUser = dataWithoutPrefix.substring(0, lastUnderscoreIndex);
        const secondUser = dataWithoutPrefix.substring(lastUnderscoreIndex + 1);
        
        // Execute immediate swap
        const firstIndex = queue.indexOf(firstUser);
        const secondIndex = queue.indexOf(secondUser);
        
        console.log(`🔍 DEBUG - Force swap: ${firstUser} ↔ ${secondUser}`);
        console.log(`🔍 DEBUG - Current queue: [${queue.join(', ')}]`);
        console.log(`🔍 DEBUG - First user "${firstUser}" found at index: ${firstIndex}`);
        console.log(`🔍 DEBUG - Second user "${secondUser}" found at index: ${secondIndex}`);
        
        if (firstIndex !== -1 && secondIndex !== -1) {
            // Swap positions in queue
            console.log(`🔍 DEBUG - Before swap: queue[${firstIndex}] = "${queue[firstIndex]}", queue[${secondIndex}] = "${queue[secondIndex]}"`);
            [queue[firstIndex], queue[secondIndex]] = [queue[secondIndex], queue[firstIndex]];
            console.log(`🔍 DEBUG - After swap: queue[${firstIndex}] = "${queue[firstIndex]}", queue[${secondIndex}] = "${queue[secondIndex]}"`);
            console.log(`🔍 DEBUG - After swap: [${queue.join(', ')}]`);
            
            // Verify the swap actually happened
            console.log(`🔍 DEBUG - Queue reference check: queue === global queue? ${queue === global.queue || 'No global.queue'}`);
            
            // Check if queue is being reset somewhere
            setTimeout(() => {
                console.log(`🔍 DEBUG - Queue after 100ms: [${queue.join(', ')}]`);
            }, 100);
            
            // Update current turn if needed
            // If currentTurn was pointing to one of the swapped positions, update it
            if (currentTurn === firstIndex) {
                currentTurn = secondIndex;
            } else if (currentTurn === secondIndex) {
                currentTurn = firstIndex;
            }
            // Note: If currentTurn was not involved in the swap, it stays the same
            // This means the current turn person remains the same, just their position in queue changes
            
            console.log(`🔍 DEBUG - After currentTurn update: currentTurn=${currentTurn}`);
            
            // FIX: Always reset currentTurn to 0 after a swap to ensure status shows from the beginning
            currentTurn = 0;
            console.log(`🔍 DEBUG - After currentTurn reset: currentTurn=${currentTurn}`);
            
            // TEMPORARY SWAP: Mark this as a temporary swap that will revert after current turn
            // We'll store the original positions to restore them later
            const tempSwap = {
                firstUser: firstUser,
                secondUser: secondUser,
                firstOriginalIndex: secondIndex, // Where first user should be after swap
                secondOriginalIndex: firstIndex,  // Where second user should be after swap
                isActive: true
            };
            
            // Store the temporary swap info
            if (!global.tempSwaps) global.tempSwaps = new Map();
            global.tempSwaps.set('current', tempSwap);
            
            console.log(`🔍 DEBUG - Temporary swap stored: ${firstUser}↔${secondUser} (will revert after current turn)`);
            
            // Notify all users
            const message = `⚡ **Admin Force Swap Executed!**\n\n🔄 **${firstUser} ↔ ${secondUser}**\n\n📋 **New queue order:**\n${queue.map((name, index) => `${index + 1}. ${name}${index === currentTurn ? ' (CURRENT TURN)' : ''}`).join('\n')}`;
            
            // Send to all authorized users and admins using userChatIds
            [...authorizedUsers, ...admins].forEach(user => {
                let userChatId = userChatIds.get(user) || userChatIds.get(user.toLowerCase());
                if (userChatId && userChatId !== chatId) { // Don't notify the admin who performed the swap
                    console.log(`🔔 Sending force swap notification to ${user} (${userChatId})`);
                    sendMessage(userChatId, message);
                } else {
                    console.log(`🔔 No chat ID found for ${user} or is the admin who performed swap`);
                }
            });
            
            sendMessage(chatId, `${t(userId, 'force_swap_completed')}\n\n🔄 **${firstUser} ↔ ${secondUser}**`);
        } else {
            sendMessage(chatId, t(userId, 'error_users_not_found'));
        }
        
    } else if (data === 'request_punishment_menu') {
        const isAuthorized = authorizedUsers.has(userName) || authorizedUsers.has(userName.toLowerCase());
        if (!isAuthorized) {
            sendMessage(chatId, '❌ **Not authorized!** You need to be authorized to request punishments.');
            return;
        }
        
        const currentUserQueueName = userQueueMapping.get(userName) || userQueueMapping.get(userName.toLowerCase());
        const availableUsers = queue.filter(name => name !== currentUserQueueName);
        
        if (availableUsers.length === 0) {
            sendMessage(chatId, '❌ **No users available to report!**');
            return;
        }
        
        const buttons = availableUsers.map(name => [{ text: addRoyalEmoji(name), callback_data: `punishment_target_${name}` }]);
        
        sendMessageWithButtons(chatId, 
            t(userId, 'request_punishment_select_user'), 
            buttons
        );
        
    } else if (data.startsWith('punishment_target_')) {
        const targetUser = data.replace('punishment_target_', '');
        
        // Show reason selection buttons
        const reasonButtons = [
            [
                { text: t(userId, 'reason_behavior'), callback_data: `punishment_reason_${targetUser}_Behavior` },
                { text: t(userId, 'reason_household'), callback_data: `punishment_reason_${targetUser}_Household Rules` }
            ],
            [
                { text: t(userId, 'reason_respect'), callback_data: `punishment_reason_${targetUser}_Respect` },
                { text: t(userId, 'reason_other'), callback_data: `punishment_reason_${targetUser}_Other` }
            ]
        ];
        
        sendMessageWithButtons(chatId, t(userId, 'request_punishment_select_reason', {user: targetUser}), reasonButtons);
        
    } else if (data.startsWith('punishment_reason_')) {
        const parts = data.replace('punishment_reason_', '').split('_');
        const targetUser = parts[0];
        const reason = parts[1];
        
        // Create punishment request (similar to swap request system)
        const requestId = ++punishmentRequestCounter;
        
        pendingPunishments.set(requestId, {
            fromUser: userName,
            targetUser: targetUser,
            reason: reason,
            fromUserId: userId,
            timestamp: Date.now()
        });
        
        // Notify all admins with approval/rejection buttons (NO EMOJIS)
        const adminMessage = `Punishment Request\n\nFrom: ${userName}\nTarget: ${targetUser}\nReason: ${reason}`;
        
        const buttons = [
            [
                { text: "✅ Approve", callback_data: `punishment_approve_${requestId}` },
                { text: "❌ Reject", callback_data: `punishment_reject_${requestId}` }
            ]
        ];
        
        // Send to all admins
        for (const adminChatId of adminChatIds) {
            if (adminChatId !== chatId) { // Don't notify the requester
                console.log(`🔔 Sending admin punishment notification to chat ID: ${adminChatId}`);
                sendMessageWithButtons(adminChatId, adminMessage, buttons);
            }
        }
        
        sendMessage(chatId, `${t(userId, 'punishment_request_submitted')}\n\n${t(userId, 'target_user')} ${targetUser}\n${t(userId, 'reason')} ${reason}\n${t(userId, 'requested_by', {user: userName})}\n\n${t(userId, 'admins_notified')}`);
        
    } else if (data.startsWith('punishment_approve_')) {
        const requestId = parseInt(data.replace('punishment_approve_', ''));
        const punishmentRequest = pendingPunishments.get(requestId);
        
        if (!punishmentRequest) {
            sendMessage(chatId, t(userId, 'punishment_request_expired'));
            return;
        }
        
        // Check if this is an admin
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        if (!isAdmin) {
            sendMessage(chatId, '❌ **Admin access required!**');
            return;
        }
        
        // Apply punishment
        applyPunishment(punishmentRequest.targetUser, punishmentRequest.reason, userName);
        
        // Send confirmation to admin who approved
        sendMessage(chatId, `${t(userId, 'punishment_approved')}\n\n${t(userId, 'target_user')} ${punishmentRequest.targetUser}\n${t(userId, 'reason')} ${punishmentRequest.reason}\n${t(userId, 'approved_by')} ${userName}\n\n${t(userId, 'extra_turns_applied')}`);
        
        // Notify requester
        sendMessage(punishmentRequest.fromUserId, `${t(punishmentRequest.fromUserId, 'punishment_approved')}\n\n${t(punishmentRequest.fromUserId, 'target_user')} ${punishmentRequest.targetUser}\n${t(punishmentRequest.fromUserId, 'reason')} ${punishmentRequest.reason}\n${t(punishmentRequest.fromUserId, 'approved_by')} ${userName}`);
        
        // Notify all other authorized users and admins about the approval
        // Note: For notifications to other users, we need to get their language preference
        const approvalMessage = `${t(userId, 'punishment_request_approved')}\n\n${t(userId, 'requested_by', {user: punishmentRequest.fromUser})}\n${t(userId, 'target_user')} ${punishmentRequest.targetUser}\n${t(userId, 'reason')} ${punishmentRequest.reason}\n${t(userId, 'approved_by')} ${userName}\n\n${t(userId, 'extra_turns_applied')}`;
        
        // Notify all authorized users
        [...authorizedUsers].forEach(user => {
            let userChatId = userChatIds.get(user) || userChatIds.get(user.toLowerCase());
            if (userChatId && userChatId !== chatId && userChatId !== punishmentRequest.fromUserId) {
                console.log(`🔔 Sending punishment approval notification to ${user} (${userChatId})`);
                sendMessage(userChatId, approvalMessage);
            }
        });
        
        // Notify all admins using adminChatIds
        for (const adminChatId of adminChatIds) {
            if (adminChatId !== chatId && adminChatId !== punishmentRequest.fromUserId) {
                console.log(`🔔 Sending punishment approval notification to admin chat ID: ${adminChatId}`);
                sendMessage(adminChatId, approvalMessage);
            }
        }
        
        // Remove request
        pendingPunishments.delete(requestId);
        
    } else if (data.startsWith('punishment_reject_')) {
        const requestId = parseInt(data.replace('punishment_reject_', ''));
        const punishmentRequest = pendingPunishments.get(requestId);
        
        if (!punishmentRequest) {
            sendMessage(chatId, t(userId, 'punishment_request_expired'));
            return;
        }
        
        // Check if this is an admin
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        if (!isAdmin) {
            sendMessage(chatId, '❌ **Admin access required!**');
            return;
        }
        
        // Notify requester
        sendMessage(punishmentRequest.fromUserId, `${t(punishmentRequest.fromUserId, 'punishment_request_rejected')}\n\n${t(punishmentRequest.fromUserId, 'declined_punishment_request', {admin: userName, target: punishmentRequest.targetUser})}`);
        sendMessage(chatId, `${t(userId, 'punishment_request_rejected')}\n\n${t(userId, 'you_declined_punishment', {requester: punishmentRequest.fromUser})}`);
        
        // Notify all other authorized users and admins about the rejection
        const rejectionMessage = `${t(userId, 'punishment_request_rejected')}\n\n${t(userId, 'requested_by', {user: punishmentRequest.fromUser})}\n${t(userId, 'target_user')} ${punishmentRequest.targetUser}\n${t(userId, 'reason')} ${punishmentRequest.reason}\n${t(userId, 'rejected_by', {user: userName})}`;
        
        // Notify all authorized users
        [...authorizedUsers].forEach(user => {
            let userChatId = userChatIds.get(user) || userChatIds.get(user.toLowerCase());
            if (userChatId && userChatId !== chatId && userChatId !== punishmentRequest.fromUserId) {
                console.log(`🔔 Sending punishment rejection notification to ${user} (${userChatId})`);
                sendMessage(userChatId, rejectionMessage);
            }
        });
        
        // Notify all admins using adminChatIds
        for (const adminChatId of adminChatIds) {
            if (adminChatId !== chatId && adminChatId !== punishmentRequest.fromUserId) {
                console.log(`🔔 Sending punishment rejection notification to admin chat ID: ${adminChatId}`);
                sendMessage(adminChatId, rejectionMessage);
            }
        }
        
        // Remove request
        pendingPunishments.delete(requestId);
        
    } else if (data === 'apply_punishment_menu') {
        const isAdmin = admins.has(userName) || admins.has(userName.toLowerCase()) || admins.has(userId.toString());
        if (!isAdmin) {
            sendMessage(chatId, '❌ **Admin access required!**');
            return;
        }
        
        // Get unique users from the queue to avoid duplicate buttons
        const uniqueUsers = [...new Set(queue)];
        const buttons = uniqueUsers.map(name => [{ text: addRoyalEmoji(name), callback_data: `admin_punish_${name}` }]);
        
        sendMessageWithButtons(chatId, 
            `Apply Punishment - Select user to punish:`, 
            buttons
        );
        
    } else if (data.startsWith('admin_punish_')) {
        const targetUser = data.replace('admin_punish_', '');
        
        // Show reason selection for admin punishment
        const buttons = [
            [
                { text: t(userId, 'reason_behavior'), callback_data: `admin_punishment_reason_${targetUser}_Behavior` },
                { text: t(userId, 'reason_household'), callback_data: `admin_punishment_reason_${targetUser}_Household Rules` }
            ],
            [
                { text: t(userId, 'reason_respect'), callback_data: `admin_punishment_reason_${targetUser}_Respect` },
                { text: t(userId, 'reason_other'), callback_data: `admin_punishment_reason_${targetUser}_Other` }
            ]
        ];
        
        sendMessageWithButtons(chatId, t(userId, 'apply_punishment_select_reason', {user: targetUser}), buttons);
        
    } else if (data.startsWith('admin_punishment_reason_')) {
        const parts = data.replace('admin_punishment_reason_', '').split('_');
        const targetUser = parts[0];
        const reason = parts[1];
        
        // Apply punishment directly with selected reason
        applyPunishment(targetUser, reason, userName);
        sendMessage(chatId, `${t(userId, 'punishment_applied')}\n\n${t(userId, 'target_user')} ${targetUser}\n${t(userId, 'reason')} ${reason}\n${t(userId, 'applied_by')} ${userName}\n\n${t(userId, 'extra_turns_added')}`);
        
        // Notify all authorized users and admins about the admin direct punishment
        const notificationMessage = `${t(userId, 'admin_direct_punishment')}\n\n${t(userId, 'target_user')} ${targetUser}\n${t(userId, 'reason')} ${reason}\n${t(userId, 'applied_by')} ${userName}\n\n${t(userId, 'extra_turns_added')}`;
        
        // Notify all authorized users
        [...authorizedUsers].forEach(user => {
            let userChatId = userChatIds.get(user) || userChatIds.get(user.toLowerCase());
            if (userChatId && userChatId !== chatId) {
                console.log(`🔔 Sending admin direct punishment notification to ${user} (${userChatId})`);
                sendMessage(userChatId, notificationMessage);
            }
        });
        
        // Notify all admins using adminChatIds
        for (const adminChatId of adminChatIds) {
            if (adminChatId !== chatId) {
                console.log(`🔔 Sending admin direct punishment notification to admin chat ID: ${adminChatId}`);
                sendMessage(adminChatId, notificationMessage);
            }
        }
        
    } else {
        sendMessage(chatId, '❌ Unknown button action. Please use the main menu.');
    }
}

// Get updates from Telegram
function getUpdates(offset = 0) {
    const url = `${botUrl}/getUpdates?offset=${offset}&timeout=30`;
    
    https.get(url, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            try {
                const response = JSON.parse(data);
                
                if (response.ok && response.result.length > 0) {
                    let lastUpdateId = 0;
                    
                    response.result.forEach(update => {
                        lastUpdateId = update.update_id;
                        
                        // Deduplication: Skip if this update was already processed
                        if (processedUpdates.has(update.update_id)) {
                            console.log(`🔄 Skipping duplicate update ${update.update_id} (instance: ${instanceId})`);
                            return;
                        }
                        
                        // Mark this update as processed
                        processedUpdates.add(update.update_id);
                        
                        // Clean up old processed updates (keep only last 1000)
                        if (processedUpdates.size > 1000) {
                            const oldestUpdates = Array.from(processedUpdates).slice(0, 100);
                            oldestUpdates.forEach(id => processedUpdates.delete(id));
                        }
                        
                        if (update.message) {
                            const chatId = update.message.chat.id;
                            const userId = update.message.from.id;
                            const userName = update.message.from.first_name + 
                                (update.message.from.last_name ? ' ' + update.message.from.last_name : '');
                            const text = update.message.text;
                            
                            handleCommand(chatId, userId, userName, text);
                        }
                        
                        if (update.callback_query) {
                            const chatId = update.callback_query.message.chat.id;
                            const userId = update.callback_query.from.id;
                            const userName = update.callback_query.from.first_name + 
                                (update.callback_query.from.last_name ? ' ' + update.callback_query.from.last_name : '');
                            const data = update.callback_query.data;
                            
                            // Button click deduplication: prevent rapid multiple clicks on same button
                            const now = Date.now();
                            const lastAction = lastUserAction.get(userId);
                            
                            if (lastAction && lastAction.action === data && (now - lastAction.timestamp) < ACTION_COOLDOWN) {
                                console.log(`🔄 Skipping rapid button click: ${data} by ${userName} (cooldown: ${ACTION_COOLDOWN}ms)`);
                                return;
                            }
                            
                            // Update last action
                            lastUserAction.set(userId, { action: data, timestamp: now });
                            
                            handleCallback(chatId, userId, userName, data);
                            
                            // Answer callback query
                            const answerUrl = `${botUrl}/answerCallbackQuery`;
                            const answerData = JSON.stringify({
                                callback_query_id: update.callback_query.id
                            });
                            
                            const answerOptions = {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Content-Length': answerData.length
                                }
                            };
                            
                            const answerReq = https.request(answerUrl, answerOptions);
                            answerReq.write(answerData);
                            answerReq.end();
                        }
                    });
                    
                    // Continue polling
                    setTimeout(() => getUpdates(lastUpdateId + 1), 1000);
                } else {
                    // No updates, continue polling
                    setTimeout(() => getUpdates(offset), 1000);
                }
            } catch (error) {
                console.log('❌ Error processing updates:', error.message);
                setTimeout(() => getUpdates(offset), 5000);
            }
        });
    }).on('error', (error) => {
        console.log('❌ Error getting updates:', error.message);
        setTimeout(() => getUpdates(offset), 5000);
    });
}

// Note: Time limitations removed - requests stay until manually canceled

// Webhook support for Render deployment
const http = require('http');
const url = require('url');

// Keep-alive mechanism to prevent Render from sleeping
function keepAlive() {
    if (process.env.RENDER_EXTERNAL_HOSTNAME) {
        const keepAliveUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/health`;
        console.log('🔄 Sending keep-alive ping to:', keepAliveUrl);
        
        https.get(keepAliveUrl, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                console.log('✅ Keep-alive ping successful:', data);
            });
        }).on('error', (err) => {
            console.log('❌ Keep-alive ping failed:', err.message);
        });
    } else {
        console.log('🏠 Keep-alive skipped - running locally');
    }
}

// HTTP server for webhook and health check
const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    
    // Health check endpoint
    if (parsedUrl.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'healthy', 
            timestamp: new Date().toISOString(),
            instance: instanceId,
            queue: queue.length,
            currentTurn: currentTurn
        }));
        return;
    }
    
    // Webhook endpoint for Telegram
    if (parsedUrl.pathname === '/webhook' && req.method === 'POST') {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });
        
        req.on('end', () => {
            try {
                const update = JSON.parse(body);
                
                // Deduplication: Skip if this update was already processed
                if (processedUpdates.has(update.update_id)) {
                    console.log(`🔄 Skipping duplicate webhook update ${update.update_id} (instance: ${instanceId})`);
                    res.writeHead(200);
                    res.end('OK');
                    return;
                }
                
                // Mark this update as processed
                processedUpdates.add(update.update_id);
                
                // Clean up old processed updates (keep only last 1000)
                if (processedUpdates.size > 1000) {
                    const oldestUpdates = Array.from(processedUpdates).slice(0, 100);
                    oldestUpdates.forEach(id => processedUpdates.delete(id));
                }
                
                // Process the update
                if (update.message) {
                    const chatId = update.message.chat.id;
                    const userId = update.message.from.id;
                    const userName = update.message.from.first_name + 
                        (update.message.from.last_name ? ' ' + update.message.from.last_name : '');
                    const text = update.message.text;
                    
                    handleCommand(chatId, userId, userName, text);
                }
                
                if (update.callback_query) {
                    const chatId = update.callback_query.message.chat.id;
                    const userId = update.callback_query.from.id;
                    const userName = update.callback_query.from.first_name + 
                        (update.callback_query.from.last_name ? ' ' + update.callback_query.from.last_name : '');
                    const data = update.callback_query.data;
                    
                    // Button click deduplication: prevent rapid multiple clicks on same button
    const now = Date.now();
                    const lastAction = lastUserAction.get(userId);
                    
                    if (lastAction && lastAction.action === data && (now - lastAction.timestamp) < ACTION_COOLDOWN) {
                        console.log(`🔄 Skipping rapid button click: ${data} by ${userName} (cooldown: ${ACTION_COOLDOWN}ms)`);
                        res.writeHead(200);
                        res.end('OK');
                        return;
                    }
                    
                    // Update last action
                    lastUserAction.set(userId, { action: data, timestamp: now });
                    
                    handleCallback(chatId, userId, userName, data);
                    
                    // Answer callback query
                    const answerUrl = `${botUrl}/answerCallbackQuery`;
                    const answerData = JSON.stringify({
                        callback_query_id: update.callback_query.id
                    });
                    
                    const answerOptions = {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Content-Length': answerData.length
                        }
                    };
                    
                    const answerReq = https.request(answerUrl, answerOptions);
                    answerReq.write(answerData);
                    answerReq.end();
                }
                
                res.writeHead(200);
                res.end('OK');
                
            } catch (error) {
                console.log('❌ Error processing webhook:', error.message);
                res.writeHead(400);
                res.end('Bad Request');
            }
        });
        
        return;
    }
    
    // Default response
    res.writeHead(404);
    res.end('Not Found');
});

// Start server for Render deployment or if PORT is explicitly set
const PORT = process.env.PORT || 3000;
if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    // Always start server on Render
    server.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`🌐 Health check: https://${process.env.RENDER_EXTERNAL_HOSTNAME}/health`);
        console.log(`🔗 Webhook endpoint: https://${process.env.RENDER_EXTERNAL_HOSTNAME}/webhook`);
    });
} else {
    console.log(`🏠 Running in LOCAL MODE - No HTTP server, using polling only`);
}

// Set webhook if deploying to Render
if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    const webhookUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/webhook`;
    console.log(`🔗 Setting webhook to: ${webhookUrl}`);
    
    const webhookData = JSON.stringify({
        url: webhookUrl
    });
    
    const webhookOptions = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': webhookData.length
        }
    };
    
    const webhookReq = https.request(`${botUrl}/setWebhook`, webhookOptions, (res) => {
        let responseData = '';
        res.on('data', (chunk) => {
            responseData += chunk;
        });
        res.on('end', () => {
            console.log('🔗 Webhook response:', responseData);
        });
    });
    
    webhookReq.write(webhookData);
    webhookReq.end();
} else {
    // Use polling for local development
console.log('🤖 Simple Telegram Dishwasher Bot is ready!');
console.log('📱 Bot is now listening for commands...');
console.log('🔍 Search for: @aronov_dishwasher_bot');

// Start polling for updates
getUpdates();
}

// Keep-alive mechanism (every 5 minutes) - Render free tier sleeps after 15 minutes of inactivity
if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    console.log('🔄 Starting aggressive keep-alive mechanism (every 5 minutes)');
    
    // Initial keep-alive after 30 seconds to ensure server is ready
    setTimeout(keepAlive, 30 * 1000);
    
    // Then every 5 minutes (more aggressive)
    setInterval(keepAlive, 5 * 60 * 1000); // 5 minutes
}

// Note: Cleanup timer removed - no time limitations on requests
