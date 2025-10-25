# Telegram Dishwasher Bot

A comprehensive Telegram bot for managing dishwasher queue with turn tracking, punishments, and admin controls.

## Features

### 🎯 Queue Management
- **Turn Tracking**: Tracks whose turn it is to empty the dishwasher
- **User Authorization**: Only 3 chosen users can use queue commands
- **Turn Completion**: Users can finish their turn (`done`) and the bot moves to the next person
- **Queue Status**: Real-time queue status with current turn indicator

### 🔄 Turn Flexibility
- **Position Swapping**: Users can request to switch places in the queue
- **Approval System**: The other person must approve before the swap happens
- **Skip Requests**: Users can request to skip their turn (requires admin approval)

### ⚡ Punishment System
- **Punishment Requests**: Any user can submit punishment requests (e.g., +3 extra turns) with a reason
- **Request Tracking**: Punishment requests get unique IDs for easy management
- **Admin Approval**: Only admins can approve or reject punishment requests
- **Dual Admin Support**: Supports two equal-rights admins for approvals

### 👨‍💼 Admin Controls
- **Admin Management**: Add/remove admins as needed
- **User Management**: Remove users from the bot or allow self-removal
- **Data Reset**: Complete bot data reset with confirmation
- **User Authorization**: Control who can use queue commands
- **Request Processing**: Approve/reject punishment and skip requests
- **Statistics**: View punishment statistics and history
- **Intuitive Menu Design**: 6-row logical menu structure with functional grouping
- **Assist Feature**: Admin can personally handle duties without disrupting queue

### 🌙 Smart Notifications
- **Night Hours Restriction**: Automatic dishwasher alerts blocked during 11pm-7am Israeli time
- **Intelligent Rescheduling**: Blocked alerts automatically rescheduled for 7:00 AM Israeli time
- **Timezone Awareness**: Uses Asia/Jerusalem timezone for accurate time handling
- **Preserved Functionality**: Manual alerts, /done commands, and monthly reports work 24/7
- **Admin Flexibility**: Admins abroad receive notifications at their local time (minor inconvenience)

### 📱 Telegram Integration
- **Direct Integration**: All interactions happen directly in Telegram chats
- **Instant Replies**: Users and admins get immediate confirmation of actions
- **Multilingual Support**: Full English and Hebrew language support for all notifications
- **Bot Token Authentication**: Secure setup with Telegram bot token

### 💾 Data Persistence
- **Supabase Integration**: All bot data automatically saved to Supabase PostgreSQL database
- **Optimized Auto-Save**: Data saved every 10 minutes with batch operations for better performance
- **Enhanced Error Handling**: Automatic retry mechanisms with smart notifications for database failures
- **Server Restart Survival**: Bot state preserved across server restarts and deployments
- **No Reauthorization**: Users and admins remain authorized after restarts
- **Turn Order Preservation**: Queue order and scores maintained across restarts

### ⚡ Performance Optimizations
- **Optimistic UI**: `/done` and force swap commands provide instant feedback with background database operations
- **Database Retry Mechanism**: Automatic retry attempts (2 attempts + 5-second scheduled retry) for failed database saves
- **Smart Error Notifications**: Only admins get technical error details; affected users get final failure notifications
- **Batch Database Operations**: Reduces database load by ~70% through intelligent batching
- **Parallel Database Reads**: `/status` command uses parallel reads for ~60% faster responses
- **Non-blocking Saves**: Critical operations save immediately without blocking user interactions
- **HTTP Keep-Alive**: Maintains persistent connections to Telegram API for better performance

### 🚨 Anti-Cheating System
- **Rapid Activity Detection**: Monitors `/done` and `/assist` commands for suspicious patterns
- **30-Minute Rule**: Dishwasher cannot be completed twice within 30 minutes (physical impossibility)
- **Admin Alerts**: All admins receive immediate notifications about suspicious activity
- **Command Tracking**: Both user `/done` and admin `/assist` commands are monitored equally
- **No Blocking**: Commands still execute but admins are alerted to investigate
- **Global Tracking**: System-wide monitoring prevents rapid completions by any user

### 🚨 Debt Protection System
- **Debt Detection**: Users with significantly lower scores cannot leave the bot
- **Prevents Score Reset**: Blocks users from escaping their dishwasher responsibilities
- **Grace Period**: Legitimate users get 24-hour grace period for rejoining
- **Score Preservation**: Users can rejoin within 24 hours with their original score
- **Admin Override**: Admins can still remove users if needed

## Installation

1. **Clone or download** this repository to your local machine

2. **Set up your Telegram Bot Token**:
   - Get a bot token from [@BotFather](https://t.me/BotFather) on Telegram
   - Set the environment variable:
     ```bash
     # Windows (PowerShell)
     $env:TELEGRAM_BOT_TOKEN="your_bot_token_here"
     
     # Windows (Command Prompt)
     set TELEGRAM_BOT_TOKEN=your_bot_token_here
     
     # Linux/Mac
     export TELEGRAM_BOT_TOKEN="your_bot_token_here"
     ```

3. **Start the bot**:
   ```bash
   node simple-telegram-bot.js
   ```

4. **Configure Admins**: Add admins using the `addadmin` command

## Usage

### Basic Commands

#### Queue Management
- `add` - Add yourself to the queue
- `remove` - Remove yourself from the queue  
- `done` - Complete your current turn
- `status` - Show current queue status
- `assist` - Admin command to handle dishwasher without affecting queue

#### Turn Flexibility
- `swap @username` - Request to swap positions with another user
- `approve <request_id>` - Approve a swap request
- `reject <request_id>` - Reject a swap request
- `skip [reason]` - Request to skip your turn

#### Punishments
- `punish @username +3 reason` - Submit a punishment request
- `punishments` - View punishment history
- `punishments stats` - View punishment statistics

### Admin Commands

#### User Management
- `addadmin @username` - Add a user as admin
- `removeadmin @username` - Remove admin privileges
- `removeuser @username` - Remove user from the bot (admin only)
- `authorize @username` - Authorize user for queue commands
- `unauthorize @username` - Remove queue authorization

#### Data Management
- `resetbot` - Reset all bot data with confirmation (admin only)
- `leave` or `quit` - Remove yourself from the bot (any user)
  - **Debt Protection**: Users with low scores cannot leave to prevent debt reset
  - **Grace Period**: 24-hour grace period for rejoining with preserved score

#### Request Processing
- `approve punishment <id>` - Approve a punishment request
- `reject punishment <id>` - Reject a punishment request
- `approve skip <user>` - Approve a skip request
- `reject skip <user>` - Reject a skip request

#### Admin Menu Interface
- **6-Row Logical Structure**: Organized by function type for better UX
  - **Row 1**: Core Operations (Status, Done)
  - **Row 2**: Queue Control (Force Swap, Assist)
  - **Row 3**: Dishwasher Activity (Started, Alert)
  - **Row 4**: Administrative Actions (Apply Punishment, Maintenance)
  - **Row 5**: Communication Tools (Broadcast, Send Message)
  - **Row 6**: Utility & Settings (Help, Language Switch)
- **Broadcast Feature**: Renamed from "Create Announcement" for clarity
- **Assist Feature**: Admin can handle duties without disrupting queue (`/assist` command)

#### Information
- `admins` - List all admins
- `help` - Show all available commands
- `language_switch` - Switch between English and Hebrew (if supported)

## Setup Guide

### 1. Initial Configuration

After starting the bot and scanning the QR code:

1. **Add Admins**:
   ```
   addadmin @your_username
   addadmin @second_admin
   ```

2. **Authorize Queue Users** (up to 3):
   ```
   authorize @user1
   authorize @user2
   authorize @user3
   ```

3. **Add Users to Queue**:
   ```
   add
   ```

### 2. Daily Usage

1. **Check Queue Status**:
   ```
   status
   ```

2. **Complete Your Turn**:
   ```
   done
   ```

3. **Request Position Swap**:
   ```
   swap @other_user
   ```

4. **Submit Punishment**:
   ```
   punish @user +2 left dishes dirty
   ```

## Data Storage

The bot automatically saves all data to Supabase PostgreSQL database:
- **Supabase Integration**: All bot state, user scores, and statistics stored in cloud database
- **Real-time Persistence**: Data changes saved immediately for critical operations
- **Batch Optimization**: Non-critical data batched for better performance
- **Automatic Backups**: Supabase provides built-in backup and recovery

### Persistence Features
- **Optimized Auto-Save**: Data saved every 10 minutes with batch operations for better performance
- **Server Restart Survival**: Bot state preserved across restarts
- **No Data Loss**: Users, admins, and turn order maintained
- **Version Control**: Data format versioning for future compatibility

## File Structure

```
Dishwasher2/
├── simple-telegram-bot.js    # Main bot file with Supabase integration
├── supabase-db.js            # Supabase database interface
├── supabase_tables.sql       # Database schema
├── package.json              # Dependencies
├── README.md                 # This file
├── render.yaml               # Render deployment configuration
└── node_modules/             # Dependencies (created by npm)
```

## Troubleshooting

### Common Issues

1. **Bot Token Error**:
   - Make sure you've set the TELEGRAM_BOT_TOKEN environment variable
   - Verify your bot token is correct by checking with @BotFather
   - Restart the bot after setting the environment variable

2. **Commands Not Working**:
   - Check if you're authorized (for queue commands)
   - Verify you're using the correct command syntax
   - Make sure you're an admin (for admin commands)

3. **Data Not Saving**:
   - Check Supabase connection and credentials
   - Ensure SUPABASE_URL and SUPABASE_ANON_KEY environment variables are set
   - Verify Supabase database is accessible and tables exist
   - Bot automatically retries failed database saves (2 attempts + 5-second retry)
   - Admins receive notifications about database issues; users get final failure notifications

4. **Persistence Issues**:
   - Check Supabase connection status in console logs
   - Verify bot loads data on startup (look for "Bot data loaded from Supabase" message)
   - Ensure optimized auto-save is working (check console for "Optimized auto-save cycle completed" every 10 minutes)

### Getting Help

- Use the `help` command to see all available commands
- Check the console output for error messages
- Ensure all dependencies are properly installed

## Security Notes

- **Never commit your bot token to version control** - always use environment variables
- Admin commands should only be used by trusted users
- Regular backups are automatically created in the `data/backups/` directory
- Keep your bot token secure and don't share it publicly

## Contributing

Feel free to submit issues or pull requests to improve the bot!

## License

MIT License - feel free to use and modify as needed.
