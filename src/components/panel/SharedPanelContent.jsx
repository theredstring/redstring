import React, { useState, useEffect, useRef } from 'react';
import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { Palette, ArrowUpFromDot, ImagePlus, BookOpen, ExternalLink, Trash2, Bookmark, TextSearch } from 'lucide-react';
import { NODE_CORNER_RADIUS, NODE_DEFAULT_COLOR, THUMBNAIL_MAX_DIMENSION } from '../../constants.js';
import { generateThumbnail } from '../../utils.js';
import { getTextColor } from '../../utils/colorUtils';
import CollapsibleSection from '../CollapsibleSection.jsx';
import SemanticEditor from '../SemanticEditor.jsx';
import ConnectionBrowser from '../ConnectionBrowser.jsx';
import StandardDivider from '../StandardDivider.jsx';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import AgentConfigEditor from '../AgentConfigEditor.jsx';
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
  console.log(`[Wikipedia Images] 🔎 searchWikipedia called with query: "${query}"`);
  try {
    // First try to get the exact page
    console.log(`[Wikipedia Images] 📡 Fetching Wikipedia summary for: "${query}"`);
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
        console.log(`[Wikipedia Images] 🔀 Disambiguation detected, fetching alternatives...`);
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
            console.log(`[Wikipedia Images] ✅ Found ${searchData.query.search.length} disambiguation options`);
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

      // Direct match found - fetch full page data with images using getWikipediaPage
      console.log(`[Wikipedia Images] ✅ Direct match found: "${summaryData.title}"`);
      console.log(`[Wikipedia Images] 🔄 Calling getWikipediaPage to fetch complete data with images...`);
      const fullPageData = await getWikipediaPage(summaryData.title);

      if (fullPageData) {
        console.log(`[Wikipedia Images] ✅ Got full page data from getWikipediaPage`);
        return {
          type: 'direct',
          page: fullPageData
        };
      } else {
        console.log(`[Wikipedia Images] ⚠️ getWikipediaPage returned null, using summary data`);
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

// Helper to get additional images from Wikipedia article (using action API)
const getWikipediaImages = async (pageTitle) => {
  console.log(`[Wikipedia Images] 🔍 Fetching images for article: "${pageTitle}"`);

  try {
    // Use the action API to get all images from the article
    const imagesUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=images&titles=${encodeURIComponent(pageTitle)}&imlimit=10`;
    console.log(`[Wikipedia Images] 📡 API call 1/2: Fetching image list from article`);

    const imagesResponse = await fetch(imagesUrl, {
      headers: {
        'Api-User-Agent': 'Redstring/1.0 (https://redstring.ai) Claude/1.0'
      }
    });

    if (imagesResponse.ok) {
      const imagesData = await imagesResponse.json();
      const pages = imagesData.query?.pages;
      if (!pages) {
        console.log(`[Wikipedia Images] ⚠️ No pages in response`);
        return [];
      }

      const page = Object.values(pages)[0];
      if (!page.images) {
        console.log(`[Wikipedia Images] ⚠️ No images found in article`);
        return [];
      }

      console.log(`[Wikipedia Images] 📸 Found ${page.images.length} total images in article`);
      console.log(`[Wikipedia Images] 📋 Raw image titles:`, page.images.map(img => img.title));

      // Filter out common non-content images and get image info
      const contentImages = page.images.filter(img =>
        !img.title.toLowerCase().includes('edit') &&
        !img.title.toLowerCase().includes('icon') &&
        !img.title.toLowerCase().includes('magnify') &&
        !img.title.toLowerCase().includes('commons-logo') &&
        !img.title.toLowerCase().includes('wikimedia') &&
        !img.title.toLowerCase().includes('flag') &&
        !img.title.toLowerCase().includes('symbol') &&
        (img.title.toLowerCase().endsWith('.jpg') ||
          img.title.toLowerCase().endsWith('.jpeg') ||
          img.title.toLowerCase().endsWith('.png') ||
          img.title.toLowerCase().endsWith('.gif') ||
          img.title.toLowerCase().endsWith('.webp'))
      );

      console.log(`[Wikipedia Images] ✅ Filtered to ${contentImages.length} content images`);
      console.log(`[Wikipedia Images] 📋 Content image titles:`, contentImages.map(img => img.title));

      // Now get the actual URLs for these images (batch request)
      const imageTitles = contentImages.slice(0, 5).map(img => img.title).join('|');
      if (!imageTitles) {
        console.log(`[Wikipedia Images] ⚠️ No content images to fetch URLs for`);
        return [];
      }

      console.log(`[Wikipedia Images] 📡 API call 2/2: Fetching URLs and dimensions for ${contentImages.slice(0, 5).length} images`);
      const imageInfoResponse = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=imageinfo&iiprop=url|size&titles=${encodeURIComponent(imageTitles)}`,
        {
          headers: {
            'Api-User-Agent': 'Redstring/1.0 (https://redstring.ai) Claude/1.0'
          }
        }
      );

      if (imageInfoResponse.ok) {
        const imageInfoData = await imageInfoResponse.json();
        const imagePages = imageInfoData.query?.pages;
        if (!imagePages) {
          console.log(`[Wikipedia Images] ⚠️ No image info pages in response`);
          return [];
        }

        // Extract image data with dimensions
        const imageData = Object.values(imagePages)
          .filter(p => p.imageinfo && p.imageinfo.length > 0)
          .map(p => {
            const info = p.imageinfo[0];
            return {
              url: info.url,
              thumbnail: info.url,
              width: info.width || 0,
              height: info.height || 0,
              title: p.title
            };
          })
          .filter(img => img.url);

        console.log(`[Wikipedia Images] 📊 Image data with dimensions:`, imageData.map(img => ({
          title: img.title,
          url: img.url,
          dimensions: `${img.width}x${img.height}`
        })));

        // Apply Wikipedia's pageimages scoring algorithm
        // See: https://www.mediawiki.org/wiki/Extension:PageImages#How_are_images_scored?
        const scoredImages = imageData.map((img, index) => {
          let score = 0;

          // Position scoring: Only first 4 images are favored (Wikipedia standard)
          if (index < 4) {
            score += 8; // Bonus for being in first 4
          } else {
            score -= 10; // Penalty for being after first 4
          }

          // Width scoring (heavily favor Wikipedia's ideal 400-600px range)
          if (img.width < 119) {
            score -= 100; // Strongly penalize tiny images
          } else if (img.width >= 400 && img.width <= 600) {
            score += 20; // STRONGLY prefer ideal 400-600px range
          } else if (img.width >= 300 && img.width < 400) {
            score += 8; // Acceptable smaller
          } else if (img.width > 600 && img.width <= 1000) {
            score += 5; // Acceptable larger
          } else if (img.width > 1000) {
            score += 2; // Too large, probably full-res upload
          }

          // Aspect ratio scoring (Wikipedia allows 0.4 to 3.1, prefers 0.6 to 2.1)
          const ratio = img.width / img.height;
          if (ratio >= 0.6 && ratio <= 2.1) {
            score += 5; // Preferred range
          } else if (ratio >= 0.4 && ratio <= 3.1) {
            score += 0; // Acceptable
          } else {
            score -= 100; // Bad ratio
          }

          console.log(`[Wikipedia Images] 📊 Image ${index + 1}: ${img.title} (${img.width}x${img.height}, ratio ${ratio.toFixed(2)}) = Score: ${score}`);

          return { ...img, score };
        });

        // Sort by score (highest first) and filter out negative scores
        const contentSizedImages = scoredImages
          .filter(img => img.score > 0)
          .sort((a, b) => b.score - a.score);

        console.log(`[Wikipedia Images] ✅ After scoring: ${contentSizedImages.length} valid images`);
        if (contentSizedImages.length > 0) {
          console.log(`[Wikipedia Images] 🏆 Top scored images:`, contentSizedImages.slice(0, 3).map(img => ({
            title: img.title,
            score: img.score,
            dimensions: `${img.width}x${img.height}`
          })));
        }

        // Take top 3 scored images
        const finalImages = contentSizedImages.slice(0, 3);

        if (finalImages.length > 0) {
          console.log(`[Wikipedia Images] 🎯 FIRST IMAGE SELECTED: ${finalImages[0].title} (${finalImages[0].width}x${finalImages[0].height})`);
          console.log(`[Wikipedia Images] 🖼️ First image URL: ${finalImages[0].url}`);
        }

        console.log(`[Wikipedia Images] ✅ Returning ${finalImages.length} images`);
        return finalImages;
      } else {
        console.log(`[Wikipedia Images] ❌ Image info request failed: ${imageInfoResponse.status}`);
      }
    } else {
      console.log(`[Wikipedia Images] ❌ Image list request failed: ${imagesResponse.status}`);
    }
  } catch (error) {
    console.warn('[Wikipedia Images] ❌ Image list fetch failed:', error);
  }

  console.log(`[Wikipedia Images] ⚠️ Returning empty array`);
  return [];
};

const getWikipediaPage = async (title) => {
  console.log(`[Wikipedia Images] 🌐 Starting Wikipedia page fetch for: "${title}"`);

  try {
    // Check if this is a section link (contains #)
    const [pageTitle, sectionId] = title.includes('#') ? title.split('#') : [title, null];
    console.log(`[Wikipedia Images] 📄 Page: "${pageTitle}"${sectionId ? `, Section: "${sectionId}"` : ''}`);

    // Fetch basic summary from REST API
    console.log(`[Wikipedia Images] 📡 Fetching REST API summary...`);
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

      console.log(`[Wikipedia Images] ✅ REST API summary fetched`);
      console.log(`[Wikipedia Images] 🖼️ Summary has main image: ${!!(originalImage || thumbnail)}`);
      if (originalImage) console.log(`[Wikipedia Images] 📸 Original image from summary: ${originalImage}`);
      if (thumbnail) console.log(`[Wikipedia Images] 🖼️ Thumbnail from summary: ${thumbnail}`);

      // If no main image from REST API, try to get it from action API
      if (!originalImage && !thumbnail) {
        console.log(`[Wikipedia Images] 🔄 No image in summary, trying action API pageimages...`);
        try {
          const pageImageResponse = await fetch(
            `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=pageimages&piprop=original&titles=${encodeURIComponent(pageTitle)}`,
            {
              headers: {
                'Api-User-Agent': 'Redstring/1.0 (https://redstring.ai) Claude/1.0'
              }
            }
          );

          if (pageImageResponse.ok) {
            const pageImageData = await pageImageResponse.json();
            const pages = pageImageData.query?.pages;
            if (pages) {
              const page = Object.values(pages)[0];
              if (page.original?.source) {
                originalImage = page.original.source;
                thumbnail = page.original.source; // Use same URL, browser will cache
                console.log(`[Wikipedia Images] ✅ Got main image from action API pageimages: ${originalImage}`);
              } else {
                console.log(`[Wikipedia Images] ⚠️ Action API pageimages returned no image`);
              }
            }
          }
        } catch (error) {
          console.warn('[Wikipedia Images] ❌ Main image fetch from action API failed:', error);
        }
      }

      // If still no image, fetch images from the article content
      if (!originalImage && !thumbnail) {
        console.log(`[Wikipedia Images] 🔄 Still no main image, fetching all article images...`);
        additionalImages = await getWikipediaImages(pageTitle);
        if (additionalImages.length > 0) {
          originalImage = additionalImages[0].url;
          thumbnail = additionalImages[0].thumbnail;
          console.log(`[Wikipedia Images] ✅ Using first article image as main: ${originalImage}`);
          // Remove the first image from additionalImages since we're using it as main
          additionalImages = additionalImages.slice(1);
          console.log(`[Wikipedia Images] 📋 Remaining additional images: ${additionalImages.length}`);
        } else {
          console.log(`[Wikipedia Images] ⚠️ No images found in article content either`);
        }
      } else {
        console.log(`[Wikipedia Images] ✅ Have main image, fetching additional images...`);
        // Even if we have a main image, fetch additional images for potential alternatives
        additionalImages = await getWikipediaImages(pageTitle);
        console.log(`[Wikipedia Images] 📋 Additional images found: ${additionalImages.length}`);
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

      const result = {
        title: summaryData.title,
        description: description,
        url: pageUrl,
        thumbnail,
        originalImage,
        additionalImages: additionalImages.length > 0 ? additionalImages : [], // Store additional images
        isSection: !!sectionId,
        sectionId: sectionId
      };

      console.log(`[Wikipedia Images] ✅ FINAL RESULT for "${pageTitle}":`);
      console.log(`[Wikipedia Images]    - Title: ${result.title}`);
      console.log(`[Wikipedia Images]    - thumbnail: ${result.thumbnail || 'NONE'}`);
      console.log(`[Wikipedia Images]    - originalImage: ${result.originalImage || 'NONE'}`);
      console.log(`[Wikipedia Images]    - Has main image: ${!!(result.originalImage || result.thumbnail)}`);
      console.log(`[Wikipedia Images]    - Main image URL: ${result.originalImage || result.thumbnail || 'none'}`);
      console.log(`[Wikipedia Images]    - Additional images: ${result.additionalImages.length}`);
      if (result.additionalImages.length > 0) {
        console.log(`[Wikipedia Images]    - Additional image URLs:`, result.additionalImages.map(img => img.url));
      }

      return result;
    }
  } catch (error) {
    console.warn('[Wikipedia Images] ❌ Page fetch failed:', error);
  }

  console.log(`[Wikipedia Images] ❌ Returning null - no data found`);
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
    console.log(`[Wikipedia Images] 🚀 TRIGGERED: Wikipedia search for "${nodeData.name}"`);
    setIsSearching(true);
    try {
      console.log(`[Wikipedia Images] 📞 Calling searchWikipedia("${nodeData.name}")...`);
      const result = await searchWikipedia(nodeData.name);
      console.log(`[Wikipedia Images] 📦 Search result type: ${result.type}`);
      setSearchResult(result);

      if (result.type === 'direct') {
        console.log(`[Wikipedia Images] ✅ Direct match found, applying Wikipedia data...`);
        // Directly apply the Wikipedia data
        await applyWikipediaData(result.page);
      } else if (result.type === 'disambiguation') {
        console.log(`[Wikipedia Images] 🔀 Disambiguation page found, showing options...`);
        setShowDisambiguation(true);
      }
    } catch (error) {
      console.error('[Wikipedia Images] ❌ Enrichment failed:', error);
    } finally {
      setIsSearching(false);
      console.log(`[Wikipedia Images] ✅ Search complete`);
    }
  };

  const applyWikipediaData = async (pageData) => {
    console.log(`[Wikipedia Images] 💾 Applying Wikipedia data for: "${pageData.title}"`);
    console.log(`[Wikipedia Images] 📦 Page data:`, {
      title: pageData.title,
      hasDescription: !!pageData.description,
      hasThumbnail: !!pageData.thumbnail,
      hasOriginalImage: !!pageData.originalImage,
      additionalImagesCount: pageData.additionalImages?.length || 0
    });

    const updates = {};

    // Add description if node doesn't have one
    if (!nodeData.description && pageData.description) {
      updates.description = pageData.description;
      console.log(`[Wikipedia Images] 📝 Adding description (${pageData.description.length} chars)`);
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
      console.log(`[Wikipedia Images] 🖼️ Storing thumbnail: ${pageData.thumbnail}`);
    }
    if (pageData.originalImage) {
      updates.semanticMetadata.wikipediaOriginalImage = pageData.originalImage;
      console.log(`[Wikipedia Images] 📸 Storing original image: ${pageData.originalImage}`);
    }
    // Store additional images if available
    if (pageData.additionalImages && pageData.additionalImages.length > 0) {
      updates.semanticMetadata.wikipediaAdditionalImages = pageData.additionalImages;
      console.log(`[Wikipedia Images] 📋 Storing ${pageData.additionalImages.length} additional images`);
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
      console.log(`[Wikipedia Images] 🔗 Adding Wikipedia link to external links`);
    }

    console.log(`[Wikipedia Images] 💾 Saving node updates...`);
    await onUpdateNode(updates);
    console.log(`[Wikipedia Images] ✅ Node updates saved`);

    // Auto-set image from Wikipedia if available
    const imgUrl = pageData.originalImage || pageData.thumbnail;
    if (imgUrl) {
      console.log(`[Wikipedia Images] 🖼️ Auto-setting image: ${imgUrl}`);
      await setWikipediaImageFromUrl(imgUrl);
    } else {
      console.log(`[Wikipedia Images] ⚠️ No image to auto-set`);
    }

    setSearchResult(null);
    setShowDisambiguation(false);
    console.log(`[Wikipedia Images] ✅ applyWikipediaData complete`);
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
    console.log(`[Wikipedia Images] 🔀 User selected disambiguation option: "${option.title}"`);
    setIsSearching(true);
    try {
      const pageData = await getWikipediaPage(option.title);
      if (pageData) {
        console.log(`[Wikipedia Images] ✅ Got page data, applying...`);
        await applyWikipediaData(pageData);
      } else {
        console.log(`[Wikipedia Images] ⚠️ getWikipediaPage returned null`);
      }
    } catch (error) {
      console.error('[Wikipedia Images] ❌ Disambiguation selection failed:', error);
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
          {isSearching ? 'Searching Wikipedia...' :
           nodeData.semanticMetadata?.autoEnriched ? 'Re-Pull from Wikipedia' :
           'Pull from Wikipedia & Link'}
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
        color: getTextColor(node.color || NODE_DEFAULT_COLOR),
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
        color: getTextColor(nodeData.color || NODE_DEFAULT_COLOR),
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
            color: getTextColor(nodeData.color || NODE_DEFAULT_COLOR),
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
        color: getTextColor(nodeData.color || NODE_DEFAULT_COLOR),
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
  const isSavingBioRef = useRef(false);

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
    } catch (_) { }
  };

  const handleBioDoubleClick = () => {
    setTempBio(nodeData.description || '');
    setIsEditingBio(true);
    isSavingBioRef.current = false; // Reset lock on open
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
    if (isSavingBioRef.current) return;
    isSavingBioRef.current = true;
    onNodeUpdate({ ...nodeData, description: tempBio });
    setIsEditingBio(false);
    setTimeout(() => { isSavingBioRef.current = false; }, 200);
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
    } catch { }
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

            <div style={{ marginTop: '8px', fontSize: '9px', color: '#999', fontFamily: "'EmOne', sans-serif" }}>
              {isHomeTab && graphData?.id && (
                <div style={{ marginBottom: '2px' }}>Graph ID: {graphData.id}</div>
              )}
              ID: {nodeData.id}
            </div>
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

            <div style={{ marginTop: '8px', fontSize: '9px', color: '#999', fontFamily: "'EmOne', sans-serif" }}>
              {isHomeTab && graphData?.id && (
                <div style={{ marginBottom: '2px' }}>Graph ID: {graphData.id}</div>
              )}
              ID: {nodeData.id}
            </div>

            {/* Auto-enriched badge - show when node was automatically enriched by AI agent */}
            {nodeData.semanticMetadata?.autoEnriched && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginTop: '12px',
                padding: '6px 8px',
                background: 'rgba(139, 0, 0, 0.05)',
                borderRadius: '4px',
                fontSize: '10px',
                color: '#8B0000',
                fontFamily: "'EmOne', sans-serif"
              }}>
                <span>🤖 Auto-enriched from Wikipedia</span>
                <span style={{ color: '#666', fontSize: '9px' }}>
                  ({Math.round(nodeData.semanticMetadata.autoEnrichConfidence * 100)}% match)
                </span>
              </div>
            )}
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

      {/* Dividing line above Component Of section */}
      <StandardDivider margin="20px 0" />

      {/* Component Of Section - now shown for both home and node tabs */}
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
            This {isHomeTab ? 'graph' : 'prototype'} is not yet a component of other definitions.
          </div>
        )}
      </CollapsibleSection>

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

      {/* Dividing line above Agent section */}
      <StandardDivider margin="20px 0" />

      {/* Agent Configuration Section */}
      <CollapsibleSection
        title="Agent"
        defaultExpanded={false}
      >
        <AgentConfigEditor
          config={nodeData?.agentConfig}
          onChange={(config) => {
            useGraphStore.getState().updateNodePrototype(nodeData.id, (draft) => {
              draft.agentConfig = config;
            });
          }}
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

// Export Wikipedia functions for use in auto-enrichment
export { searchWikipedia, getWikipediaPage, getWikipediaImages };

export default SharedPanelContent;
