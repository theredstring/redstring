import React from 'react';
import Modal from '../shared/Modal.jsx';
import GitHubDeviceFlowPanel from './GitHubDeviceFlowPanel.jsx';

/**
 * Modal-wrapped device flow, used where a stacked overlay is fine (e.g. the
 * Universes panel). Onboarding embeds GitHubDeviceFlowPanel inline instead, so
 * the device flow doesn't render behind the onboarding wizard's own overlay.
 *
 * Driven entirely by props — the caller owns the polling promise and mutates
 * the cancel signal it passed in when the user clicks Cancel.
 */
const GitHubDeviceFlowModal = ({
  isOpen,
  onCancel,
  title = 'Connect to GitHub',
  subtitle,
  userCode,
  verificationUri,
  verificationUriComplete,
  expiresAt,
  status = 'pending',
  errorMessage = null
}) => {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title} size="small" showCloseButton={false}>
      <GitHubDeviceFlowPanel
        onCancel={onCancel}
        title={title}
        subtitle={subtitle}
        userCode={userCode}
        verificationUri={verificationUri}
        verificationUriComplete={verificationUriComplete}
        expiresAt={expiresAt}
        status={status}
        errorMessage={errorMessage}
      />
    </Modal>
  );
};

export default GitHubDeviceFlowModal;
