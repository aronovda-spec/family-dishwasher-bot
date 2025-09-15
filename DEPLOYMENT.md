# Telegram Dishwasher Bot - Render Deployment Guide

This guide will help you deploy your Telegram Dishwasher Bot to Render.com.

## Prerequisites

1. A Render.com account (free tier available)
2. Your Telegram Bot Token from @BotFather
3. Your bot code ready for deployment

## Deployment Steps

### 1. Prepare Your Repository

Make sure your repository contains:
- `simple-telegram-bot.js` (main bot file)
- `package.json` (with proper start script)
- `render.yaml` (Render configuration)

### 2. Deploy to Render

#### Option A: Using render.yaml (Recommended)

1. Push your code to GitHub/GitLab
2. In Render dashboard, click "New +" → "Blueprint"
3. Connect your repository
4. Render will automatically detect the `render.yaml` configuration
5. Click "Apply" to deploy

#### Option B: Manual Configuration

1. In Render dashboard, click "New +" → "Web Service"
2. Connect your repository
3. Configure:
   - **Name**: `dishwasher-bot`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health`

### 3. Set Environment Variables

In your Render service dashboard, go to "Environment" tab and add:

```
TELEGRAM_BOT_TOKEN=your_bot_token_here
```

**Important**: Never commit your bot token to the repository!

### 4. Deploy and Test

1. Click "Deploy" in Render
2. Wait for deployment to complete
3. Check the logs to ensure the bot started successfully
4. Test your bot by sending `/start` to @your_bot_username

## Features for Render Deployment

### ✅ Webhook Support
- Automatically switches to webhook mode when deployed on Render
- Uses `/webhook` endpoint for receiving Telegram updates
- More efficient than polling for production use

### ✅ Keep-Alive Mechanism
- Prevents Render free tier from sleeping
- Sends periodic pings to keep the service active
- Runs every 5 minutes automatically

### ✅ Health Check Endpoint
- Available at `/health` endpoint
- Returns service status and queue information
- Used by Render for health monitoring

### ✅ Environment Variables
- `TELEGRAM_BOT_TOKEN`: Your bot token (required)
- `PORT`: Automatically set by Render
- `RENDER_EXTERNAL_HOSTNAME`: Automatically set by Render

### ✅ Deduplication
- Prevents duplicate message processing
- Handles multiple instances gracefully
- Includes instance tracking

## Local Development

For local development, the bot will:
- Use polling instead of webhooks
- Fall back to hardcoded token if env var not set
- Run on port 3000 by default

## Monitoring

### Health Check
Visit `https://your-app-name.onrender.com/health` to check:
- Service status
- Current queue state
- Instance information

### Logs
Monitor your bot's activity through Render's log viewer:
- Real-time logs
- Error tracking
- Performance metrics

## Troubleshooting

### Common Issues

1. **Bot not responding**
   - Check if `TELEGRAM_BOT_TOKEN` is set correctly
   - Verify webhook is set properly in logs
   - Check Render service status

2. **Service sleeping**
   - Ensure keep-alive mechanism is working
   - Check if `/health` endpoint is accessible
   - Consider upgrading to paid plan for always-on service

3. **Webhook errors**
   - Verify `RENDER_EXTERNAL_HOSTNAME` is set
   - Check webhook URL in Telegram logs
   - Ensure HTTPS is working properly

### Debug Commands

Check your bot's status:
```bash
curl https://your-app-name.onrender.com/health
```

## Security Notes

- Never commit your bot token to version control
- Use Render's environment variables for secrets
- The bot token is automatically excluded from logs
- Webhook endpoint is protected by Telegram's verification

## Cost

- **Free Tier**: 750 hours/month
- **Paid Plans**: Starting at $7/month for always-on service
- **Recommendation**: Start with free tier, upgrade if needed

## Support

If you encounter issues:
1. Check Render's documentation
2. Review bot logs in Render dashboard
3. Test locally first to isolate issues
4. Verify Telegram bot configuration with @BotFather
