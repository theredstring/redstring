/**
 * User Analytics Service
 * Tracks unique users, sessions, and user activity
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import eventLog from './EventLog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function hourKey(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  return `${y}-${m}-${day}-${hour}`;
}

class UserAnalytics {
  constructor(dataDir = path.resolve(__dirname, '../../data/analytics')) {
    this.dataDir = dataDir;
    ensureDir(this.dataDir);
    this.usersFile = path.join(this.dataDir, 'users.json');
    this.sessionsFile = path.join(this.dataDir, 'sessions.json');
    this.activityDir = path.join(this.dataDir, 'activity');
    ensureDir(this.activityDir);
    
    // In-memory cache for quick lookups
    this.users = this.loadUsers();
    this.sessions = this.loadSessions();
    
    // Session timeout: 30 minutes of inactivity
    this.SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  }

  loadUsers() {
    try {
      if (fs.existsSync(this.usersFile)) {
        const data = fs.readFileSync(this.usersFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.warn('[UserAnalytics] Failed to load users:', error.message);
    }
    return {};
  }

  saveUsers() {
    try {
      fs.writeFileSync(this.usersFile, JSON.stringify(this.users, null, 2));
    } catch (error) {
      console.warn('[UserAnalytics] Failed to save users:', error.message);
    }
  }

  loadSessions() {
    try {
      if (fs.existsSync(this.sessionsFile)) {
        const data = fs.readFileSync(this.sessionsFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.warn('[UserAnalytics] Failed to load sessions:', error.message);
    }
    return {};
  }

  saveSessions() {
    try {
      fs.writeFileSync(this.sessionsFile, JSON.stringify(this.sessions, null, 2));
    } catch (error) {
      console.warn('[UserAnalytics] Failed to save sessions:', error.message);
    }
  }

  /**
   * Track a user activity
   * @param {Object} params
   * @param {string} params.userId - GitHub user ID
   * @param {string} params.userLogin - GitHub username
   * @param {string} params.action - Action type (e.g., 'page_view', 'api_call', 'oauth_login')
   * @param {Object} params.metadata - Additional metadata
   * @param {string} params.ip - IP address
   * @param {string} params.userAgent - User agent string
   * @param {string} params.path - Request path
   */
  trackActivity({ userId, userLogin, action, metadata = {}, ip, userAgent, path }) {
    const now = Date.now();
    const activity = {
      id: `${now}-${Math.random().toString(36).slice(2, 10)}`,
      ts: now,
      userId: userId || 'anonymous',
      userLogin: userLogin || null,
      action,
      metadata,
      ip: ip || null,
      userAgent: userAgent || null,
      path: path || null
    };

    // Update user record
    if (userId) {
      if (!this.users[userId]) {
        this.users[userId] = {
          id: userId,
          login: userLogin || null,
          firstSeen: now,
          lastSeen: now,
          totalActions: 0,
          sessions: 0
        };
      } else {
        this.users[userId].lastSeen = now;
        if (userLogin && !this.users[userId].login) {
          this.users[userId].login = userLogin;
        }
      }
      this.users[userId].totalActions = (this.users[userId].totalActions || 0) + 1;
    }

    // Track session
    const sessionId = this.getOrCreateSession(userId, userLogin, ip, userAgent);
    if (sessionId) {
      activity.sessionId = sessionId;
    }

    // Write to activity log (hourly files)
    const activityFile = path.join(this.activityDir, `${hourKey(now)}.jsonl`);
    try {
      fs.appendFileSync(activityFile, JSON.stringify(activity) + '\n');
    } catch (error) {
      console.warn('[UserAnalytics] Failed to write activity:', error.message);
    }

    // Also log to event log
    try {
      eventLog.append({
        type: 'user_activity',
        userId: userId || 'anonymous',
        userLogin: userLogin || null,
        action,
        sessionId: sessionId || null,
        ...metadata
      });
    } catch (error) {
      // Event log might not be available in all contexts
    }

    // Periodic save (every 10 activities or every 5 minutes)
    if (this.users[userId] && this.users[userId].totalActions % 10 === 0) {
      this.saveUsers();
      this.saveSessions();
    }

    return activity;
  }

  /**
   * Get or create a session for a user
   */
  getOrCreateSession(userId, userLogin, ip, userAgent) {
    if (!userId) return null;

    const now = Date.now();
    const sessionKey = userId;

    // Check if existing session is still active
    if (this.sessions[sessionKey]) {
      const session = this.sessions[sessionKey];
      const timeSinceLastActivity = now - session.lastActivity;

      if (timeSinceLastActivity < this.SESSION_TIMEOUT_MS) {
        // Session is still active
        session.lastActivity = now;
        session.activityCount = (session.activityCount || 0) + 1;
        return session.id;
      } else {
        // Session expired, create new one
        session.endedAt = session.lastActivity;
      }
    }

    // Create new session
    const sessionId = `session-${now}-${Math.random().toString(36).slice(2, 10)}`;
    this.sessions[sessionKey] = {
      id: sessionId,
      userId,
      userLogin,
      startedAt: now,
      lastActivity: now,
      activityCount: 1,
      ip: ip || null,
      userAgent: userAgent || null,
      endedAt: null
    };

    // Update user session count
    if (this.users[userId]) {
      this.users[userId].sessions = (this.users[userId].sessions || 0) + 1;
    }

    return sessionId;
  }

  /**
   * Get active users (users with activity in the last N minutes)
   */
  getActiveUsers(minutes = 30) {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    const active = [];

    for (const [userId, user] of Object.entries(this.users)) {
      if (user.lastSeen >= cutoff) {
        // Check if they have an active session
        const session = this.sessions[userId];
        const isActive = session && 
                        session.lastActivity >= cutoff && 
                        !session.endedAt;
        
        active.push({
          ...user,
          isActive,
          sessionId: isActive ? session.id : null,
          lastActivity: session ? session.lastActivity : user.lastSeen
        });
      }
    }

    return active.sort((a, b) => b.lastSeen - a.lastSeen);
  }

  /**
   * Get user statistics
   */
  getStats(timeRange = 'all') {
    const now = Date.now();
    let cutoff = 0;

    if (timeRange === 'day') {
      cutoff = now - (24 * 60 * 60 * 1000);
    } else if (timeRange === 'week') {
      cutoff = now - (7 * 24 * 60 * 60 * 1000);
    } else if (timeRange === 'month') {
      cutoff = now - (30 * 24 * 60 * 60 * 1000);
    }

    const usersInRange = Object.values(this.users).filter(
      u => u.lastSeen >= cutoff
    );

    const activeSessions = Object.values(this.sessions).filter(
      s => s.lastActivity >= cutoff && !s.endedAt
    );

    const totalActions = usersInRange.reduce(
      (sum, u) => sum + (u.totalActions || 0), 0
    );

    return {
      timeRange,
      totalUsers: Object.keys(this.users).length,
      activeUsers: usersInRange.length,
      activeSessions: activeSessions.length,
      totalSessions: Object.values(this.sessions).filter(s => s.startedAt >= cutoff).length,
      totalActions,
      uniqueUsersToday: Object.values(this.users).filter(
        u => u.lastSeen >= (now - 24 * 60 * 60 * 1000)
      ).length
    };
  }

  /**
   * Get activity for a time range
   */
  getActivity(startTime, endTime = Date.now()) {
    const activities = [];
    const startDay = dayKey(startTime);
    const endDay = dayKey(endTime);

    // Get all activity files in range
    const files = fs.readdirSync(this.activityDir)
      .filter(f => f.endsWith('.jsonl'))
      .filter(f => {
        const fileDay = f.replace('.jsonl', '').substring(0, 10);
        return fileDay >= startDay && fileDay <= endDay;
      })
      .sort();

    for (const file of files) {
      const filePath = path.join(this.activityDir, file);
      try {
        const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const activity = JSON.parse(line);
            if (activity.ts >= startTime && activity.ts <= endTime) {
              activities.push(activity);
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      } catch (error) {
        console.warn(`[UserAnalytics] Failed to read ${file}:`, error.message);
      }
    }

    return activities.sort((a, b) => a.ts - b.ts);
  }

  /**
   * Clean up old sessions and save data
   */
  cleanup() {
    const now = Date.now();
    const expiredCutoff = now - (7 * 24 * 60 * 60 * 1000); // 7 days

    // Mark expired sessions as ended
    for (const [key, session] of Object.entries(this.sessions)) {
      if (!session.endedAt && 
          (now - session.lastActivity) > this.SESSION_TIMEOUT_MS) {
        session.endedAt = session.lastActivity;
      }
    }

    this.saveUsers();
    this.saveSessions();
  }

  /**
   * Get user details
   */
  getUser(userId) {
    const user = this.users[userId];
    if (!user) return null;

    const session = this.sessions[userId];
    return {
      ...user,
      currentSession: session && !session.endedAt ? session : null
    };
  }
}

// Singleton instance
const userAnalytics = new UserAnalytics();

// Periodic cleanup (every hour)
setInterval(() => {
  userAnalytics.cleanup();
}, 60 * 60 * 1000);

export default userAnalytics;




