/**
 * Claude Desktop API Integration
 * Handles communication with Claude Desktop's local API
 */

class ClaudeDesktopAPI {
  constructor() {
    this.baseURL = 'http://localhost:3000'; // Claude Desktop's default API endpoint
    this.isConnected = false;
    this.sessionId = null;
  }

  /**
   * Test connection to Claude Desktop
   */
  async testConnection() {
    try {
      const response = await fetch(`${this.baseURL}/api/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        this.isConnected = true;
        return { success: true, message: 'Connected to Claude Desktop' };
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      this.isConnected = false;
      return { 
        success: false, 
        message: `Failed to connect to Claude Desktop: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Start a new conversation with Claude
   */
  async startConversation() {
    try {
      const response = await fetch(`${this.baseURL}/api/conversation/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Redstring AI Collaboration'
        }),
      });

      if (response.ok) {
        const data = await response.json();
        this.sessionId = data.sessionId;
        return { 
          success: true, 
          sessionId: this.sessionId,
          message: 'Conversation started with Claude Desktop'
        };
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      return { 
        success: false, 
        message: `Failed to start conversation: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Send a message to Claude
   */
  async sendMessage(message, context = null) {
    if (!this.sessionId) {
      const conversation = await this.startConversation();
      if (!conversation.success) {
        return conversation;
      }
    }

    try {
      // Prepare the message with context
      let fullMessage = message;
      if (context) {
        fullMessage = `Context: ${JSON.stringify(context, null, 2)}\n\nUser Message: ${message}`;
      }

      const response = await fetch(`${this.baseURL}/api/conversation/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: fullMessage,
          context: context
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          success: true,
          response: data.content,
          messageId: data.message_id,
          timestamp: new Date().toISOString()
        };
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to send message: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Send a structured operation to Claude with graph context
   */
  async executeOperation(operation, parameters) {
    try {
      const response = await fetch(`${this.baseURL}/api/operation/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operation,
          parameters
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error('[Claude Desktop API] Operation execution failed:', error);
      throw error;
    }
  }

  /**
   * Get conversation history
   */
  async getConversationHistory() {
    if (!this.sessionId) {
      return { success: false, message: 'No active conversation' };
    }

    try {
      const response = await fetch(`${this.baseURL}/api/conversation/history`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        return {
          success: true,
          messages: data.messages || []
        };
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to get conversation history: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Close the current conversation
   */
  async closeConversation() {
    if (!this.sessionId) {
      return { success: true, message: 'No active conversation to close' };
    }

    try {
      const response = await fetch(`${this.baseURL}/api/conversation/close`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        this.sessionId = null;
        return { success: true, message: 'Conversation closed' };
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to close conversation: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Get connection status
   */
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      sessionId: this.sessionId,
      baseURL: this.baseURL
    };
  }
}

// Create and export a singleton instance
const claudeDesktopAPI = new ClaudeDesktopAPI();
export default claudeDesktopAPI; 