# 🚀 Multi-Process Dishwasher Bot Architecture

## 📋 Overview

This bot now uses a **multi-process architecture** similar to the working bot, designed to prevent Render free tier sleep issues and improve reliability.

## 🏗️ Architecture Components

### 1. **Health Server** (`health_server.js`)
- **Purpose**: Dedicated health check endpoint
- **Port**: 8000 (configurable via `HEALTH_PORT` env var)
- **Endpoints**: 
  - `/health` - Main health check (used by Render)
  - `/status` - Extended status information
- **Features**: 
  - Runs independently of main bot
  - Always responds even if bot has issues
  - Memory usage reporting
  - Graceful shutdown handling

### 2. **Keep-Alive Process** (`keep_alive.js`)
- **Purpose**: Prevents Render from sleeping
- **Frequency**: Every 5 minutes
- **Features**:
  - Self-pings health endpoint
  - Automatic retry on failure
  - Resilient error handling
  - Response time monitoring

### 3. **Main Bot** (`simple-telegram-bot.js`)
- **Purpose**: Core bot functionality
- **Features**:
  - Webhook endpoint for Telegram
  - Optimized timer management
  - Reduced resource competition
  - Cleaner error handling

### 4. **Startup Orchestrator** (`start_render.js`)
- **Purpose**: Manages all processes
- **Features**:
  - Process monitoring and restart
  - Graceful shutdown handling
  - Health monitoring
  - Error isolation

## 🔧 Configuration

### Environment Variables
```bash
TELEGRAM_BOT_TOKEN=your_bot_token_here
RENDER_EXTERNAL_HOSTNAME=your-app.onrender.com
HEALTH_PORT=8000
```

### Package.json Scripts
```json
{
  "start": "node start_render.js",      // Production (multi-process)
  "dev": "node simple-telegram-bot.js", // Development (single process)
  "health": "node health_server.js",   // Health server only
  "keepalive": "node keep_alive.js"     // Keep-alive only
}
```

## 🚀 Deployment

### Render Configuration (`render.yaml`)
```yaml
services:
  - type: web
    name: dishwasher-bot
    env: node
    plan: free
    buildCommand: npm install
    startCommand: npm start
    healthCheckPath: /health
    envVars:
      - key: TELEGRAM_BOT_TOKEN
        sync: false
      - key: RENDER_EXTERNAL_HOSTNAME
        fromService:
          type: web
          name: dishwasher-bot
          property: host
      - key: HEALTH_PORT
        value: "8000"
```

## 🧪 Testing

### Test Individual Components
```bash
# Test health server
node health_server.js

# Test keep-alive (requires RENDER_EXTERNAL_HOSTNAME)
node keep_alive.js

# Test main bot (development mode)
node simple-telegram-bot.js

# Test full architecture
node test_architecture.js
```

### Test Health Endpoint
```bash
curl http://localhost:8000/health
curl http://localhost:8000/status
```

## 🔄 Process Flow

1. **Startup**: `start_render.js` launches all processes
2. **Health Server**: Responds to `/health` requests
3. **Keep-Alive**: Pings health endpoint every 5 minutes
4. **Main Bot**: Handles Telegram webhooks
5. **Monitoring**: Orchestrator monitors process health
6. **Restart**: Failed processes are automatically restarted

## 🛡️ Error Handling

- **Process Isolation**: Bot crashes don't affect health server
- **Automatic Restart**: Failed processes restart automatically
- **Graceful Shutdown**: All processes shut down cleanly
- **Error Logging**: Comprehensive error tracking

## 📊 Benefits

### ✅ **Reliability**
- Health server runs independently
- Process isolation prevents cascading failures
- Automatic process restart

### ✅ **Performance**
- Reduced timer competition
- Optimized resource usage
- Better memory management

### ✅ **Monitoring**
- Process health monitoring
- Memory usage tracking
- Response time measurement

### ✅ **Render Compatibility**
- Dedicated health endpoint
- Proper webhook handling
- Sleep prevention mechanism

## 🔧 Troubleshooting

### Health Server Issues
```bash
# Check if health server is running
curl http://localhost:8000/health

# Check logs
node health_server.js
```

### Keep-Alive Issues
```bash
# Test keep-alive manually
node keep_alive.js

# Check environment variables
echo $RENDER_EXTERNAL_HOSTNAME
```

### Process Management
```bash
# Start full architecture
npm start

# Check process status
ps aux | grep node
```

## 📈 Monitoring

### Health Check Response
```json
{
  "status": "healthy",
  "timestamp": "2025-10-14T14:58:46.265Z",
  "instance": "health-1760453924417-1kgjj11iz",
  "service": "dishwasher-bot-health",
  "uptime": 2.0502895,
  "memory": {
    "rss": "29MB",
    "heapTotal": "6MB",
    "heapUsed": "5MB"
  }
}
```

### Process Monitoring
- Health server PID tracking
- Memory usage monitoring
- Response time measurement
- Error rate tracking

## 🎯 Next Steps

1. **Deploy to Render** with new architecture
2. **Monitor logs** for any issues
3. **Set up external monitoring** (UptimeRobot recommended)
4. **Consider upgrading** to Render Starter plan for 24/7 uptime

---

**This architecture should significantly improve reliability and prevent the sleep issues you were experiencing!** 🚀
