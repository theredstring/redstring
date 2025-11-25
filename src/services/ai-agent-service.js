/**
 * AI Agent Service
 * Handles AI agent endpoints (/api/ai/agent, /api/ai/chat, etc.)
 * 
 * NOTE: This is a temporary bridge that will be fully migrated from bridge-daemon.js
 * For now, it provides a placeholder that guides users to run the bridge daemon separately
 */

/**
 * Initialize AI agent endpoints
 * @param {Express.Application} app - Express app instance
 * @param {Object} options - Configuration options
 * @param {Object} options.logger - Logger instance
 * @param {Function} options.getBridgeState - Function to get bridge state
 * @param {Function} options.appendChat - Function to append chat messages
 * @param {Function} options.getTelemetry - Function to get telemetry
 */
export function initializeAgentEndpoints(app, options = {}) {
    const { logger = console } = options;

    logger.info('[AI Agent] Initializing AI agent endpoints...');

    // TODO: Migrate full AI agent logic from bridge-daemon.js
    // For now, provide helpful error messages

    app.post('/api/ai/agent', async (req, res) => {
        logger.warn('[AI Agent] /api/ai/agent called but full migration pending');
        res.status(503).json({
            success: false,
            error: 'AI agent endpoint migration in progress',
            message: 'The AI agent is being migrated to the main server. For now, please run `node bridge-daemon.js` in a separate terminal.',
            todo: 'Complete migration of 1800+ lines of AI agent logic from bridge-daemon.js'
        });
    });

    app.post('/api/ai/agent/continue', async (req, res) => {
        logger.warn('[AI Agent] /api/ai/agent/continue called but full migration pending');
        res.status(503).json({
            success: false,
            error: 'AI agent continuation endpoint not yet migrated',
            message: 'Please run bridge-daemon.js separately for AI functionality.'
        });
    });

    app.post('/api/ai/agent/audit', async (req, res) => {
        logger.warn('[AI Agent] /api/ai/agent/audit called but full migration pending');
        res.status(503).json({
            success: false,
            error: 'AI agent audit endpoint not yet migrated',
            message: 'Please run bridge-daemon.js separately for AI functionality.'
        });
    });

    app.post('/api/ai/chat', async (req, res) => {
        logger.warn('[AI Agent] /api/ai/chat called but full migration pending');
        res.status(503).json({
            success: false,
            error: 'AI chat endpoint not yet migrated',
            message: 'Please run bridge-daemon.js separately for AI functionality.'
        });
    });

    logger.info('[AI Agent] AI agent endpoints registered (migration pending)');
}

export default {
    initializeAgentEndpoints
};
