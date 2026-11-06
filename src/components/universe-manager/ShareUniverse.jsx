import React, { useEffect, useState } from 'react';
import { Check, Copy, Link as LinkIcon, Plus } from 'lucide-react';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import { pillRow } from './shared/slotLayout.js';
import { useTheme } from '../../hooks/useTheme.js';
import { openExternalUrl } from '../../utils/safeUrl.js';
import { copyText, repoAudience, sharedLinkForUniverse } from '../../services/universeShare.js';

/**
 * The active universe's Share section: its link and who that link opens for.
 * Access is the repository's, so changing it means going there.
 */
const ShareUniverse = ({ universe, onLinkRepo, isVerySlim = false }) => {
  const theme = useTheme();
  const { rowStyle, pillProps } = pillRow(isVerySlim);
  const [audience, setAudience] = useState(null);
  const [copied, setCopied] = useState(false);

  const link = sharedLinkForUniverse(universe);
  const linked = universe.raw?.gitRepo?.linkedRepo;
  const repoLabel = linked?.user && linked?.repo ? `${linked.user}/${linked.repo}` : null;

  useEffect(() => {
    if (!link || !repoLabel) return undefined;
    let current = true;
    setAudience(null);
    repoAudience(linked).then((answer) => { if (current) setAudience(answer); });
    return () => { current = false; };
    // The repository is what's being asked about, however its object was rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, repoLabel]);

  const copy = async () => {
    try {
      await copyText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* the clipboard refused; the button stays as it was */ }
  };

  const audienceLine = {
    anyone: 'Anyone with the link can view',
    repo: `Only people with access to ${repoLabel}`,
    unknown: `Whoever can read ${repoLabel}`,
  }[audience];

  return (
    <div data-testid="share-universe" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: theme.canvas.textPrimary }}>
        Share
      </div>
      {link ? (
        <>
          {audienceLine && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem', color: theme.canvas.textSecondary }}>
              <LinkIcon size={12} style={{ flexShrink: 0 }} />
              <span style={{ overflowWrap: 'anywhere' }}>{audienceLine}</span>
            </div>
          )}
          <div style={rowStyle}>
            <PanelIconButton
              icon={copied ? Check : Copy}
              label={copied ? 'Copied' : 'Copy Link'}
              variant="outline"
              size={12}
              {...pillProps}
              onClick={copy}
            />
            {audience && (
              <PanelIconButton
                label="Manage Access"
                variant="outline"
                size={12}
                {...pillProps}
                onClick={() => openExternalUrl(`https://github.com/${repoLabel}/settings/access`)}
              />
            )}
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: '0.7rem', color: theme.canvas.textSecondary }}>
            Add a repository to get a link.
          </div>
          <div style={rowStyle}>
            <PanelIconButton
              icon={Plus}
              label="Add Repository"
              variant="outline"
              size={12}
              {...pillProps}
              onClick={() => onLinkRepo?.(universe.slug)}
            />
          </div>
        </>
      )}
    </div>
  );
};

export default ShareUniverse;
