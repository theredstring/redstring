#!/usr/bin/env node

/**
 * Simple AI Connection Wizard for Redstring
 * 
 * This wizard detects and monitors the AI connection setup:
 * - Detects Redstring, Bridge, and MCP server status
 * - Provides connection instructions
 * - Monitors real-time status
 */

import { get } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

class SimpleAIConnectionWizard {
  constructor() {
    this.status = {
      redstring: false,
      bridge: false,
      mcpServer: false,
      hasData: false,
      aiClient: null
    };
    this.config = {
      redstringPort: 4000,
      bridgePort: 3001
    };
  }

  async start() {
    console.log('🤖 Simple AI Connection Wizard for Redstring');
    console.log('============================================\n');

    try {
      // Check all services
      await this.checkAllServices();
      
      // Detect AI clients
      await this.detectAIClients();
      
      // Provide instructions
      await this.provideInstructions();
      
      // Start monitoring
      this.startMonitoring();
      
    } catch (error) {
      console.error('❌ Wizard failed:', error.message);
      process.exit(1);
    }
  }

  async checkAllServices() {
    console.log('🔍 Checking service status...\n');
    
    // Check Redstring
    await this.checkService('Redstring', `http://localhost:${this.config.redstringPort}`, 'redstring');
    
    // Check Bridge
    await this.checkService('Bridge', `http://localhost:${this.config.bridgePort}/api/bridge/state`, 'bridge');
    
    // Check MCP Server
    await this.checkMCPServer();
    
    console.log('');
  }

  async checkService(name, url, key) {
    return new Promise((resolve) => {
      get(url, (res) => {
        if (res.statusCode === 200) {
          console.log(`✅ ${name} is running`);
          this.status[key] = true;
          
          // Check for data if it's the bridge
          if (key === 'bridge') {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => {
              try {
                const bridgeData = JSON.parse(data);
                this.status.hasData = bridgeData.graphs?.length > 0;
                if (this.status.hasData) {
                  console.log(`   📊 Found ${bridgeData.graphs.length} graphs and ${bridgeData.nodePrototypes?.length || 0} prototypes`);
                } else if (bridgeData.error) {
                  console.log(`   ⚠️  Bridge running but no data: ${bridgeData.error}`);
                } else {
                  console.log(`   ⚠️  No data available yet`);
                }
              } catch (error) {
                console.log(`   ⚠️  Could not parse bridge data`);
              }
              resolve();
            });
          } else {
            resolve();
          }
        } else {
          console.log(`❌ ${name} is not responding (HTTP ${res.statusCode})`);
          resolve();
        }
      }).on('error', (error) => {
        console.log(`❌ ${name} is not running`);
        resolve();
      });
    });
  }

  async checkMCPServer() {
    // Check if MCP server process is running
    const { exec } = await import('child_process');
    
    return new Promise((resolve) => {
      exec('ps aux | grep "redstring-mcp-server" | grep -v grep', (error, stdout) => {
        if (stdout.trim()) {
          console.log('✅ MCP Server is running');
          this.status.mcpServer = true;
        } else {
          console.log('❌ MCP Server is not running');
        }
        resolve();
      });
    });
  }

  async detectAIClients() {
    console.log('🔍 Detecting AI clients...');
    
    const clients = [];
    
    // Check for Claude Desktop
    const claudeConfigPath = join(process.env.HOME, 'Library/Application Support/Claude/claude_desktop_config.json');
    if (existsSync(claudeConfigPath)) {
      try {
        const config = JSON.parse(readFileSync(claudeConfigPath, 'utf8'));
        if (config.mcpServers?.redstring) {
          clients.push({
            name: 'Claude Desktop',
            type: 'claude',
            status: 'configured'
          });
        } else {
          clients.push({
            name: 'Claude Desktop',
            type: 'claude',
            status: 'not_configured'
          });
        }
      } catch (error) {
        clients.push({
          name: 'Claude Desktop',
          type: 'claude',
          status: 'error'
        });
      }
    }

    // Check for Tome
    const tomeConfigPath = join(process.env.HOME, 'Library/Application Support/Tome');
    if (existsSync(tomeConfigPath)) {
      clients.push({
        name: 'Tome',
        type: 'tome',
        status: 'available'
      });
    }

    this.status.aiClient = clients[0] || null;
    
    if (clients.length > 0) {
      console.log('✅ Detected AI clients:');
      clients.forEach(client => {
        console.log(`   - ${client.name} (${client.status})`);
      });
    } else {
      console.log('⚠️  No AI clients detected');
    }
    console.log('');
  }

  async provideInstructions() {
    console.log('📋 Connection Instructions:');
    console.log('==========================\n');

    if (!this.status.redstring) {
      console.log('❌ Redstring is not running');
      console.log('   Start it with: npm run dev\n');
      return;
    }

    if (!this.status.bridge) {
      console.log('❌ Bridge server is not running');
      console.log('   Start the MCP bridge with: node redstring-mcp-server.js');
      console.log('   (Alternatively, legacy bridge: npm run bridge:start)\n');
      return;
    }

    if (!this.status.mcpServer) {
      console.log('❌ MCP Server is not running');
      console.log('   Start it with: node redstring-mcp-server.js\n');
      return;
    }

    if (!this.status.hasData) {
      console.log('⚠️  Bridge has no data');
      console.log('   Make sure Redstring is loaded with a .redstring file\n');
      return;
    }

    console.log('🎉 All services are running!');
    console.log('');

    if (this.status.aiClient?.type === 'claude' && this.status.aiClient.status === 'configured') {
      console.log('✅ Claude Desktop is configured!');
      console.log('   Just restart Claude Desktop to connect.');
    } else if (this.status.aiClient?.type === 'claude') {
      console.log('🔧 To configure Claude Desktop:');
      console.log('   1. Open Claude Desktop');
      console.log('   2. Go to Settings > Local MCP Servers');
      console.log('   3. Add new server:');
      console.log(`      Command: node`);
      console.log(`      Args: ${process.cwd()}/redstring-mcp-server.js`);
      console.log('   4. Restart Claude Desktop');
    }

    if (this.status.aiClient?.type === 'tome') {
      console.log('🔧 To configure Tome:');
      console.log('   1. Open Tome');
      console.log('   2. Go to Settings > MCP Servers');
      console.log('   3. Add new server:');
      console.log(`      Command: node ${process.cwd()}/redstring-mcp-server.js`);
      console.log('   4. Test the connection');
    }

    console.log('\n🔗 Available MCP Tools:');
    console.log('   - list_available_graphs');
    console.log('   - get_active_graph');
    console.log('   - open_graph');
    console.log('   - set_active_graph');
    console.log('   - add_node_prototype');
    console.log('   - add_node_instance');
  }

  startMonitoring() {
    console.log('\n📊 Starting connection monitor...');
    console.log('   Press Ctrl+C to stop the wizard\n');

    const monitor = setInterval(() => {
      // Check bridge status
      get(`http://localhost:${this.config.bridgePort}/api/bridge/state`, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const bridgeData = JSON.parse(data);
            const hasData = bridgeData.graphs?.length > 0;
            
            // Check Redstring status
            get(`http://localhost:${this.config.redstringPort}`, (redstringRes) => {
              process.stdout.write('\r');
              process.stdout.write(`Status: Bridge ✅ | Redstring ✅ | Data ${hasData ? '✅' : '❌'}`);
            }).on('error', () => {
              process.stdout.write('\r');
              process.stdout.write(`Status: Bridge ✅ | Redstring ❌ | Data ${hasData ? '✅' : '❌'}`);
            });
          } catch (error) {
            process.stdout.write('\r');
            process.stdout.write(`Status: Bridge ✅ | Redstring ❌ | Data ❌`);
          }
        });
      }).on('error', () => {
        // Check Redstring status
        get(`http://localhost:${this.config.redstringPort}`, (redstringRes) => {
          process.stdout.write('\r');
          process.stdout.write(`Status: Bridge ❌ | Redstring ✅ | Data ❌`);
        }).on('error', () => {
          process.stdout.write('\r');
          process.stdout.write(`Status: Bridge ❌ | Redstring ❌ | Data ❌`);
        });
      });
    }, 2000);

    // Handle cleanup on exit
    process.on('SIGINT', () => {
      console.log('\n\n🛑 Shutting down AI Connection Wizard...');
      clearInterval(monitor);
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\n\n🛑 Shutting down AI Connection Wizard...');
      clearInterval(monitor);
      process.exit(0);
    });
  }
}

// Start the wizard
const wizard = new SimpleAIConnectionWizard();
wizard.start().catch(error => {
  console.error('❌ Wizard failed:', error.message);
  process.exit(1);
}); 
