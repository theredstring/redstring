/**
 * Example: GitNativeFederation as Pure UI Component
 *
 * This shows how GitNativeFederation SHOULD work - as a pure UI component
 * that only displays data and calls backend services.
 *
 * NO backend logic, NO engine creation, NO authentication handling.
 * Just UI and calls to universeBackend.
 */

import React, { useState, useEffect } from 'react';
import { GitBranch, RefreshCw, Plus, Trash2 } from 'lucide-react';
import universeBackend from '../services/universeBackend.js';

const GitNativeFederationPureUI = () => {
  // ONLY UI STATE
  const [universes, setUniverses] = useState([]);
  const [activeUniverseSlug, setActiveUniverseSlug] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [repoUniverses, setRepoUniverses] = useState({});
  const [isLoading, setIsLoading] = useState(false);

  // ONLY listen to backend events
  useEffect(() => {
    // Subscribe to backend status changes
    const unsubscribe = universeBackend.onStatusChange(setSyncStatus);

    // Load initial data from backend
    loadUniverseData();

    return unsubscribe;
  }, []);

  // ONLY call backend methods
  const loadUniverseData = () => {
    setUniverses(universeBackend.getAllUniverses());
    setActiveUniverseSlug(universeBackend.getActiveUniverse()?.slug || null);
  };

  const handleSwitchUniverse = async (slug) => {
    try {
      setIsLoading(true);
      await universeBackend.switchActiveUniverse(slug);
      loadUniverseData(); // Refresh UI
    } catch (error) {
      console.error('Failed to switch universe:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateUniverse = async (name) => {
    try {
      setIsLoading(true);
      await universeBackend.createUniverse(name);
      loadUniverseData(); // Refresh UI
    } catch (error) {
      console.error('Failed to create universe:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteUniverse = async (slug) => {
    try {
      setIsLoading(true);
      await universeBackend.deleteUniverse(slug);
      loadUniverseData(); // Refresh UI
    } catch (error) {
      console.error('Failed to delete universe:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDiscoverRepositoryUniverses = async (repoConfig) => {
    try {
      setIsLoading(true);
      const discovered = await universeBackend.discoverUniversesInRepository(repoConfig);
      setRepoUniverses({ [repoConfig.repo]: discovered });
    } catch (error) {
      console.error('Failed to discover universes:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLinkUniverse = async (discoveredUniverse, repoConfig) => {
    try {
      setIsLoading(true);
      await universeBackend.linkToDiscoveredUniverse(discoveredUniverse, repoConfig);
      loadUniverseData(); // Refresh UI
    } catch (error) {
      console.error('Failed to link universe:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setIsLoading(true);
      await universeBackend.saveActiveUniverse();
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReload = async () => {
    try {
      setIsLoading(true);
      await universeBackend.reloadActiveUniverse();
      loadUniverseData(); // Refresh UI
    } catch (error) {
      console.error('Failed to reload:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (\n    <div style={{ padding: '16px', fontFamily: 'EmOne, sans-serif' }}>\n      {/* Status Display */}\n      {syncStatus && (\n        <div style={{ \n          padding: '8px', \n          marginBottom: '16px', \n          backgroundColor: syncStatus.type === 'error' ? '#ffebee' : '#e8f5e8',\n          borderRadius: '4px',\n          fontSize: '0.85rem'\n        }}>\n          {syncStatus.status}\n        </div>\n      )}\n\n      {/* Universe List */}\n      <div style={{ marginBottom: '20px' }}>\n        <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem' }}>My Universes</h3>\n        \n        {universes.map(universe => (\n          <div key={universe.slug} style={{\n            display: 'flex',\n            justifyContent: 'space-between',\n            alignItems: 'center',\n            padding: '8px',\n            marginBottom: '4px',\n            backgroundColor: universe.slug === activeUniverseSlug ? '#e8f5e8' : '#f5f5f5',\n            borderRadius: '4px'\n          }}>\n            <div>\n              <div style={{ fontWeight: 600 }}>{universe.name}</div>\n              {universe.metadata?.nodeCount > 0 && (\n                <div style={{ fontSize: '0.75rem', color: '#666' }}>\n                  {universe.metadata.nodeCount} nodes\n                </div>\n              )}\n            </div>\n            \n            <div style={{ display: 'flex', gap: '8px' }}>\n              {universe.slug !== activeUniverseSlug && (\n                <button \n                  onClick={() => handleSwitchUniverse(universe.slug)}\n                  disabled={isLoading}\n                  style={{ padding: '4px 8px', fontSize: '0.8rem' }}\n                >\n                  Switch\n                </button>\n              )}\n              \n              <button \n                onClick={() => handleDeleteUniverse(universe.slug)}\n                disabled={isLoading || universes.length <= 1}\n                style={{ padding: '4px', color: '#d32f2f' }}\n              >\n                <Trash2 size={14} />\n              </button>\n            </div>\n          </div>\n        ))}\n        \n        <button \n          onClick={() => {\n            const name = prompt('Universe name:');\n            if (name) handleCreateUniverse(name);\n          }}\n          disabled={isLoading}\n          style={{ \n            display: 'flex', \n            alignItems: 'center', \n            gap: '6px', \n            padding: '8px', \n            marginTop: '8px',\n            fontSize: '0.85rem'\n          }}\n        >\n          <Plus size={14} /> Create Universe\n        </button>\n      </div>\n\n      {/* Actions */}\n      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>\n        <button \n          onClick={handleSave}\n          disabled={isLoading}\n          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px' }}\n        >\n          <GitBranch size={14} /> Save\n        </button>\n        \n        <button \n          onClick={handleReload}\n          disabled={isLoading}\n          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px' }}\n        >\n          <RefreshCw size={14} /> Reload\n        </button>\n      </div>\n\n      {/* Repository Discovery (simplified) */}\n      <div>\n        <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem' }}>Repository Discovery</h3>\n        \n        <button \n          onClick={() => {\n            const repo = prompt('Enter repo (user/name):');\n            if (repo) {\n              const [user, name] = repo.split('/');\n              handleDiscoverRepositoryUniverses({ user, repo: name, type: 'github' });\n            }\n          }}\n          disabled={isLoading}\n          style={{ padding: '8px', fontSize: '0.85rem' }}\n        >\n          Discover Universes in Repo\n        </button>\n        \n        {Object.entries(repoUniverses).map(([repo, universes]) => (\n          <div key={repo} style={{ marginTop: '12px' }}>\n            <h4 style={{ fontSize: '0.9rem', margin: '0 0 8px 0' }}>Universes in {repo}</h4>\n            \n            {universes.map(universe => (\n              <div key={universe.slug} style={{\n                display: 'flex',\n                justifyContent: 'space-between',\n                alignItems: 'center',\n                padding: '6px',\n                marginBottom: '4px',\n                backgroundColor: '#f8f8f8',\n                borderRadius: '4px'\n              }}>\n                <div>\n                  <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{universe.name}</div>\n                  {universe.stats && (\n                    <div style={{ fontSize: '0.7rem', color: '#666' }}>\n                      {universe.stats.nodes} nodes • {universe.stats.graphs} graphs\n                    </div>\n                  )}\n                </div>\n                \n                <button \n                  onClick={() => handleLinkUniverse(universe, { user: repo.split('/')[0], repo: repo.split('/')[1], type: 'github' })}\n                  disabled={isLoading}\n                  style={{ padding: '4px 8px', fontSize: '0.75rem' }}\n                >\n                  Link\n                </button>\n              </div>\n            ))}\n          </div>\n        ))}\n      </div>\n      \n      {isLoading && (\n        <div style={{ \n          position: 'fixed', \n          top: '50%', \n          left: '50%', \n          transform: 'translate(-50%, -50%)',\n          padding: '16px',\n          backgroundColor: 'rgba(0,0,0,0.8)',\n          color: 'white',\n          borderRadius: '8px'\n        }}>\n          Loading...\n        </div>\n      )}\n    </div>\n  );\n};\n\nexport default GitNativeFederationPureUI;