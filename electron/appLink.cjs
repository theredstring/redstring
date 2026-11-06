// redstring:// links handed to the desktop app. Main only recognises and holds
// them; the renderer parses what one names (src/services/sharedLink.js) and
// treats the file as untrusted, as it does every universe. redstring-dev:// is
// staging's, for electron:dev, so an installed app keeps redstring://; only a dev
// app takes one.

const MAX_APP_LINK_LENGTH = 8192;

const isAppLink = (value, { dev = false } = {}) => typeof value === 'string'
  && value.length <= MAX_APP_LINK_LENGTH
  && (value.startsWith('redstring://open?') || (dev && value.startsWith('redstring-dev://open?')));

/** Windows and Linux pass the link as a command-line argument. */
const appLinkFromArgv = (argv, options) => (Array.isArray(argv) ? argv.find((arg) => isAppLink(arg, options)) : undefined) || null;

module.exports = { isAppLink, appLinkFromArgv };
