import React, { useState, useEffect } from 'react';
import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { Palette, ArrowUpFromDot, ImagePlus, BookOpen, ExternalLink, Trash2, Bookmark, TextSearch } from 'lucide-react';
import { NODE_CORNER_RADIUS, NODE_DEFAULT_COLOR, THUMBNAIL_MAX_DIMENSION } from '../../constants.js';
import { generateThumbnail } from '../../utils.js';
import CollapsibleSection from '../CollapsibleSection.jsx';
import SemanticEditor from '../SemanticEditor.jsx';
import ConnectionBrowser from '../ConnectionBrowser.jsx';
import StandardDivider from '../StandardDivider.jsx';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import { fastEnrichFromSemanticWeb } from '../../services/semanticWebQuery.js';
import useGraphStore from "../../store/graphStore.jsx";

// Helper function to determine the correct article ("a" or "an")
const getArticleFor = (word) => {
  if (!word) return 'a';
  const firstLetter = word.trim()[0].toLowerCase();
  return ['a', 'e', 'i', 'o', 'u'].includes(firstLetter) ? 'an' : 'a';
};

// Wikipedia enrichment functions
const searchWikipedia = async (query) => {
  try {
    // First try to get the exact page
    const summaryResponse = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`,
      { 
        headers: { 
          'Api-User-Agent': 'Redstring/1.0 (https://redstring.ai) Claude/1.0' 
        }
      }
    );

    if (summaryResponse.ok) {
      const summaryData = await summaryResponse.json();
      
      // Check if this is a disambiguation page
      const isDisambiguation = summaryData.type === 'disambiguation' || 
                               summaryData.title?.includes('(disambiguation)') ||
                               summaryData.description?.toLowerCase().includes('disambiguation');
      
      if (isDisambiguation) {
        // If it's a disambiguation page, search for alternatives
        const searchResponse = await fetch(
          `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=8`,
          { 
            headers: { 
              'Api-User-Agent': 'Redstring/1.0 (https://redstring.ai) Claude/1.0' 
            }
          }
        );

        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          if (searchData.query?.search?.length > 0) {
            return {
              type: 'disambiguation',
              options: searchData.query.search.map(result => ({
                title: result.title,
                snippet: result.snippet.replace(/<[^>]*>/g, ''), // Remove HTML tags
                pageid: result.pageid
              }))
            };
          }
        }
      }
      
      return {
        type: 'direct',
        page: {
          title: summaryData.title,
          description: summaryData.extract || summaryData.description,
          url: summaryData.content_urls?.desktop?.page,
          thumbnail: summaryData.thumbnail?.source
        }
      };
    }

    // If direct lookup fails, search for similar pages
    const searchResponse = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=8`,
      { 
        headers: { 
          'Api-User-Agent': 'Redstring/1.0 (https://redstring.ai) Claude/1.0' 
        }
      }
    );

    if (searchResponse.ok) {
      const searchData = await searchResponse.json();
      if (searchData.query?.search?.length > 0) {
        return {
          type: 'disambiguation',
          options: searchData.query.search.map(result => ({
            title: result.title,
            snippet: result.snippet.replace(/<[^>]*>/g, ''), // Remove HTML tags
            pageid: result.pageid
          }))
        };
      }
    }
  } catch (error) {
    console.warn('[Wikipedia] Search failed:', error);
  }
  
  return { type: 'not_found' };
};

// Helper to get additional images from Wikipedia article (beyond main image)
const getWikipediaImages = async (pageTitle) => {
  try {
    const mediaResponse = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(pageTitle)}`,
      { 
        headers: { 
          'Api-User-Agent': 'Redstring/1.0 (https://redstring.ai) Claude/1.0' 
        }
      }
    );

    if (mediaResponse.ok) {
      const mediaData = await mediaResponse.json();
      if (mediaData.items && mediaData.items.length > 0) {
        // Filter for images (not audio, video, etc.) and exclude common non-content images
        const images = mediaData.items.filter(item => 
          item.type === 'image' &&
          item.srcset && 
          item.srcset.length > 0 &&
          !item.title?.toLowerCase().includes('edit') &&
          !item.title?.toLowerCase().includes('icon') &&
          !item.title?.toLowerCase().includes('magnify') &&
          !item.title?.toLowerCase().includes('commons-logo') &&
          !item.title?.toLowerCase().includes('wikimedia') &&
          !item.title?.toLowerCase().includes('flag') && // Often small flag icons
          item.srcset[0]?.src // Has actual image source
        );

        // Return the first few quality images
        return images.slice(0, 3).map(img => ({
          url: img.srcset[img.srcset.length - 1]?.src, // Get highest resolution
          thumbnail: img.srcset[0]?.src // Get smallest for thumbnail
        }));
      }
    }
  } catch (error) {
    console.warn('[Wikipedia] Media list fetch failed:', error);
  }
  
  return [];
};

const getWikipediaPage = async (title) => {
  try {
    // Check if this is a section link (contains #)
    const [pageTitle, sectionId] = title.includes('#') ? title.split('#') : [title, null];
    
    const summaryResponse = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`,
      { 
        headers: { 
          'Api-User-Agent': 'Redstring/1.0 (https://redstring.ai) Claude/1.0' 
        }
      }
    );

    if (summaryResponse.ok) {
      const summaryData = await summaryResponse.json();
      let description = summaryData.extract || summaryData.description;
      let pageUrl = summaryData.content_urls?.desktop?.page;
      let originalImage = summaryData.originalimage?.source;
      let thumbnail = summaryData.thumbnail?.source;
      let additionalImages = [];
      
      // If no main image is available, fetch images from the article content
      if (!originalImage && !thumbnail) {
        additionalImages = await getWikipediaImages(pageTitle);
        if (additionalImages.length > 0) {
          originalImage = additionalImages[0].url;
          thumbnail = additionalImages[0].thumbnail;
        }
      } else {
        // Even if we have a main image, fetch additional images for potential alternatives
        additionalImages = await getWikipediaImages(pageTitle);
      }
      
      // If this is a section link, try to get section-specific content
      if (sectionId) {
        try {
          const sectionContent = await getWikipediaSection(pageTitle, sectionId);
          if (sectionContent) {
            description = sectionContent;
          }
          // Add section fragment to URL
          if (pageUrl) {
            pageUrl += '#' + sectionId;
          }
        } catch (error) {
          console.warn('[Wikipedia] Section content fetch failed, using page summary:', error);
        }
      }
      
      return {
        title: summaryData.title,
        description: description,
        url: pageUrl,
        thumbnail,
        originalImage,
        additionalImages: additionalImages.length > 1 ? additionalImages.slice(1) : [], // Store remaining images
        isSection: !!sectionId,
        sectionId: sectionId
      };
    }
  } catch (error) {
    console.warn('[Wikipedia] Page fetch failed:', error);
  }
  
  return null;
};

const getWikipediaSection = async (pageTitle, sectionId) => {
  try {
    // Get full page content to extract section
    const response = await fetch(
      `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&format=json&origin=*&section=${encodeURIComponent(sectionId)}`,
      { 
        headers: { 
          'Api-User-Agent': 'Redstring/1.0 (https://redstring.ai) Claude/1.0' 
        }
      }
    );
    
    if (response.ok) {
      const data = await response.json();
      if (data.parse?.text?.['*']) {
        // Extract first paragraph from HTML content
        const htmlContent = data.parse.text['*'];
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlContent;
        
        // Find first paragraph with substantial content
        const paragraphs = tempDiv.querySelectorAll('p');
        for (const p of paragraphs) {
          const text = p.textContent.trim();
          if (text.length > 100) { // Minimum length for substantial content
            return text;
          }
        }
      }
    }
  } catch (error) {
    console.warn('[Wikipedia] Section parsing failed:', error);
  }
  
  return null;
};

// Wikipedia Enrichment Component
const WikipediaEnrichment = ({ nodeData, onUpdateNode }) => {
  const [isSearching, setIsSearching] = useState(false);
  const [searchResult, setSearchResult] = useState(null);
  const [showDisambiguation, setShowDisambiguation] = useState(false);
  const [showImageOptions, setShowImageOptions] = useState(false);

  const handleWikipediaSearch = async () => {
    setIsSearching(true);
    try {
      const result = await searchWikipedia(nodeData.name);
      setSearchResult(result);
      
      if (result.type === 'direct') {
        // Directly apply the Wikipedia data
        await applyWikipediaData(result.page);
      } else if (result.type === 'disambiguation') {
        setShowDisambiguation(true);
      }
    } catch (error) {
      console.error('[Wikipedia] Enrichment failed:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const applyWikipediaData = async (pageData) => {
    const updates = {};
    
    // Add description if node doesn't have one
    if (!nodeData.description && pageData.description) {
      updates.description = pageData.description;
    }
    
    // Add Wikipedia metadata
    updates.semanticMetadata = {
      ...nodeData.semanticMetadata,
      wikipediaUrl: pageData.url,
      wikipediaTitle: pageData.title,
      wikipediaEnriched: true,
      wikipediaEnrichedAt: new Date().toISOString()
    };

    if (pageData.thumbnail) {
      updates.semanticMetadata.wikipediaThumbnail = pageData.thumbnail;
    }
    if (pageData.originalImage) {
      updates.semanticMetadata.wikipediaOriginalImage = pageData.originalImage;
    }
    // Store additional images if available
    if (pageData.additionalImages && pageData.additionalImages.length > 0) {
      updates.semanticMetadata.wikipediaAdditionalImages = pageData.additionalImages;
    }

    // Add Wikipedia link to external links (stored directly on nodeData.externalLinks)
    const currentExternalLinks = nodeData.externalLinks || [];
    
    // Check if Wikipedia link already exists
    const hasWikipediaLink = currentExternalLinks.some(link => 
      typeof link === 'string' ? 
        link.includes('wikipedia.org') : 
        link.url?.includes('wikipedia.org')
    );
    
    if (!hasWikipediaLink && pageData.url) {
      // Add the Wikipedia URL directly to the externalLinks array
      updates.externalLinks = [pageData.url, ...currentExternalLinks];
    }

    await onUpdateNode(updates);

    // Auto-set image from Wikipedia if available
    const imgUrl = pageData.originalImage || pageData.thumbnail;
    if (imgUrl) {
      await setWikipediaImageFromUrl(imgUrl);
    }

    setSearchResult(null);
    setShowDisambiguation(false);
  };

  const urlToDataUrl = (url) => {
    return fetch(url, { mode: 'cors' })
      .then((res) => res.blob())
      .then((blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      }));
  };

  const setWikipediaImageFromUrl = async (imageUrl) => {
    if (!imageUrl) return;
    try {
      const dataUrl = await urlToDataUrl(imageUrl);
      const img = new Image();
      const aspectRatio = await new Promise((resolve, reject) => {
        img.onload = () => {
          const ratio = (img.naturalHeight > 0 && img.naturalWidth > 0) ? (img.naturalHeight / img.naturalWidth) : 1;
          resolve(ratio || 1);
        };
        img.onerror = reject;
        img.src = dataUrl;
      });
      const thumbSrc = await generateThumbnail(dataUrl, THUMBNAIL_MAX_DIMENSION);
      await onUpdateNode({ imageSrc: dataUrl, thumbnailSrc: thumbSrc, imageAspectRatio: aspectRatio });
    } catch (error) {
      console.warn('[Wikipedia] Failed to set image from URL:', error);
    }
  };

  const handleDisambiguationSelect = async (option) => {
    setIsSearching(true);
    try {
      const pageData = await getWikipediaPage(option.title);
      if (pageData) {
        await applyWikipediaData(pageData);
      }
    } catch (error) {
      console.error('[Wikipedia] Disambiguation selection failed:', error);
    } finally {
      setIsSearching(false);
    }
  };

  // Show the enrichment button only if node has no meaningful description AND no Wikipedia link
  // Be more strict about what constitutes "meaningful" content to reduce intrusiveness
  const hasMeaningfulDescription = nodeData.description && 
    nodeData.description.trim() !== '' && 
    nodeData.description !== 'Double-click to add a bio...' &&
    nodeData.description.trim().length > 10; // Require at least 10 characters
  
  const hasWikipediaLink = nodeData.semanticMetadata?.wikipediaUrl;
  
  // Only show enrichment button if BOTH conditions are true:
  // 1. No meaningful description exists
  // 2. No Wikipedia link exists
  const showEnrichButton = !hasMeaningfulDescription && !hasWikipediaLink;
  const isAlreadyLinked = nodeData.semanticMetadata?.wikipediaUrl;

  if (!showEnrichButton && !showDisambiguation) return null;

  return (
    <div style={{ margin: '2px 20px 20px 10px' }}>
      {showEnrichButton && (
        <button
          onClick={handleWikipediaSearch}
          disabled={isSearching}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 10px',
            border: '1px solid #8B0000',
            borderRadius: '6px',
            background: 'transparent',
            color: '#8B0000',
            fontFamily: "'EmOne', sans-serif",
            fontSize: '11px',
            cursor: isSearching ? 'wait' : 'pointer',
            fontWeight: 'bold',
            textAlign: 'left'
          }}
        >
          <BookOpen size={12} />
          {isSearching ? 'Searching Wikipedia...' : 'Pull from Wikipedia & Link'}
        </button>
      )}

      {showDisambiguation && searchResult?.type === 'disambiguation' && (
        <div style={{
          marginTop: '8px',
          padding: '12px',
          border: '1px solid #8B0000',
          borderRadius: '6px',
          background: 'rgba(139,0,0,0.05)'
        }}>
          <div style={{
            fontSize: '11px',
            color: '#8B0000',
            fontFamily: "'EmOne', sans-serif",
            fontWeight: 'bold',
            marginBottom: '8px'
          }}>
            Multiple Wikipedia pages found ({searchResult.options.length}):
          </div>
          <div style={{
            maxHeight: '300px',
            overflowY: 'auto',
            marginBottom: '8px'
          }}>
            {searchResult.options.map((option, index) => (
              <div
                key={index}
                onClick={() => handleDisambiguationSelect(option)}
                style={{
                  padding: '6px',
                  marginBottom: '4px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  background: 'white',
                  fontSize: '10px',
                  fontFamily: "'EmOne', sans-serif",
                  transition: 'background 0.15s ease'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(139,0,0,0.05)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
              >
                <div style={{ fontWeight: 'bold', color: '#8B0000', marginBottom: '2px' }}>
                  {option.title}
                </div>
                <div style={{ color: '#666', lineHeight: '1.3' }}>
                  {option.snippet}
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={() => setShowDisambiguation(false)}
            style={{
              marginTop: '6px',
              padding: '4px 8px',
              border: '1px solid #ccc',
              borderRadius: '3px',
              background: 'transparent',
              color: '#666',
              fontSize: '9px',
              cursor: 'pointer',
              fontFamily: "'EmOne', sans-serif"
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {isAlreadyLinked && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          marginTop: '8px',
          fontSize: '10px',
          color: '#8B0000',
          fontFamily: "'EmOne', sans-serif"
        }}>
          <BookOpen size={10} />
          <span>Wikipedia linked</span>
          <button
            onClick={() => window.open(nodeData.semanticMetadata.wikipediaUrl, '_blank')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              padding: '2px 4px',
              border: '1px solid #8B0000',
              borderRadius: '3px',
              background: 'transparent',
              color: '#8B0000',
              fontSize: '8px',
              cursor: 'pointer',
              fontFamily: "'EmOne', sans-serif"
            }}
          >
            <ExternalLink size={8} />
            View
          </button>
          <button
            onClick={() => {
              // If there are additional images, show options; otherwise set directly
              const hasAdditionalImages = nodeData.semanticMetadata?.wikipediaAdditionalImages?.length > 0;
              if (hasAdditionalImages) {
                setShowImageOptions(!showImageOptions);
              } else {
                const imgUrl = nodeData.semanticMetadata?.wikipediaOriginalImage || nodeData.semanticMetadata?.wikipediaThumbnail;
                setWikipediaImageFromUrl(imgUrl);
              }
            }}
            disabled={!(nodeData.semanticMetadata?.wikipediaOriginalImage || nodeData.semanticMetadata?.wikipediaThumbnail)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              padding: '2px 4px',
              border: '1px solid #8B0000',
              borderRadius: '3px',
              background: 'transparent',
              color: '#8B0000',
              fontSize: '8px',
              cursor: (nodeData.semanticMetadata?.wikipediaOriginalImage || nodeData.semanticMetadata?.wikipediaThumbnail) ? 'pointer' : 'not-allowed',
              fontFamily: "'EmOne', sans-serif"
            }}
          >
            {nodeData.semanticMetadata?.wikipediaAdditionalImages?.length > 0 ? 'Choose image ▾' : 'Set as image'}
          </button>
          <button
            onClick={async () => {
              // Remove Wikipedia data from node
              const updates = {
                semanticMetadata: {
                  ...nodeData.semanticMetadata,
                  wikipediaUrl: undefined,
                  wikipediaTitle: undefined,
                  wikipediaEnriched: undefined,
                  wikipediaEnrichedAt: undefined,
                  wikipediaThumbnail: undefined,
                  wikipediaOriginalImage: undefined,
                  wikipediaAdditionalImages: undefined
                }
              };

              // Also remove Wikipedia link from externalLinks
              const currentExternalLinks = nodeData.externalLinks || [];
              const filteredLinks = currentExternalLinks.filter(link => 
                typeof link === 'string' ? 
                  !link.includes('wikipedia.org') : 
                  !link.url?.includes('wikipedia.org')
              );
              
              if (filteredLinks.length !== currentExternalLinks.length) {
                updates.externalLinks = filteredLinks;
              }

              await onUpdateNode(updates);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              padding: '2px 4px',
              border: '1px solid #666',
              borderRadius: '3px',
              background: 'transparent',
              color: '#666',
              fontSize: '8px',
              cursor: 'pointer',
              fontFamily: "'EmOne', sans-serif"
            }}
          >
            Unlink
          </button>
        </div>
      )}

      {/* Image selection dropdown */}
      {showImageOptions && nodeData.semanticMetadata?.wikipediaAdditionalImages && (
        <div style={{
          marginTop: '8px',
          padding: '8px',
          border: '1px solid #8B0000',
          borderRadius: '6px',
          background: 'rgba(139,0,0,0.05)'
        }}>
          <div style={{
            fontSize: '10px',
            color: '#8B0000',
            fontFamily: "'EmOne', sans-serif",
            fontWeight: 'bold',
            marginBottom: '6px'
          }}>
            Choose an image from Wikipedia:
          </div>
          <div style={{
            maxHeight: '200px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          }}>
            {/* Main image first */}
            {(nodeData.semanticMetadata?.wikipediaOriginalImage || nodeData.semanticMetadata?.wikipediaThumbnail) && (
              <div
                onClick={() => {
                  const imgUrl = nodeData.semanticMetadata?.wikipediaOriginalImage || nodeData.semanticMetadata?.wikipediaThumbnail;
                  setWikipediaImageFromUrl(imgUrl);
                  setShowImageOptions(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '4px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  background: 'white',
                  transition: 'background 0.15s ease'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(139,0,0,0.05)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
              >
                <img 
                  src={nodeData.semanticMetadata?.wikipediaThumbnail || nodeData.semanticMetadata?.wikipediaOriginalImage}
                  alt="Main"
                  style={{
                    width: '60px',
                    height: '60px',
                    objectFit: 'cover',
                    borderRadius: '3px'
                  }}
                />
                <span style={{
                  fontSize: '9px',
                  fontFamily: "'EmOne', sans-serif",
                  color: '#8B0000',
                  fontWeight: 'bold'
                }}>
                  Main image
                </span>
              </div>
            )}
            {/* Additional images */}
            {nodeData.semanticMetadata.wikipediaAdditionalImages.map((img, index) => (
              <div
                key={index}
                onClick={() => {
                  setWikipediaImageFromUrl(img.url);
                  setShowImageOptions(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '4px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  background: 'white',
                  transition: 'background 0.15s ease'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(139,0,0,0.05)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
              >
                <img 
                  src={img.thumbnail || img.url}
                  alt={`Image ${index + 1}`}
                  style={{
                    width: '60px',
                    height: '60px',
                    objectFit: 'cover',
                    borderRadius: '3px'
                  }}
                  onError={(e) => {
                    // Hide image on error
                    e.currentTarget.style.display = 'none';
                  }}
                />
                <span style={{
                  fontSize: '9px',
                  fontFamily: "'EmOne', sans-serif",
                  color: '#666'
                }}>
                  Image {index + 1}
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={() => setShowImageOptions(false)}
            style={{
              marginTop: '6px',
              padding: '4px 8px',
              border: '1px solid #ccc',
              borderRadius: '3px',
              background: 'transparent',
              color: '#666',
              fontSize: '9px',
              cursor: 'pointer',
              fontFamily: "'EmOne', sans-serif"
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
};

// Item types for drag and drop
const ItemTypes = {
  SPAWNABLE_NODE: 'spawnable_node'
};

// Draggable node component
const DraggableNodeComponent = ({ node, onOpenNode }) => {
  const [{ isDragging }, drag, preview] = useDrag(() => ({
    type: ItemTypes.SPAWNABLE_NODE,
    item: { 
      prototypeId: node.prototypeId || node.id, 
      nodeId: node.prototypeId || node.id, 
      nodeName: node.name, 
      nodeColor: node.color || NODE_DEFAULT_COLOR,
      fromPanel: true
    },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  }), [node.prototypeId, node.id, node.name, node.color]);

  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  return (
    <div
      ref={drag}
      style={{
        position: 'relative',
        backgroundColor: node.color || NODE_DEFAULT_COLOR,
        color: '#bdb5b5',
        borderRadius: '12px',
        padding: '6px 6px',
        fontSize: '0.8rem',
        fontWeight: 'bold',
        textAlign: 'center',
        cursor: 'pointer',
        overflow: 'hidden',
        userSelect: 'none',
        fontFamily: "'EmOne', sans-serif",
        minHeight: '32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: isDragging ? 0.5 : 1,
        wordBreak: 'break-word',
        lineHeight: '1.2'
      }}
      title={node.name}
      onClick={() => onOpenNode(node.prototypeId || node.id)}
    >
      {node.name}
    </div>
  );
};

// Draggable title component - using same pattern as DraggableNodeComponent
const DraggableTitleComponent = ({ 
  nodeData, 
  isEditingTitle, 
  tempTitle, 
  onTempTitleChange, 
  onTitleDoubleClick, 
  onTitleKeyPress, 
  onTitleSave 
}) => {
  const [{ isDragging }, drag, preview] = useDrag(() => ({
    type: ItemTypes.SPAWNABLE_NODE,
    item: { 
      prototypeId: nodeData.id, 
      nodeId: nodeData.id, 
      nodeName: nodeData.name, 
      nodeColor: nodeData.color || NODE_DEFAULT_COLOR,
      fromPanel: true
    },
    collect: (monitor) => ({
      isDragging: !!monitor.isDragging(),
    }),
  }), [nodeData.id, nodeData.name, nodeData.color]);

  useEffect(() => {
    preview(getEmptyImage(), { captureDraggingState: true });
  }, [preview]);

  if (isEditingTitle) {
    // When editing, make it look identical to non-editing state but with cursor
    return (
      <div style={{
        position: 'relative',
        backgroundColor: nodeData.color || NODE_DEFAULT_COLOR,
        color: '#bdb5b5',
        borderRadius: '12px',
        paddingTop: '10px',
        paddingBottom: '8px',
        paddingLeft: '12px',
        paddingRight: '12px',
        fontSize: '1.1rem',
        fontWeight: 'bold',
        textAlign: 'center',
        overflow: 'hidden',
        userSelect: 'none',
        fontFamily: "'EmOne', sans-serif",
        minHeight: '32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        maxWidth: '200px',
        width: 'fit-content'
      }}>
        <input
          type="text"
          value={tempTitle}
          onChange={(e) => onTempTitleChange(e.target.value)}
          onKeyDown={onTitleKeyPress}
          onBlur={onTitleSave}
          autoFocus
          style={{
            backgroundColor: 'transparent',
            border: 'none',
            color: '#bdb5b5',
            fontSize: '1.1rem',
            fontWeight: 'bold',
            fontFamily: "'EmOne', sans-serif",
            outline: 'none',
            width: `${Math.min(tempTitle.length * 0.7 + 2, 15)}ch`,
            maxWidth: '100%',
            padding: 0,
            textAlign: 'center',
            cursor: 'text'
          }}
        />
      </div>
    );
  }

  // When not editing, show draggable node - exactly like DraggableNodeComponent
  return (
    <div
      ref={drag}
      style={{
        position: 'relative',
        backgroundColor: nodeData.color || NODE_DEFAULT_COLOR,
        color: '#bdb5b5',
        borderRadius: '12px',
        paddingTop: '10px',
        paddingBottom: '8px',
        paddingLeft: '12px',
        paddingRight: '12px',
        fontSize: '1.1rem',
        fontWeight: 'bold',
        textAlign: 'center',
        cursor: 'pointer',
        overflow: 'hidden',
        userSelect: 'none',
        fontFamily: "'EmOne', sans-serif",
        minHeight: '32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: isDragging ? 0.5 : 1,
        maxWidth: '200px',
        width: 'fit-content'
      }}
      title={nodeData.name}
      onDoubleClick={onTitleDoubleClick}
    >
      {nodeData.name || 'Untitled'}
    </div>
  );
};

/**
 * Shared content component used by both home and node tabs
 * Provides consistent layout and functionality across panel types
 */
const SharedPanelContent = ({
  // Core data
  nodeData,
  graphData,
  activeGraphNodes = [],
  componentOfNodes = [],
  nodePrototypes, // Add this to get type names
  
  // Actions
  onNodeUpdate,
  onImageAdd,
  onColorChange,
  onOpenNode,
  onExpandNode,
  onNavigateDefinition,
  onTypeSelect,
  onMaterializeConnection,
  
  // UI state
  isUltraSlim = false,
  showExpandButton = true,
  expandButtonDisabled = false,
  
  // Type determination
  isHomeTab = false
}) => {
  const [isEditingBio, setIsEditingBio] = useState(false);
  const [tempBio, setTempBio] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState('');

  // Auto-enrich external links (but not bio descriptions) on mount if none exist
  useEffect(() => {
    let didCancel = false;
    const hasAnySemanticLinks = (() => {
      const links = [
        ...(nodeData.externalLinks || []),
        nodeData.semanticMetadata?.wikipediaUrl || null,
        nodeData.semanticMetadata?.wikidataUrl || null
      ].filter(Boolean);
      return links.some(l => String(l).includes('wikipedia.org') || String(l).includes('wikidata.org') || String(l).includes('dbpedia.org'));
    })();

    if (!nodeData?.name || hasAnySemanticLinks) return;

    (async () => {
      try {
        const result = await fastEnrichFromSemanticWeb(nodeData.name, { timeout: 15000 });
        if (didCancel || !result || !result.suggestions) return;
        const newLinks = Array.isArray(result.suggestions.externalLinks) ? result.suggestions.externalLinks : [];
        if (newLinks.length === 0) return;

        const existing = new Set((nodeData.externalLinks || []).map(String));
        let changed = false;
        for (const l of newLinks) {
          if (!existing.has(String(l))) {
            existing.add(String(l));
            changed = true;
          }
        }
        if (changed) {
          // Only update external links, never auto-populate description/bio
          onNodeUpdate({ ...nodeData, externalLinks: Array.from(existing) });
        }
      } catch (_) {
        // best-effort, ignore errors
      }
    })();

    return () => { didCancel = true; };
  }, [nodeData.id]);

  const unlinkSource = async (domain) => {
    try {
      const currentLinks = nodeData.externalLinks || [];
      const filteredLinks = currentLinks.filter(link => !String(link).includes(domain));
      const updates = { externalLinks: filteredLinks };
      if (domain === 'wikipedia.org' && nodeData.semanticMetadata) {
        updates.semanticMetadata = {
          ...nodeData.semanticMetadata,
          wikipediaUrl: undefined,
          wikipediaTitle: undefined,
          wikipediaEnriched: undefined,
          wikipediaEnrichedAt: undefined,
          wikipediaThumbnail: undefined,
          wikipediaOriginalImage: undefined,
          wikipediaAdditionalImages: undefined
        };
      }
      await onNodeUpdate(updates);
    } catch (_) {}
  };

  const handleBioDoubleClick = () => {
    setTempBio(nodeData.description || '');
    setIsEditingBio(true);
    // Trigger auto-resize after a short delay to ensure DOM is updated
    setTimeout(() => {
      const textarea = document.querySelector('textarea');
      if (textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.max(textarea.scrollHeight + 4, 40) + 'px';
      }
    }, 10);
  };

  const handleBioSave = () => {
    onNodeUpdate({ ...nodeData, description: tempBio });
    setIsEditingBio(false);
  };

  const handleBioCancel = () => {
    setIsEditingBio(false);
  };

  const handleBioKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleBioSave();
    } else if (e.key === 'Escape') {
      handleBioCancel();
    }
  };

  const handleTitleDoubleClick = () => {
    setTempTitle(nodeData.name || '');
    setIsEditingTitle(true);
  };

  const handleTitleSave = () => {
    onNodeUpdate({ ...nodeData, name: tempTitle });
    setIsEditingTitle(false);
  };

  const handleTitleCancel = () => {
    setIsEditingTitle(false);
  };

  const handleTitleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleTitleSave();
    } else if (e.key === 'Escape') {
      handleTitleCancel();
    }
  };

  const handleImageDelete = (event) => {
    if (event && typeof event.stopPropagation === 'function') {
      event.stopPropagation();
    }
    onNodeUpdate({ imageSrc: null, thumbnailSrc: null, imageAspectRatio: null });
  };

  if (!nodeData) {
    return (
      <div style={{ padding: '10px', color: '#aaa', fontFamily: "'EmOne', sans-serif" }}>
        No data available...
      </div>
    );
  }

  // Action buttons for header
  const actionButtons = (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      gap: '8px',
      flexWrap: isUltraSlim ? 'wrap' : 'nowrap'
    }}>
      <PanelIconButton
        icon={Palette}
        onClick={onColorChange}
        title="Change color"
      />
      {showExpandButton && (
        <PanelIconButton
          icon={ArrowUpFromDot}
          color={expandButtonDisabled ? "#716C6C" : "#260000"}
          onClick={expandButtonDisabled ? undefined : onExpandNode}
          title={expandButtonDisabled ? "Cannot expand - this node defines the current graph" : "Expand definition"}
          disabled={expandButtonDisabled}
        />
      )}
      <PanelIconButton
        icon={ImagePlus}
        onClick={() => onImageAdd(nodeData.id)}
        title="Add image"
      />
    </div>
  );

  // Secondary row: Save toggle + Text Search to open Semantic Discovery
  const savedNodeIds = useGraphStore((state) => state.savedNodeIds);
  const toggleSavedNode = useGraphStore((state) => state.toggleSavedNode);
  const isSaved = !!(savedNodeIds && nodeData?.id && savedNodeIds.has(nodeData.id));

  const handleSemanticDiscoverySearch = () => {
    const query = nodeData?.name || '';
    if (!query.trim()) return;
    try {
      // Ask left panel to switch to Semantic Discovery
      window.dispatchEvent(new CustomEvent('openSemanticDiscovery', { detail: { query } }));
      // Also trigger search directly if the view is already active
      if (typeof window !== 'undefined' && typeof window.triggerSemanticSearch === 'function') {
        window.triggerSemanticSearch(query);
      }
    } catch {}
  };

  const secondaryButtons = (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      gap: '8px',
      flexWrap: 'nowrap'
    }}>
      <PanelIconButton
        icon={Bookmark}
        filled={isSaved}
        fillColor="#260000"
        hoverFillColor="maroon"
        onClick={() => toggleSavedNode && nodeData?.id && toggleSavedNode(nodeData.id)}
        title={isSaved ? 'Remove from Saved Things' : 'Save to Saved Things'}
      />
      <PanelIconButton
        icon={TextSearch}
        onClick={handleSemanticDiscoverySearch}
        title="Search this in Semantic Discovery"
      />
    </div>
  );

  return (
    <div className="shared-panel-content">
      {/* Header Section */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '8px' 
      }}>
        <DraggableTitleComponent 
          nodeData={nodeData} 
          isEditingTitle={isEditingTitle}
          tempTitle={tempTitle}
          onTempTitleChange={setTempTitle}
          onTitleDoubleClick={handleTitleDoubleClick}
          onTitleKeyPress={handleTitleKeyPress}
          onTitleSave={handleTitleSave}
        />
        
        {!isUltraSlim && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', alignSelf: 'center' }}>
            {actionButtons}
            {secondaryButtons}
          </div>
        )}
      </div>

      {/* Type Section - under title */}
      {(() => {
        // Get the type name
        const typeName = nodeData.typeNodeId && nodePrototypes 
          ? nodePrototypes.get(nodeData.typeNodeId)?.name || 'Type'
          : 'Thing';
        
        return (
          <div style={{
            marginBottom: isUltraSlim ? '16px' : '12px'
          }}>
            {isUltraSlim ? (
              // Ultra slim layout: "Is a" on top, type button below, icons at bottom
              <>
                <div style={{
                  marginBottom: '6px',
                  minWidth: '120px',
                  whiteSpace: 'nowrap'
                }}>
                  <span style={{
                    fontSize: '0.9rem',
                    color: '#260000',
                    fontFamily: "'EmOne', sans-serif"
                  }}>
                    Is {getArticleFor(typeName)}
                  </span>
                </div>
                
                <div style={{
                  marginBottom: '12px'
                }}>
                  <button
                    onClick={() => onTypeSelect && onTypeSelect(nodeData.id)}
                    style={{
                      backgroundColor: '#8B0000',
                      color: '#bdb5b5',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '5px 8px 3px 8px',
                      fontSize: '0.8rem',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      fontFamily: "'EmOne', sans-serif",
                      outline: 'none'
                    }}
                  >
                    {typeName}
                  </button>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px', marginLeft: '2px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>{actionButtons}</div>
                  <div style={{ display: 'flex', gap: '8px' }}>{secondaryButtons}</div>
                </div>
              </>
            ) : (
              // Normal layout: "Is a" and type button inline
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                minWidth: '120px',
                whiteSpace: 'nowrap'
              }}>
                <span style={{
                  fontSize: '0.9rem',
                  color: '#260000',
                  fontFamily: "'EmOne', sans-serif"
                }}>
                  Is {getArticleFor(typeName)}
                </span>
                <button
                  onClick={() => onTypeSelect && onTypeSelect(nodeData.id)}
                  style={{
                    backgroundColor: '#8B0000',
                    color: '#bdb5b5',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '5px 8px 3px 8px',
                    fontSize: '0.8rem',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    fontFamily: "'EmOne', sans-serif",
                    outline: 'none',
                    marginLeft: '6px'
                  }}
                >
                  {typeName}
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Dividing line above Bio section */}
      <StandardDivider margin="20px 0" />
      
      {/* Bio Section */}
      <CollapsibleSection 
        title="Bio" 
        defaultExpanded={true}
      >
        {isEditingBio ? (
          <div style={{ marginRight: '15px' }}>
            <textarea
              value={tempBio}
              onChange={(e) => setTempBio(e.target.value)}
              onKeyDown={handleBioKeyPress}
              onBlur={handleBioSave}
              autoFocus
              style={{
                width: '100%',
                padding: '8px 12px 12px 12px',
                border: '3px solid #260000',
                borderRadius: '12px',
                fontSize: '1.0rem',
                fontFamily: "'EmOne', sans-serif",
                lineHeight: '1.4',
                backgroundColor: 'transparent',
                outline: 'none',
                color: '#260000',
                resize: 'none',
                minHeight: '40px',
                height: 'auto',
                overflow: 'hidden',
                boxSizing: 'border-box'
              }}
              rows={2}
              onInput={(e) => {
                e.target.style.height = 'auto';
                e.target.style.height = Math.max(e.target.scrollHeight + 4, 40) + 'px';
              }}
            />
          </div>
        ) : (
          <div 
            onDoubleClick={handleBioDoubleClick}
            style={{
              marginRight: '15px',
              padding: '8px',
              fontSize: '1.0rem',
              fontFamily: "'EmOne', sans-serif",
              lineHeight: '1.4',
              color: nodeData.description ? '#260000' : '#999',
              cursor: 'pointer',
              borderRadius: '4px',
              minHeight: '20px',
              userSelect: 'text',
              textAlign: 'left'
            }}
            title="Double-click to edit"
          >
            {nodeData.description || 'Double-click to add a bio...'}
          </div>
        )}
        
        {/* Wikipedia Enrichment - moved inside Bio section */}
        <div style={{ marginTop: '12px' }}>
          <WikipediaEnrichment 
            nodeData={nodeData}
            onUpdateNode={onNodeUpdate}
          />
        </div>
      </CollapsibleSection>

      {/* Dividing line above Origin section */}
      <StandardDivider margin="20px 0" />
      
      {/* Origin Section - Always show, with semantic data if available */}
      <CollapsibleSection 
        title="Origin" 
        defaultExpanded={true}
      >
        {nodeData.semanticMetadata?.isSemanticNode && nodeData.semanticMetadata?.originMetadata ? (
          // Semantic web origin data
          <div style={{ 
            fontSize: '11px', 
            fontFamily: "'EmOne', sans-serif",
            color: '#260000',
            marginBottom: '12px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <div style={{ 
                padding: '2px 6px', 
                background: '#8B0000', 
                borderRadius: '4px', 
                color: '#EFE8E5',
                fontSize: '9px',
                fontWeight: 'bold'
              }}>
                {nodeData.semanticMetadata.originMetadata.source.toUpperCase()}
              </div>
              <div style={{ fontSize: '9px', color: '#666' }}>
                Confidence: {Math.round(nodeData.semanticMetadata.originMetadata.confidence * 100)}%
              </div>
            </div>
            
            {nodeData.originalDescription && (
              <div style={{ 
                marginBottom: '8px', 
                padding: '8px', 
                background: 'rgba(139,0,0,0.05)',
                borderRadius: '4px',
                fontSize: '10px',
                lineHeight: '1.4'
              }}>
                {nodeData.originalDescription}
              </div>
            )}
            
            <div style={{ fontSize: '9px', color: '#666', marginBottom: '4px' }}>
              Discovered: {new Date(nodeData.semanticMetadata.originMetadata.discoveredAt).toLocaleDateString()}
            </div>
            
            {nodeData.semanticMetadata.originMetadata.searchQuery && (
              <div style={{ fontSize: '9px', color: '#666', marginBottom: '4px' }}>
                Search: "{nodeData.semanticMetadata.originMetadata.searchQuery}"
              </div>
            )}
            
            {nodeData.semanticMetadata.originMetadata.originalUri && (
              <div style={{ marginTop: '8px' }}>
                <button
                  onClick={() => window.open(nodeData.semanticMetadata.originMetadata.originalUri, '_blank')}
                  style={{
                    padding: '4px 8px',
                    border: '1px solid #8B0000',
                    borderRadius: '3px',
                    background: 'transparent',
                    color: '#8B0000',
                    fontSize: '8px',
                    cursor: 'pointer',
                    fontFamily: "'EmOne', sans-serif"
                  }}
                >
                  View Source
                </button>
              </div>
            )}
          </div>
        ) : (
          // Default origin information for all nodes
          <div style={{ 
            fontSize: '11px', 
            fontFamily: "'EmOne', sans-serif",
            color: '#666',
            marginBottom: '12px'
          }}>
            <div style={{ marginBottom: '8px' }}>
              <strong>Created:</strong> {nodeData.createdAt ? new Date(nodeData.createdAt).toLocaleDateString() : 'Unknown'}
            </div>

            {/* External source links: Wikipedia, Wikidata, DBpedia from either semanticMetadata or externalLinks */}
            {(() => {
              const links = [
                ...(nodeData.externalLinks || []),
                nodeData.semanticMetadata?.wikipediaUrl || null,
                nodeData.semanticMetadata?.wikidataUrl || null
              ].filter(Boolean);

              const hasWikipedia = links.some(l => typeof l === 'string' && l.includes('wikipedia.org'));
              const hasWikidata = links.some(l => typeof l === 'string' && l.includes('wikidata.org'));
              const hasDBpedia = links.some(l => typeof l === 'string' && l.includes('dbpedia.org'));

              return (
                <>
                  {hasWikipedia && (() => {
                    const url = links.find(l => String(l).includes('wikipedia.org'));
                    return (
                      <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div>
                          <strong>Wikipedia:</strong>
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#8B0000', marginLeft: '8px' }}
                          >
                            View Article
                          </a>
                        </div>
                        <button
                          onClick={() => unlinkSource('wikipedia.org')}
                          title="Unlink Wikipedia"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#999',
                            cursor: 'pointer',
                            padding: '0 2px',
                            lineHeight: 1,
                            fontSize: '14px'
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = '#666'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = '#999'; }}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })()}
                  {hasWikidata && (() => {
                    const url = links.find(l => String(l).includes('wikidata.org'));
                    return (
                      <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div>
                          <strong>Wikidata:</strong>
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#8B0000', marginLeft: '8px' }}
                          >
                            View Data
                          </a>
                        </div>
                        <button
                          onClick={() => unlinkSource('wikidata.org')}
                          title="Unlink Wikidata"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#999',
                            cursor: 'pointer',
                            padding: '0 2px',
                            lineHeight: 1,
                            fontSize: '14px'
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = '#666'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = '#999'; }}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })()}
                  {hasDBpedia && (() => {
                    const url = links.find(l => String(l).includes('dbpedia.org'));
                    return (
                      <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div>
                          <strong>DBpedia:</strong>
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#8B0000', marginLeft: '8px' }}
                          >
                            View Resource
                          </a>
                        </div>
                        <button
                          onClick={() => unlinkSource('dbpedia.org')}
                          title="Unlink DBpedia"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#999',
                            cursor: 'pointer',
                            padding: '0 2px',
                            lineHeight: 1,
                            fontSize: '14px'
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = '#666'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = '#999'; }}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })()}

                  {!(hasWikipedia || hasWikidata || hasDBpedia) && (
                    <div style={{ 
                      fontSize: '10px', 
                      color: '#999', 
                      fontStyle: 'italic',
                      marginTop: '8px'
                    }}>
                      From Redstring
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </CollapsibleSection>

      {/* Dividing line above Image section */}
      {nodeData.imageSrc && <StandardDivider margin="20px 0" />}
      
      {/* Image Section */}
      {nodeData.imageSrc && (
        <CollapsibleSection 
          title={(
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>Image</span>
            </span>
          )}
          rightAdornment={(
            <Trash2 
              size={14}
              style={{ cursor: 'pointer', marginRight: '8px', color: 'inherit' }}
              title="Delete image"
              onClick={(e) => { e.stopPropagation(); handleImageDelete(e); }}
            />
          )}
          defaultExpanded={true}
        >
          <div style={{
            width: '100%',
            overflow: 'hidden',
            borderRadius: '6px'
          }}>
            <img
              src={nodeData.imageSrc}
              alt={nodeData.name}
              style={{
                display: 'block',
                width: '100%',
                height: 'auto',
                objectFit: 'contain',
                borderRadius: '6px'
              }}
            />
          </div>
      </CollapsibleSection>
      )}

      {/* Dividing line above Components section */}
      <StandardDivider margin="20px 0" />
      
      {/* Components Section */}
      <CollapsibleSection 
        title="Components" 
        count={activeGraphNodes.length}
        defaultExpanded={true}
      >
        {activeGraphNodes.length > 0 ? (
          <div style={{
            marginRight: '15px',
            display: 'grid',
            gridTemplateColumns: isUltraSlim ? '1fr' : '1fr 1fr',
            gap: '8px',
            maxHeight: '300px',
            overflowY: 'auto'
          }}>
            {activeGraphNodes.map((node) => (
              <DraggableNodeComponent
                key={node.id}
                node={node}
                onOpenNode={onOpenNode}
              />
            ))}
          </div>
        ) : (
          <div style={{ 
            marginRight: '15px',
            color: '#999', 
            fontSize: '0.9rem', 
            fontFamily: "'EmOne', sans-serif",
            textAlign: 'left',
            padding: '20px 0 20px 15px'
          }}>
            No components in this {isHomeTab ? 'graph' : 'definition'}.
          </div>
        )}
      </CollapsibleSection>

      {!isHomeTab && (
        <>
          {/* Dividing line above Component Of section */}
          <StandardDivider margin="20px 0" />

          {/* Component Of Section */}
          <CollapsibleSection
            title="Component Of"
            count={componentOfNodes.length}
            defaultExpanded={true}
          >
            {componentOfNodes.length > 0 ? (
              <div style={{
                marginRight: '15px',
                display: 'grid',
                gridTemplateColumns: isUltraSlim ? '1fr' : '1fr 1fr',
                gap: '8px',
                maxHeight: '300px',
                overflowY: 'auto'
              }}>
                {componentOfNodes.map((node) => (
                  <DraggableNodeComponent
                    key={node.prototypeId || node.id}
                    node={node}
                    onOpenNode={onOpenNode}
                  />
                ))}
              </div>
            ) : (
              <div style={{ 
                marginRight: '15px',
                color: '#999', 
                fontSize: '0.9rem', 
                fontFamily: "'EmOne', sans-serif",
                textAlign: 'left',
                padding: '20px 0 20px 15px'
              }}>
                This prototype is not yet a component of other definitions.
              </div>
            )}
          </CollapsibleSection>
        </>
      )}

      {/* Dividing line above Connections section */}
      <StandardDivider margin="20px 0" />
      
      {/* Connections Section - Native Redstring connections */}
      <CollapsibleSection 
        title="Connections" 
        defaultExpanded={false}
      >
        <ConnectionBrowser 
          nodeData={nodeData}
          onMaterializeConnection={onMaterializeConnection}
          isUltraSlim={isUltraSlim}
        />
      </CollapsibleSection>

      {/* Dividing line above Semantic Web section */}
      <StandardDivider margin="20px 0" />
      
      {/* Semantic Web Section - unified external links + RDF schema */}
      <CollapsibleSection 
        title="Semantic Web" 
        defaultExpanded={false}
      >
        <SemanticEditor 
          nodeData={nodeData}
          onUpdate={onNodeUpdate}
          isUltraSlim={isUltraSlim}
        />
      </CollapsibleSection>

      {/* Removed Semantic Profile section per requirements */}
    </div>
  );
};

export default SharedPanelContent;
