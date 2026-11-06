// redstring:// links handed to the desktop app. Main only recognises and holds
// them; the renderer parses what one names (src/services/sharedLink.js) and
// treats the file as untrusted, as it does every universe.

const MAX_APP_LINK_LENGTH = 8192;

const isAppLink = (value) => typeof value === 'string'
  && value.length <= MAX_APP_LINK_LENGTH
  && value.startsWith('redstring://open?');

/** Windows and Linux pass the link as a command-line argument. */
const appLinkFromArgv = (argv) => (Array.isArray(argv) ? argv.find(isAppLink) : undefined) || null;

module.exports = { isAppLink, appLinkFromArgv };
