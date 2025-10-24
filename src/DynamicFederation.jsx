/**
 * Dynamic Federation Component
 * User-configurable Pod management with domain ownership verification
 * No hardcoded values - each user controls their own domain and URIs
 */

import React, { useState, useEffect } from 'react';
import { 
  LogIn, 
  LogOut, 
  User, 
  Upload, 
  Download, 
  Trash2, 
  RefreshCw, 
  Globe, 
  Settings, 
  CheckCircle, 
  XCircle, 
  AlertCircle,
  ExternalLink,
  Copy,
  Server
} from 'lucide-react';
import solidAuth from './services/solidAuth.js';
import solidData from './services/solidData.js';
import domainVerification from './services/domainVerification.js';
import podDiscovery from './services/podDiscovery.js';
import uriGenerator from './services/uriGenerator.js';
import { importFromRedstring } from './formats/redstringFormat.js';
import useGraphStore from "./store/graphStore.jsx";

const DynamicFederation = () => {
  const [sessionInfo, setSessionInfo] = useState(solidAuth.getSessionInfo());
  const [podConfig, setPodConfig] = useState({
    issuer: '',
    domain: '',
    webId: '',
    custom: false,
    verified: false
  });
  const [cognitiveSpaces, setCognitiveSpaces] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [savingSpace, setSavingSpace] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [verificationMethod, setVerificationMethod] = useState('dns');
  const [verifying, setVerifying] = useState(false);
  const [discoveredPods, setDiscoveredPods] = useState([]);
  const [discovering, setDiscovering] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const storeActions = useGraphStore.getState();

  // Subscribe to session changes and handle redirect
  useEffect(() => {
    const unsubscribe = solidAuth.onSessionChange((newSessionInfo) => {
      setSessionInfo(newSessionInfo);
      if (newSessionInfo.isLoggedIn) {
        loadCognitiveSpaces();
      } else {
        setCognitiveSpaces([]);
      }
    });

    // Handle redirect on component mount
    solidAuth.handleRedirect().catch(console.error);

    // Check session status periodically
    const interval = setInterval(() => {
      solidAuth.checkSessionStatus();
    }, 5000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  // Load cognitive spaces when logged in
  const loadCognitiveSpaces = async () => {
    if (!sessionInfo.isLoggedIn) return;
    
    setLoading(true);
    setError(null);
    try {
      const spaces = await solidData.listCognitiveSpaces();
      setCognitiveSpaces(spaces);
    } catch (err) {
      console.error('[DynamicFederation] Failed to load cognitive spaces:', err);
      setError(`Failed to load spaces: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Handle domain verification
  const handleVerifyDomain = async () => {
    if (!podConfig.domain.trim()) {
      setError('Please enter a domain to verify');
      return;
    }

    setVerifying(true);
    setError(null);
    try {
      const isVerified = await domainVerification.verifyDomainOwnership(
        podConfig.domain, 
        verificationMethod
      );
      
      setPodConfig(prev => ({
        ...prev,
        verified: isVerified
      }));

      if (isVerified) {
        // Auto-generate Pod configuration
        const generatedConfig = podDiscovery.generatePodConfig(podConfig.domain);
        setPodConfig(prev => ({
          ...prev,
          ...generatedConfig
        }));
      }
    } catch (err) {
      console.error('[DynamicFederation] Domain verification failed:', err);
      setError(`Verification failed: ${err.message}`);
    } finally {
      setVerifying(false);
    }
  };

  // Handle Pod discovery
  const handleDiscoverPods = async () => {
    setDiscovering(true);
    setError(null);
    try {
      const domains = [podConfig.domain].filter(Boolean);
      const pods = await podDiscovery.discoverPods(domains);
      setDiscoveredPods(pods);
    } catch (err) {
      console.error('[DynamicFederation] Pod discovery failed:', err);
      setError(`Discovery failed: ${err.message}`);
    } finally {
      setDiscovering(false);
    }
  };

  // Handle login with custom domain
  const handleLogin = async () => {
    if (podConfig.custom && !podConfig.verified) {
      setError('Please verify your domain ownership before logging in');
      return;
    }

    try {
      setError(null);
      const issuer = podConfig.custom ? podConfig.podUrl : podConfig.issuer;
      await solidAuth.startLogin(issuer);
    } catch (err) {
      console.error('[DynamicFederation] Login failed:', err);
      setError(`Login failed: ${err.message}`);
    }
  };

  const handleLogout = async () => {
    try {
      setError(null);
      await solidAuth.logout();
    } catch (err) {
      console.error('[DynamicFederation] Logout failed:', err);
      setError(`Logout failed: ${err.message}`);
    }
  };

  const handleSaveCurrentSpace = async () => {
    if (!newSpaceName.trim()) {
      setError('Please enter a name for the cognitive space');
      return;
    }

    setSavingSpace(true);
    setError(null);
    try {
      const currentState = useGraphStore.getState();
      // Use user's domain for dynamic URI generation
      const userDomain = podConfig.custom ? podConfig.domain : null;
      await solidData.saveCognitiveSpace(currentState, newSpaceName.trim(), userDomain);
      setNewSpaceName('');
      await loadCognitiveSpaces();
    } catch (err) {
      console.error('[DynamicFederation] Failed to save cognitive space:', err);
      setError(`Failed to save space: ${err.message}`);
    } finally {
      setSavingSpace(false);
    }
  };

  const handleLoadSpace = async (spaceUrl) => {
    setLoading(true);
    setError(null);
    try {
      const redstringData = await solidData.loadCognitiveSpace(spaceUrl);
      const { storeState } = importFromRedstring(redstringData, storeActions);
      storeActions.loadUniverseFromFile(storeState);
    } catch (err) {
      console.error('[DynamicFederation] Failed to load cognitive space:', err);
      setError(`Failed to load space: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSpace = async (spaceUrl, spaceName) => {
    if (!confirm(`Are you sure you want to delete "${spaceName}"? This cannot be undone.`)) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await solidData.deleteCognitiveSpace(spaceUrl, spaceName);
      await loadCognitiveSpaces();
    } catch (err) {
      console.error('[DynamicFederation] Failed to delete cognitive space:', err);
      setError(`Failed to delete space: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  const getVerificationInstructions = () => {
    if (!podConfig.domain) return null;
    return domainVerification.generateVerificationInstructions(podConfig.domain, verificationMethod);
  };

  const instructions = getVerificationInstructions();

  if (!sessionInfo.isLoggedIn) {
    return (
      <div style={{ padding: '15px', fontFamily: "'EmOne', sans-serif", height: '100%', color: '#260000' }}>
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ color: '#260000', marginBottom: '10px', fontSize: '1.1rem' }}>
            <Globe size={20} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
            Dynamic Federation
          </h3>
          <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '15px' }}>
            Connect to your own domain or use a public Solid Pod to save and share cognitive spaces.
          </p>
        </div>

        {/* Pod Configuration */}
        <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#979090', borderRadius: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h4 style={{ color: '#260000', margin: 0, fontSize: '0.9rem' }}>
              <Settings size={16} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
              Pod Configuration
            </h4>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              style={{
                padding: '4px 8px',
                backgroundColor: 'transparent',
                color: '#260000',
                border: '1px solid #979090',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontFamily: "'EmOne', sans-serif"
              }}
            >
              {showAdvanced ? 'Hide' : 'Show'} Advanced
            </button>
          </div>

          {/* Domain Input */}
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', color: '#260000', marginBottom: '5px', fontSize: '0.9rem' }}>
              Your Domain (e.g., alice.com):
            </label>
            <input
              type="text"
              value={podConfig.domain}
              onChange={(e) => setPodConfig(prev => ({ ...prev, domain: e.target.value }))}
              placeholder="Enter your domain"
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #979090',
                borderRadius: '4px',
                fontSize: '0.9rem',
                fontFamily: "'EmOne', sans-serif",
                backgroundColor: '#bdb5b5',
                color: '#260000'
              }}
            />
          </div>

          {/* Verification Method */}
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', color: '#260000', marginBottom: '5px', fontSize: '0.9rem' }}>
              Verification Method:
            </label>
            <select
              value={verificationMethod}
              onChange={(e) => setVerificationMethod(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #979090',
                borderRadius: '4px',
                fontSize: '0.9rem',
                fontFamily: "'EmOne', sans-serif",
                backgroundColor: '#bdb5b5',
                color: '#260000'
              }}
            >
              <option value="dns">DNS Record</option>
              <option value="file">File Upload</option>
              <option value="meta">Meta Tag</option>
            </select>
          </div>

          {/* Verification Status */}
          {podConfig.domain && (
            <div style={{ marginBottom: '15px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                {podConfig.verified ? (
                  <CheckCircle size={16} color="#4caf50" />
                ) : (
                  <XCircle size={16} color="#f44336" />
                )}
                <span style={{ fontSize: '0.9rem', color: '#260000' }}>
                  Domain Verification: {podConfig.verified ? 'Verified' : 'Not Verified'}
                </span>
              </div>
              
              <button
                onClick={handleVerifyDomain}
                disabled={verifying || !podConfig.domain.trim()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  backgroundColor: verifying ? '#ccc' : '#260000',
                  color: '#bdb5b5',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: verifying ? 'not-allowed' : 'pointer',
                  fontSize: '0.8rem',
                  fontFamily: "'EmOne', sans-serif",
                  marginRight: '8px'
                }}
              >
                <RefreshCw size={12} />
                {verifying ? 'Verifying...' : 'Verify Domain'}
              </button>

              <button
                onClick={handleDiscoverPods}
                disabled={discovering}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  backgroundColor: discovering ? '#ccc' : 'transparent',
                  color: '#260000',
                  border: '1px solid #979090',
                  borderRadius: '4px',
                  cursor: discovering ? 'not-allowed' : 'pointer',
                  fontSize: '0.8rem',
                  fontFamily: "'EmOne', sans-serif"
                }}
              >
                <Server size={12} />
                {discovering ? 'Discovering...' : 'Discover Pods'}
              </button>
            </div>
          )}

          {/* Verification Instructions */}
          {instructions && !podConfig.verified && (
            <div style={{ 
              padding: '10px', 
              backgroundColor: '#EFE8E5', 
              border: '1px solid #ffeaa7',
              borderRadius: '4px',
              fontSize: '0.8rem'
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#856404' }}>
                {instructions.method} Instructions:
              </div>
              {instructions.instructions.map((instruction, index) => (
                <div key={index} style={{ marginBottom: '4px', color: '#856404' }}>
                  {instruction}
                </div>
              ))}
              <div style={{ marginTop: '8px', padding: '6px', backgroundColor: '#f8f9fa', borderRadius: '3px' }}>
                <code style={{ fontSize: '0.75rem', color: '#495057' }}>
                  {instructions.example}
                </code>
                <button
                  onClick={() => copyToClipboard(instructions.example)}
                  style={{
                    marginLeft: '8px',
                    padding: '2px 6px',
                    backgroundColor: 'transparent',
                    border: '1px solid #dee2e6',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    fontSize: '0.7rem'
                  }}
                >
                  <Copy size={10} />
                </button>
              </div>
            </div>
          )}

          {/* Advanced Settings */}
          {showAdvanced && (
            <div style={{ marginTop: '15px', padding: '10px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
              <div style={{ marginBottom: '10px' }}>
                <label style={{ display: 'block', color: '#260000', marginBottom: '5px', fontSize: '0.8rem' }}>
                  Custom Identity Provider (optional):
                </label>
                <input
                  type="url"
                  value={podConfig.issuer}
                  onChange={(e) => setPodConfig(prev => ({ ...prev, issuer: e.target.value }))}
                  placeholder="https://login.inrupt.com"
                  style={{
                    width: '100%',
                    padding: '6px',
                    border: '1px solid #979090',
                    borderRadius: '4px',
                    fontSize: '0.8rem',
                    fontFamily: "'EmOne', sans-serif",
                    backgroundColor: '#bdb5b5',
                    color: '#260000'
                  }}
                />
              </div>
              
              {podConfig.verified && (
                <div style={{ fontSize: '0.8rem', color: '#666' }}>
                  <div style={{ marginBottom: '5px' }}>
                    <strong>Generated URIs:</strong>
                  </div>
                  <div style={{ marginBottom: '3px' }}>
                    WebID: {podConfig.webId}
                  </div>
                  <div style={{ marginBottom: '3px' }}>
                    Vocab: {podConfig.vocabNamespace}
                  </div>
                  <div>
                    Spaces: {podConfig.spacesNamespace}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Discovered Pods */}
        {discoveredPods.length > 0 && (
          <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#979090', borderRadius: '8px' }}>
            <h4 style={{ color: '#260000', marginBottom: '10px', fontSize: '0.9rem' }}>
              Discovered Pods ({discoveredPods.length})
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {discoveredPods.map((pod, index) => (
                <div
                  key={index}
                  style={{
                    padding: '10px',
                    backgroundColor: '#bdb5b5',
                    border: '1px solid #979090',
                    borderRadius: '6px',
                    fontSize: '0.8rem'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 'bold', color: '#260000' }}>
                        {pod.domain}
                      </div>
                      <div style={{ color: '#666', fontSize: '0.7rem' }}>
                        {pod.webId}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {pod.verified && (
                        <CheckCircle size={14} color="#4caf50" title="Verified" />
                      )}
                      <button
                        onClick={() => setPodConfig(prev => ({ ...prev, ...pod, custom: true }))}
                        style={{
                          padding: '4px 8px',
                          backgroundColor: '#260000',
                          color: '#bdb5b5',
                          border: 'none',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          fontSize: '0.7rem'
                        }}
                      >
                        Use
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Login Button */}
        <button
          onClick={handleLogin}
          disabled={podConfig.custom && !podConfig.verified}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 15px',
            backgroundColor: (podConfig.custom && !podConfig.verified) ? '#ccc' : '#260000',
            color: '#bdb5b5',
            border: 'none',
            borderRadius: '4px',
            cursor: (podConfig.custom && !podConfig.verified) ? 'not-allowed' : 'pointer',
            fontSize: '0.9rem',
            fontFamily: "'EmOne', sans-serif",
            width: '100%',
            justifyContent: 'center'
          }}
        >
          <LogIn size={16} />
          {podConfig.custom ? 'Login to Your Pod' : 'Login to Solid Pod'}
        </button>

        {error && (
          <div style={{ 
            marginTop: '15px', 
            padding: '10px', 
            backgroundColor: '#ffebee', 
            border: '1px solid #f44336',
            borderRadius: '4px',
            color: '#d32f2f',
            fontSize: '0.8rem'
          }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: '15px', fontFamily: "'EmOne', sans-serif", height: '100%', color: '#260000' }}>
      {/* User Info */}
      <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#979090', borderRadius: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
          <User size={20} color="#260000" />
          <div>
            <div style={{ color: '#260000', fontWeight: 'bold', fontSize: '0.9rem' }}>
              Connected to {podConfig.custom ? 'Your Pod' : 'Solid Pod'}
            </div>
            <div style={{ color: '#666', fontSize: '0.8rem', wordBreak: 'break-all' }}>
              {sessionInfo.webId}
            </div>
            {podConfig.custom && podConfig.domain && (
              <div style={{ color: '#4caf50', fontSize: '0.8rem', marginTop: '4px' }}>
                ✓ {podConfig.domain}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={handleLogout}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            backgroundColor: '#bdb5b5',
            color: '#260000',
            border: '1px solid #979090',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '0.8rem',
            fontFamily: "'EmOne', sans-serif"
          }}
        >
          <LogOut size={14} />
          Logout
        </button>
      </div>

      {/* Save Current Space */}
      <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#979090', borderRadius: '8px' }}>
        <h4 style={{ color: '#260000', marginBottom: '10px', fontSize: '0.9rem' }}>
          Save Current Space
        </h4>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            value={newSpaceName}
            onChange={(e) => setNewSpaceName(e.target.value)}
            placeholder="Space name..."
            style={{
              flex: 1,
              padding: '6px 8px',
              border: '1px solid #979090',
              borderRadius: '4px',
              fontSize: '0.8rem',
              fontFamily: "'EmOne', sans-serif",
              backgroundColor: '#bdb5b5',
              color: '#260000'
            }}
          />
          <button
            onClick={handleSaveCurrentSpace}
            disabled={savingSpace || !newSpaceName.trim()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '6px 10px',
              backgroundColor: savingSpace ? '#ccc' : '#260000',
              color: '#bdb5b5',
              border: 'none',
              borderRadius: '4px',
              cursor: savingSpace ? 'not-allowed' : 'pointer',
              fontSize: '0.8rem',
              fontFamily: "'EmOne', sans-serif"
            }}
          >
            <Upload size={14} />
            {savingSpace ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Cognitive Spaces List */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h4 style={{ color: '#260000', margin: 0, fontSize: '0.9rem' }}>
            Your Cognitive Spaces
          </h4>
          <button
            onClick={loadCognitiveSpaces}
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              backgroundColor: 'transparent',
              color: '#260000',
              border: '1px solid #979090',
              borderRadius: '4px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '0.8rem',
              fontFamily: "'EmOne', sans-serif"
            }}
          >
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>

        {loading && (
          <div style={{ textAlign: 'center', color: '#666', fontSize: '0.8rem', padding: '20px' }}>
            Loading spaces...
          </div>
        )}

        {!loading && cognitiveSpaces.length === 0 && (
          <div style={{ textAlign: 'center', color: '#666', fontSize: '0.8rem', padding: '20px' }}>
            No cognitive spaces found in your Pod.
          </div>
        )}

        {!loading && cognitiveSpaces.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {cognitiveSpaces.map((space, index) => (
              <div
                key={index}
                style={{
                  padding: '12px',
                  backgroundColor: '#979090',
                  border: '1px solid #260000',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div 
                    onClick={() => handleLoadSpace(space.spaceUrl)}
                    style={{ flex: 1, cursor: 'pointer' }}
                  >
                    <div style={{ color: '#260000', fontWeight: 'bold', fontSize: '0.9rem', marginBottom: '4px' }}>
                      {space.title}
                    </div>
                    {space.description && (
                      <div style={{ color: '#666', fontSize: '0.8rem', marginBottom: '4px' }}>
                        {space.description}
                      </div>
                    )}
                    {space.modified && (
                      <div style={{ color: '#999', fontSize: '0.7rem' }}>
                        Modified: {space.modified.toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '4px', marginLeft: '10px' }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleLoadSpace(space.spaceUrl);
                      }}
                      style={{
                        padding: '4px',
                        backgroundColor: 'transparent',
                        color: '#260000',
                        border: '1px solid #979090',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontSize: '0.7rem'
                      }}
                      title="Load this space"
                    >
                      <Download size={12} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSpace(space.spaceUrl, space.name);
                      }}
                      style={{
                        padding: '4px',
                        backgroundColor: 'transparent',
                        color: '#d32f2f',
                        border: '1px solid #d32f2f',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontSize: '0.7rem'
                      }}
                      title="Delete this space"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div style={{ 
          marginTop: '15px', 
          padding: '10px', 
          backgroundColor: '#ffebee', 
          border: '1px solid #f44336',
          borderRadius: '4px',
          color: '#d32f2f',
          fontSize: '0.8rem'
        }}>
          {error}
        </div>
      )}
    </div>
  );
};

export default DynamicFederation; 