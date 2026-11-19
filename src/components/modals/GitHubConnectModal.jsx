import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import CanvasModal from '../CanvasModal.jsx';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import GitHubConnectStep from '../shared/GitHubConnectStep.jsx';
import { MODAL_CLOSE_ICON_SIZE } from '../../constants.js';

/**
 * Connect GitHub as its own box, in the middle of the screen: the same step
 * onboarding shows, for anything that needs GitHub before it can go on (the
 * Repository box, for one). Back is the way out; there is no X.
 */
const GitHubConnectModal = ({ isVisible, connection, onBack, onContinue = null, allowOAuthOnly = false }) => {
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1200));
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // As onboarding sizes itself, so the box reads the same in both places.
  const compact = viewportWidth <= 500;
  const width = compact ? Math.min(Math.max(viewportWidth - 24, 320), 540) : 600;

  return (
    <CanvasModal
      isVisible={isVisible}
      onClose={onBack}
      title=""
      width={width}
      position="center"
      margin={compact ? 12 : 20}
      contentStyle={{ padding: 0, overflowY: 'auto', overflowX: 'hidden' }}
      disableBackdrop
    >
      <div style={{ position: 'relative', boxSizing: 'border-box', padding: compact ? '44px 20px 22px' : '52px 32px 28px' }}>
        <PanelIconButton
          icon={ArrowLeft}
          onClick={onBack}
          title="Back"
          size={MODAL_CLOSE_ICON_SIZE}
          style={{ position: 'absolute', top: compact ? '12px' : '16px', left: compact ? '12px' : '16px', zIndex: 10 }}
        />
        <GitHubConnectStep
          connection={connection}
          compact={compact}
          onContinue={onContinue}
          allowOAuthOnly={allowOAuthOnly}
        />
      </div>
    </CanvasModal>
  );
};

export default GitHubConnectModal;
