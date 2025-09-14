# Quick Setup Guide

## Prerequisites
- Node.js (version 14 or higher)
- WhatsApp account
- Windows/Mac/Linux computer

## Installation Steps

### 1. Download and Install
1. Download or clone this repository
2. Open terminal/command prompt in the project folder
3. Run: `npm install`

### 2. Start the Bot
**Windows:**
- Double-click `start.bat` OR
- Run: `npm start`

**Mac/Linux:**
- Run: `./start.sh` OR
- Run: `npm start`

### 3. Connect WhatsApp
1. The bot will display a QR code in the terminal
2. Open WhatsApp on your phone
3. Go to Settings > Linked Devices > Link a Device
4. Scan the QR code with your phone

### 4. Initial Configuration
Once connected, send these commands in your WhatsApp chat:

```
# Add yourself as admin
addadmin @your_username

# Add other admin (optional)
addadmin @second_admin

# Authorize up to 3 users for queue commands
authorize @user1
authorize @user2
authorize @user3

# Add users to queue
add
```

## First Time Usage

1. **Check Status**: `status`
2. **Complete Turn**: `done`
3. **Request Swap**: `swap @other_user`
4. **Submit Punishment**: `punish @user +2 reason`

## Troubleshooting

### Bot Won't Start
- Make sure Node.js is installed: `node --version`
- Check if port is available
- Try: `npm install` again

### QR Code Issues
- Make sure WhatsApp is updated
- Try refreshing the QR code (restart bot)
- Check internet connection

### Commands Not Working
- Make sure you're authorized (for queue commands)
- Check if you're admin (for admin commands)
- Verify command syntax

### Data Issues
- Check if `data/` folder exists
- Ensure write permissions
- Restart bot if needed

## Need Help?
- Use `help` command for all available commands
- Check console output for error messages
- Read the full README.md for detailed documentation
