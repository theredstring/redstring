#!/usr/bin/env node
/**
 * Analytics Query Utility
 * Query user analytics data from the command line
 */

import fetch from 'node-fetch';
import readline from 'readline';

const API_BASE = process.env.ANALYTICS_API_URL || 'http://localhost:4000';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function getStats(timeRange = 'all') {
  try {
    const response = await fetch(`${API_BASE}/api/analytics/stats?range=${timeRange}`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching stats:', error.message);
    return null;
  }
}

async function getActiveUsers(minutes = 30) {
  try {
    const response = await fetch(`${API_BASE}/api/analytics/active-users?minutes=${minutes}`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching active users:', error.message);
    return null;
  }
}

async function getUser(userId) {
  try {
    const response = await fetch(`${API_BASE}/api/analytics/user/${userId}`);
    if (response.status === 404) {
      return null;
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching user:', error.message);
    return null;
  }
}

async function getActivity(startTime, endTime, limit = 100) {
  try {
    const url = `${API_BASE}/api/analytics/activity?start=${startTime}&end=${endTime}&limit=${limit}`;
    const response = await fetch(url);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching activity:', error.message);
    return null;
  }
}

function formatTimestamp(ts) {
  return new Date(ts).toISOString();
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  switch (command) {
    case 'stats':
      const timeRange = args[1] || 'all';
      console.log(`\n📊 Analytics Stats (${timeRange})\n`);
      const stats = await getStats(timeRange);
      if (stats) {
        console.log(`Total Users: ${stats.totalUsers}`);
        console.log(`Active Users: ${stats.activeUsers}`);
        console.log(`Active Sessions: ${stats.activeSessions}`);
        console.log(`Total Sessions: ${stats.totalSessions}`);
        console.log(`Total Actions: ${stats.totalActions}`);
        console.log(`Unique Users Today: ${stats.uniqueUsersToday}`);
      }
      break;

    case 'active':
      const minutes = parseInt(args[1] || '30', 10);
      console.log(`\n👥 Active Users (last ${minutes} minutes)\n`);
      const active = await getActiveUsers(minutes);
      if (active) {
        console.log(`Count: ${active.count}\n`);
        if (active.users.length > 0) {
          active.users.forEach((user, i) => {
            console.log(`${i + 1}. ${user.login || user.id}`);
            console.log(`   Last seen: ${formatTimestamp(user.lastSeen)}`);
            console.log(`   Total actions: ${user.totalActions}`);
            console.log(`   Sessions: ${user.sessions}`);
            if (user.isActive) {
              console.log(`   ✅ Active session: ${user.sessionId}`);
            }
            console.log('');
          });
        } else {
          console.log('No active users');
        }
      }
      break;

    case 'user':
      const userId = args[1];
      if (!userId) {
        console.error('Usage: query-analytics.js user <userId>');
        process.exit(1);
      }
      console.log(`\n👤 User Details: ${userId}\n`);
      const user = await getUser(userId);
      if (user) {
        console.log(`ID: ${user.id}`);
        console.log(`Login: ${user.login || 'N/A'}`);
        console.log(`First seen: ${formatTimestamp(user.firstSeen)}`);
        console.log(`Last seen: ${formatTimestamp(user.lastSeen)}`);
        console.log(`Total actions: ${user.totalActions}`);
        console.log(`Sessions: ${user.sessions}`);
        if (user.currentSession) {
          const session = user.currentSession;
          console.log(`\nCurrent Session:`);
          console.log(`  ID: ${session.id}`);
          console.log(`  Started: ${formatTimestamp(session.startedAt)}`);
          console.log(`  Last activity: ${formatTimestamp(session.lastActivity)}`);
          console.log(`  Activity count: ${session.activityCount}`);
          console.log(`  Duration: ${formatDuration(Date.now() - session.startedAt)}`);
        }
      } else {
        console.log('User not found');
      }
      break;

    case 'activity':
      const hours = parseInt(args[1] || '24', 10);
      const limit = parseInt(args[2] || '50', 10);
      const endTime = Date.now();
      const startTime = endTime - (hours * 60 * 60 * 1000);
      
      console.log(`\n📈 Recent Activity (last ${hours} hours, limit ${limit})\n`);
      const activity = await getActivity(startTime, endTime, limit);
      if (activity && activity.activities.length > 0) {
        console.log(`Showing ${activity.count} of ${activity.total} activities\n`);
        activity.activities.forEach((act, i) => {
          console.log(`${i + 1}. [${formatTimestamp(act.ts)}] ${act.action}`);
          if (act.userLogin) {
            console.log(`   User: ${act.userLogin} (${act.userId})`);
          } else if (act.userId) {
            console.log(`   User: ${act.userId}`);
          } else {
            console.log(`   User: anonymous`);
          }
          if (act.path) {
            console.log(`   Path: ${act.path}`);
          }
          if (act.metadata && Object.keys(act.metadata).length > 0) {
            console.log(`   Metadata: ${JSON.stringify(act.metadata)}`);
          }
          console.log('');
        });
      } else {
        console.log('No activity found');
      }
      break;

    case 'help':
    default:
      console.log(`
📊 Redstring Analytics Query Utility

Usage: node scripts/query-analytics.js <command> [options]

Commands:
  stats [range]           Show statistics (range: all|day|week|month)
  active [minutes]        Show active users (default: 30 minutes)
  user <userId>           Show user details
  activity [hours] [limit] Show recent activity (default: 24 hours, 50 limit)
  help                    Show this help message

Examples:
  node scripts/query-analytics.js stats day
  node scripts/query-analytics.js active 60
  node scripts/query-analytics.js user 12345
  node scripts/query-analytics.js activity 48 100

Environment:
  ANALYTICS_API_URL       API base URL (default: http://localhost:4000)
      `);
      break;
  }

  rl.close();
}

main().catch(console.error);




