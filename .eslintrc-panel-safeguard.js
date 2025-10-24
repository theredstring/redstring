// Custom ESLint rule to prevent multiple useGraphStore subscriptions in Panel.jsx
// This helps prevent Panel jitter during pinch zoom operations

module.exports = {
  overrides: [
    {
      files: ['src/Panel.jsx'],
      rules: {
        // Custom rule: Warn about multiple useGraphStore calls
        'no-restricted-syntax': [
          'error',
          {
            selector: 'CallExpression[callee.name="useGraphStore"]:not(:first-of-type)',
            message: 'Multiple useGraphStore subscriptions in Panel.jsx can cause jitter during pinch zoom. Use the existing pattern or consolidate into one subscription.'
          }
        ]
      }
    }
  ]
};
