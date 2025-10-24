/**
 * Federation Component
 * Manages Solid Pod connections, authentication, and cognitive space browsing
 */

import React, { useState, useEffect } from 'react';
import { LogIn, LogOut, User, Upload, Download, Trash2, RefreshCw } from 'lucide-react';
import solidAuth from './services/solidAuth.js';
import solidData from './services/solidData.js';
import { importFromRedstring } from './formats/redstringFormat.js';
import useGraphStore from "./store/graphStore.jsx";

const Federation = () => {
  const [sessionInfo, setSessionInfo] = useState(solidAuth.getSessionInfo());
  const [loginIssuer, setLoginIssuer] = useState('https://login.inrupt.com');
  const [cognitiveSpaces, setCognitiveSpaces] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [savingSpace, setSavingSpace] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');

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
    }, 5000); // Check every 5 seconds

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
      console.error('[Federation] Failed to load cognitive spaces:', err);
      setError(`Failed to load spaces: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    try {
      setError(null);
      await solidAuth.startLogin(loginIssuer);
    } catch (err) {
      console.error('[Federation] Login failed:', err);
      setError(`Login failed: ${err.message}`);
    }
  };

  const handleLogout = async () => {
    try {
      setError(null);
      await solidAuth.logout();
    } catch (err) {
      console.error('[Federation] Logout failed:', err);
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
      await solidData.saveCognitiveSpace(currentState, newSpaceName.trim());
      setNewSpaceName('');
      await loadCognitiveSpaces(); // Refresh the list
    } catch (err) {
      console.error('[Federation] Failed to save cognitive space:', err);
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
      
      // Load the state into the store
      storeActions.loadUniverseFromFile(storeState);
      
    } catch (err) {
      console.error('[Federation] Failed to load cognitive space:', err);
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
      await loadCognitiveSpaces(); // Refresh the list
    } catch (err) {
      console.error('[Federation] Failed to delete cognitive space:', err);
      setError(`Failed to delete space: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!sessionInfo.isLoggedIn) {
    return (
      <div style={{ padding: '15px', fontFamily: "'EmOne', sans-serif", height: '100%', color: '#260000' }}>
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ color: '#260000', marginBottom: '10px', fontSize: '1.1rem' }}>Connect to Solid Pod</h3>
          <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '15px' }}>
            Connect to your Solid Pod to save and share your cognitive spaces across the decentralized web.
          </p>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ display: 'block', color: '#260000', marginBottom: '5px', fontSize: '0.9rem' }}>
            Solid Identity Provider:
          </label>
          <input
            type="url"
            value={loginIssuer}
            onChange={(e) => setLoginIssuer(e.target.value)}
            placeholder="https://login.inrupt.com"
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

        <button
          onClick={handleLogin}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 15px',
            backgroundColor: '#260000',
            color: '#bdb5b5',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '0.9rem',
            fontFamily: "'EmOne', sans-serif",
            width: '100%',
            justifyContent: 'center'
          }}
        >
          <LogIn size={16} />
          Login to Solid Pod
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
              Connected to Solid Pod
            </div>
            <div style={{ color: '#666', fontSize: '0.8rem', wordBreak: 'break-all' }}>
              {sessionInfo.webId}
            </div>
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

export default Federation; 