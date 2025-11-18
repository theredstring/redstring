# User Analytics System

A comprehensive user tracking and analytics system for Redstring that tracks unique users, sessions, and user activity.

## Features

- **Unique User Tracking**: Tracks users by GitHub user ID
- **Session Management**: Automatically tracks user sessions with 30-minute timeout
- **Activity Logging**: Tracks HTTP requests, OAuth logins, and custom events
- **Real-time Analytics**: Query active users, statistics, and activity data
- **Client-side Tracking**: Track custom events from the browser
- **Persistent Storage**: Data stored in JSON files with hourly activity logs

## Architecture

### Components

1. **UserAnalytics Service** (`src/services/UserAnalytics.js`)
   - Core analytics engine
   - Manages users, sessions, and activity logs
   - Stores data in `data/analytics/`

2. **Server Middleware** (`deployment/app-semantic-server.js`)
   - Automatically tracks HTTP requests
   - Provides analytics API endpoints

3. **OAuth Integration** (`oauth-server.js`)
   - Tracks OAuth logins
   - Associates users with GitHub accounts

4. **Client-side Tracking** (`src/services/userTracking.js`)
   - Browser-based event tracking
   - Automatic page view tracking
   - Custom event support

## Data Storage

Analytics data is stored in:
- `data/analytics/users.json` - User records
- `data/analytics/sessions.json` - Session records
- `data/analytics/activity/YYYY-MM-DD-HH.jsonl` - Hourly activity logs

## API Endpoints

### Get Statistics
```bash
GET /api/analytics/stats?range=all|day|week|month
```

Returns:
```json
{
  "timeRange": "all",
  "totalUsers": 42,
  "activeUsers": 5,
  "activeSessions": 3,
  "totalSessions": 120,
  "totalActions": 15420,
  "uniqueUsersToday": 8
}
```

### Get Active Users
```bash
GET /api/analytics/active-users?minutes=30
```

Returns:
```json
{
  "count": 3,
  "minutes": 30,
  "users": [
    {
      "id": "12345",
      "login": "username",
      "lastSeen": 1699123456789,
      "totalActions": 42,
      "sessions": 5,
      "isActive": true,
      "sessionId": "session-...",
      "lastActivity": 1699123456789
    }
  ]
}
```

### Get User Details
```bash
GET /api/analytics/user/:userId
```

### Get Activity
```bash
GET /api/analytics/activity?start=1699123456789&end=1699209856789&limit=100
```

### Track Client Event
```bash
POST /api/analytics/track
Content-Type: application/json

{
  "action": "node_created",
  "metadata": { "nodeType": "note" },
  "userId": "12345",
  "userLogin": "username",
  "path": "/graph/abc123",
  "url": "https://redstring.io/graph/abc123"
}
```

## Command Line Query Tool

Use the `query-analytics.js` script to query analytics from the command line:

```bash
# Show statistics
node scripts/query-analytics.js stats day

# Show active users (last 30 minutes)
node scripts/query-analytics.js active 30

# Show user details
node scripts/query-analytics.js user 12345

# Show recent activity (last 24 hours, limit 50)
node scripts/query-analytics.js activity 24 50
```

### Environment Variables

```bash
# Set API base URL (default: http://localhost:4000)
export ANALYTICS_API_URL=https://redstring.io
```

## Client-side Usage

### Basic Usage

```javascript
import userTracking from './services/userTracking.js';

// Track custom event
userTracking.track('node_created', {
  nodeType: 'note',
  nodeId: 'abc123'
});

// Track page view (automatic)
// Already handled by the service

// Update user info after OAuth login
userTracking.updateUser(userId, userLogin);
```

### Tracking Custom Events

```javascript
// Track graph save
userTracking.track('graph_saved', {
  graphId: 'graph-123',
  nodeCount: 42,
  edgeCount: 38
});

// Track AI interaction
userTracking.track('ai_query', {
  queryLength: 120,
  responseTime: 1500
});

// Track feature usage
userTracking.track('feature_used', {
  feature: 'semantic_search',
  resultCount: 5
});
```

## Server-side Tracking

The server automatically tracks:
- All HTTP requests (method, path, status code)
- OAuth logins (user ID, login, provider)
- Response times and sizes

### Manual Tracking

```javascript
import userAnalytics from './src/services/UserAnalytics.js';

userAnalytics.trackActivity({
  userId: '12345',
  userLogin: 'username',
  action: 'custom_action',
  metadata: { key: 'value' },
  ip: req.ip,
  userAgent: req.headers['user-agent'],
  path: req.path
});
```

## Session Management

Sessions are automatically managed:
- **Session Timeout**: 30 minutes of inactivity
- **Session Creation**: Automatic on first activity
- **Session Tracking**: Tracks start time, last activity, activity count

## Privacy & Data

- User data is stored locally on the server
- IP addresses are tracked for session management
- User agents are logged for analytics
- All data is stored in JSON files (not in a database)
- Data can be exported or deleted as needed

## Monitoring Active Users

### Real-time Active Users

```bash
# Check active users every minute
watch -n 60 'node scripts/query-analytics.js active 30'
```

### Daily Statistics

```bash
# Get daily stats
node scripts/query-analytics.js stats day
```

### User Activity Timeline

```bash
# Get last 48 hours of activity
node scripts/query-analytics.js activity 48 200
```

## Integration with Cloud Run

When deployed to Cloud Run, analytics data is stored in the container's filesystem. For persistent storage across deployments, consider:

1. **Cloud Storage**: Mount a GCS bucket for analytics data
2. **Cloud Firestore**: Migrate to Firestore for scalable storage
3. **BigQuery**: Export analytics data to BigQuery for advanced analysis

## Troubleshooting

### Analytics not tracking

1. Check that `UserAnalytics.js` is imported correctly
2. Verify `data/analytics/` directory is writable
3. Check server logs for analytics errors

### No active users showing

1. Verify users are actually active (check logs)
2. Adjust the time window (try `active 60` for 60 minutes)
3. Check session timeout settings

### Performance concerns

- Activity logs are written asynchronously
- User/session data is cached in memory
- Periodic cleanup runs every hour
- Large activity logs are split by hour

## Future Enhancements

- [ ] Dashboard UI for analytics
- [ ] Export to BigQuery
- [ ] Real-time WebSocket updates
- [ ] User retention metrics
- [ ] Feature usage analytics
- [ ] Geographic analytics (from IP)




