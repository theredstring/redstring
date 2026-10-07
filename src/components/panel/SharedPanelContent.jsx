import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { Palette, ArrowUpFromDot, ImagePlus, BookOpen, Trash2, Bookmark, TextSearch, Sparkles, NotebookText } from 'lucide-react';
import { NODE_CORNER_RADIUS, NODE_DEFAULT_COLOR } from '../../constants.js';
import { getTextColor } from '../../utils/colorUtils';
import { useTheme } from '../../hooks/useTheme.js';
import debugConfig from '../../utils/debugConfig.js';
import CollapsibleSection from '../CollapsibleSection.jsx';
import SemanticEditor from '../SemanticEditor.jsx';
import ConnectionBrowser from '../ConnectionBrowser.jsx';
import StandardDivider from '../StandardDivider.jsx';
import PanelIconButton from '../shared/PanelIconButton.jsx';
import PanelCard, { usePanelCardTokens } from '../shared/PanelCard.jsx';
import InfoPopover from '../shared/InfoPopover.jsx';
import PanelImage, { PanelImageShimmer } from '../shared/PanelImage.jsx';
import AboutSection from './AboutSection.jsx';
import WebDefinitionsSection from './WebDefinitionsSection.jsx';
import { ABOUT_INTRO } from './aboutCopy.js';
import { WIZARD_DEFINE_INTRO } from './panelCopy.js';
import useAutoEnrichIdentifiers from '../../hooks/useAutoEnrichIdentifiers.js';
import useDoubleTap from '../../hooks/useDoubleTap.js';
import useGraphStore from "../../store/graphStore.js";
import useImageCache, { cancelThumbnailFetch } from '../../services/imageCache.js';
import { linkedWikipediaTitle } from '../../services/conceptEnrichment.js';
import { resolveImageRef, canResolveRefs } from '../../services/imageBlobStore.js';
import { safeImageSrc } from '../../utils/safeUrl.js';
import { setWikipediaImage } from '../../services/wikipediaImage.js';

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
        // Parsed into an inert document, never the live one: an innerHTML
        // assignment on a live element fetches its images and runs its
        // inline handlers (<img onerror>) before we read a word of it.
        const parsed = new DOMParser().parseFromString(String(htmlContent), 'text/html');

        // Find first paragraph with substantial content
        const paragraphs = parsed.querySelectorAll('p');
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

/**
 * One candidate article on a disambiguation page.
 *
 * Lit with the pie hover PanelIconButton uses (#DEDADA, maroon ring) but not
 * its grow: these are full-width rows in a scroll box, where a scale would
 * clip against its edges. Like PopoverOption, the ring is 1.5px on top of a
 * border that turns maroon, so together they read as the usual 3px without
 * the text shifting.
 */
const WikipediaPageOption = ({ option, disabled, onClick }) => {
  const tokens = usePanelCardTokens();
  const [isHovered, setIsHovered] = useState(false);
  const accent = tokens.theme.accent.primary;
  const lit = isHovered && !disabled;

  return (
    <button
      type="button"
      data-nav="item"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onBlur={() => setIsHovered(false)}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '7px 9px',
        marginBottom: '6px',
        border: `1.5px solid ${lit ? accent : tokens.hairline}`,
        borderRadius: '8px',
        background: lit ? '#DEDADA' : 'transparent',
        boxShadow: lit ? `0 0 0 1.5px ${accent}` : 'none',
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        fontFamily: "'EmOne', sans-serif",
        transition: 'background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease'
      }}
    >
      <span style={{
        display: 'block',
        fontSize: '12px',
        fontWeight: 'bold',
        color: lit ? accent : tokens.brand,
        marginBottom: option.snippet ? '2px' : 0
      }}>
        {option.title}
      </span>
      {option.snippet && (
        <span style={{
          display: 'block',
          fontSize: '11px',
          lineHeight: 1.35,
          color: lit ? accent : tokens.muted,
          opacity: lit ? 0.85 : 1
        }}>
          {option.snippet}
        </span>
      )}
    </button>
  );
};

// Wikipedia Enrichment Component
const WikipediaEnrichment = ({ nodeData, onUpdateNode, triggerRef, onSearchingChange }) => {
  const theme = useTheme();
  const accentColor = theme.darkMode ? '#C09191' : theme.accent.primary;
  const [isSearching, setIsSearching] = useState(false);
  const [searchResult, setSearchResult] = useState(null);
  const [showDisambiguation, setShowDisambiguation] = useState(false);

  const handleWikipediaSearch = async () => {
    console.log(`[Wikipedia Images] 🚀 TRIGGERED: Wikipedia search for "${nodeData.name}"`);
    setIsSearching(true);
    try {
      // If this Thing is already linked to an article, that article is the
      // source — for the bio and for the picture alike. Searching the name
      // again would re-open the ambiguity the link exists to have closed, and
      // can quietly land on a different subject entirely.
      const linkedTitle = await linkedWikipediaTitle(nodeData);
      if (linkedTitle) {
        console.log(`[Wikipedia Images] 🔗 Node is already linked — pulling from "${linkedTitle}"`);
        const linkedPage = await getWikipediaPage(linkedTitle);
        if (linkedPage) {
          await applyWikipediaData(linkedPage);
          return;
        }
        console.warn(`[Wikipedia Images] ⚠️ Linked article "${linkedTitle}" fetch failed — falling back to name search`);
      }

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

    // wikipediaThumbnail is deliberately NOT written here. setWikipediaImageFromUrl
    // below writes it together with the measured aspect ratio. Writing it early made
    // the canvas's image-cache reconcile fetch it at ratio 1 while the ratio was still
    // being measured — the node grew square, then collapsed when the real write
    // cleared the cache, then grew again: a visible stutter-and-replay.
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

  // The article's main image: pageData's thumbnail when it has no original.
  const setWikipediaImageFromUrl = (imageUrl) => setWikipediaImage(nodeData?.id, { url: imageUrl }, onUpdateNode);

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

  const isAlreadyLinked = !!nodeData.semanticMetadata?.wikipediaUrl;

  // Offer the pull whenever there is no meaningful bio to overwrite. A node that
  // is already linked used to be excluded here, which left the one case where
  // the pull is least ambiguous — we know the exact article — with no way to
  // ask for it.
  const showEnrichButton = !hasMeaningfulDescription;

  // Expose search trigger to parent via ref (must be before early return)
  useEffect(() => {
    if (triggerRef) triggerRef.current = handleWikipediaSearch;
  });
  useEffect(() => {
    onSearchingChange?.(isSearching);
  }, [isSearching]);

  if (!showEnrichButton && !showDisambiguation) return null;

  return (
    <div style={{ margin: '2px 20px 20px 10px' }}>
      {showEnrichButton && (
        <PanelIconButton
          icon={BookOpen}
          size={12}
          label={isSearching ? 'Searching Wikipedia...' :
            isAlreadyLinked ? 'Pull from Linked Wikipedia' :
              'Pull from Wikipedia & Link'}
          labelFontSize={11}
          variant="outline"
          color={accentColor}
          onClick={handleWikipediaSearch}
          disabled={isSearching}
          style={{
            borderColor: accentColor,
            cursor: isSearching ? 'wait' : 'pointer'
          }}
        />
      )}

      {showDisambiguation && searchResult?.type === 'disambiguation' && (
        <PanelCard
          title={`Multiple Wikipedia pages found (${searchResult.options.length})`}
          style={{ marginTop: '8px', marginBottom: 0 }}
        >
          {/* 3px of padding inside the scroll box so a hovered row's ring isn't
              clipped by it. */}
          <div style={{
            maxHeight: '300px',
            overflowY: 'auto',
            padding: '3px',
            margin: '-3px -3px 7px'
          }}>
            {searchResult.options.map((option, index) => (
              <WikipediaPageOption
                key={index}
                option={option}
                disabled={isSearching}
                onClick={() => handleDisambiguationSelect(option)}
              />
            ))}
          </div>
          <PanelIconButton
            label="Cancel"
            labelFontSize={11}
            variant="outline"
            onClick={() => setShowDisambiguation(false)}
          />
        </PanelCard>
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
  const theme = useTheme();
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
        color: getTextColor(node.color || NODE_DEFAULT_COLOR, theme.darkMode),
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
      data-nav="item"
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
  const theme = useTheme();
  const lastTapRef = useRef(0);
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

  const handleTouchEnd = (e) => {
    if (!onTitleDoubleClick) return;
    const now = Date.now();
    if (now - lastTapRef.current < 400) {
      lastTapRef.current = 0;
      e.preventDefault();
      onTitleDoubleClick(e);
    } else {
      lastTapRef.current = now;
    }
  };

  if (isEditingTitle) {
    // When editing, make it look identical to non-editing state but with cursor
    return (
      <div style={{
        position: 'relative',
        backgroundColor: nodeData.color || NODE_DEFAULT_COLOR,
        color: getTextColor(nodeData.color || NODE_DEFAULT_COLOR, theme.darkMode),
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
        lineHeight: '1.1',
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
            color: getTextColor(nodeData.color || NODE_DEFAULT_COLOR, theme.darkMode),
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
        color: getTextColor(nodeData.color || NODE_DEFAULT_COLOR, theme.darkMode),
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
        lineHeight: '1.1',
        maxWidth: '200px',
        width: 'fit-content'
      }}
      title={nodeData.name}
      onDoubleClick={onTitleDoubleClick}
      onTouchEnd={handleTouchEnd}
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

  // The type row's buttons (see PanelContentWrapper). No open handler means
  // the type is this Thing itself.
  typeActionsAvailable = false,
  onOpenTypeInPanel,
  onExpandType,
  typeExpandDisabled = false,

  // Web Definitions (see PanelContentWrapper)
  definitionGraphIds = [],
  definitionIndex = 0,
  currentDefinitionId = null,
  onDefinitionIndexChange,
  onAddDefinition,
  onDeleteDefinition,
  onOpenDefinition,
  onOpenDefinitionInPanel,
  onUpdateDefinitionDescription,
  canEditDefinitions = false,
  activeGraphId = null,
  subjectWebId = null,

  // Bio: the description of the definition you're on (see PanelContentWrapper).
  // Without these, the Bio is the Thing's own description, as it always was.
  bioText,
  onBioChange,
  bioWritesThing = true,

  // UI state
  isUltraSlim = false,
  showExpandButton = true,
  expandButtonDisabled = false,

  // Type determination
  isHomeTab = false
}) => {
  const theme = useTheme();
  const accentColor = theme.darkMode ? '#C09191' : theme.accent.primary;
  const accentBgLight = theme.darkMode ? 'rgba(192,145,145,0.1)' : 'rgba(139,0,0,0.05)';
  const [isEditingBio, setIsEditingBio] = useState(false);
  const [tempBio, setTempBio] = useState('');
  const [wizardEnabled, setWizardEnabled] = useState(() => {
    try { return debugConfig.isWizardEnabled(); } catch { return false; }
  });
  useEffect(() => {
    const handler = (cfg) => setWizardEnabled(!!cfg?.enableWizard);
    return debugConfig.addListener(handler);
  }, []);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState('');
  const isSavingBioRef = useRef(false);
  const wikiSearchRef = useRef(null);
  const [wikiIsSearching, setWikiIsSearching] = useState(false);
  const cachedImage = useImageCache(state => (nodeData?.id ? state.images[nodeData.id] : null));
  const imageLoading = useImageCache(state => (nodeData?.id ? !!state.loading[nodeData.id] : false));

  // Full-resolution images committed to git live in content-addressed blobs
  // beside the .redstring file rather than as base64 inside it, so a prototype
  // may carry only a `sha256:…` ref. Resolve it on demand — this is the ONLY
  // place a ref has to be fetched, because the canvas renders thumbnailSrc,
  // which stays inline.
  const [resolvedRefSrc, setResolvedRefSrc] = useState(null);
  // Tracked separately from "not resolved yet" so the section can tell a fetch
  // in flight (shimmer) from one that came back empty (say so). Collapsing the
  // two would leave a permanently spinning placeholder for an image that is
  // never going to arrive.
  const [refResolutionFailed, setRefResolutionFailed] = useState(false);
  const imageRef = nodeData?.imageRef || null;
  const imageRefExt = nodeData?.imageRefExt || null;
  useEffect(() => {
    // A stale resolution must never paint over the node the user has since
    // navigated to, so drop the previous result before starting a new fetch.
    setResolvedRefSrc(null);
    setRefResolutionFailed(false);
    if (!imageRef) return;
    // No git source registered (a local-only universe holding a file that was
    // authored against a repo) — there is nothing to fetch from, and saying so
    // immediately beats an indefinite shimmer.
    if (!canResolveRefs()) {
      setRefResolutionFailed(true);
      return;
    }
    let cancelled = false;
    resolveImageRef(imageRef, imageRefExt).then((url) => {
      if (cancelled) return;
      if (url) setResolvedRefSrc(url);
      else setRefResolutionFailed(true);
    });
    return () => { cancelled = true; };
  }, [imageRef, imageRefExt]);

  // Look up what the world calls this thing. Lives here rather than inside
  // AboutSection because CollapsibleSection only renders children while
  // expanded, which would gate enrichment on the section being open.
  useAutoEnrichIdentifiers(nodeData, onNodeUpdate);

  const bio = bioText ?? nodeData?.description ?? '';
  // The Wikipedia pull reads the description it would fill, so on a later
  // definition it has to see that definition's, not the Thing's.
  const enrichmentNodeData = useMemo(() => (
    bioWritesThing || !nodeData ? nodeData : { ...nodeData, description: bio }
  ), [bioWritesThing, nodeData, bio]);


  const handleBioDoubleClick = () => {
    setTempBio(bio);
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
  const bioDoubleTap = useDoubleTap(handleBioDoubleClick);

  const handleBioSave = () => {
    if (isSavingBioRef.current) return;
    isSavingBioRef.current = true;
    if (onBioChange) onBioChange(tempBio);
    else onNodeUpdate({ ...nodeData, description: tempBio });
    setIsEditingBio(false);
    setTimeout(() => { isSavingBioRef.current = false; }, 200);
  };

  const handleBioCancel = () => {
    setIsEditingBio(false);
  };

  const handleBioKeyPress = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleBioSave();
    } else if (e.key === 'Escape') {
      handleBioCancel();
    }
  };

  // A Wikipedia pull describes the definition you're on, like the Bio it sits in;
  // everything else it writes (links, metadata, image) belongs to the Thing.
  const handleEnrichmentUpdate = (updates) => {
    if (bioWritesThing || !onBioChange || updates?.description === undefined) return onNodeUpdate(updates);
    const { description, ...rest } = updates;
    onBioChange(description);
    return Object.keys(rest).length > 0 ? onNodeUpdate(rest) : undefined;
  };

  const handleTitleDoubleClick = () => {
    setTempTitle(nodeData.name || '');
    setIsEditingTitle(true);
  };

  const handleTitleSave = () => {
    if (tempTitle.trim()) {
      onNodeUpdate({ ...nodeData, name: tempTitle });
    }
    setIsEditingTitle(false);
  };

  const handleTitleCancel = () => {
    setIsEditingTitle(false);
  };

  const handleTitleKeyPress = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      handleTitleSave();
    } else if (e.key === 'Escape') {
      handleTitleCancel();
    }
  };

  const handleImageDelete = (event) => {
    console.log('[ImageDelete] Trash icon clicked!', event);
    if (event && typeof event.stopPropagation === 'function') {
      event.stopPropagation();
      event.preventDefault();
    }
    console.log('[ImageDelete] Calling onNodeUpdate to remove image');

    // Clear all image-related fields including Wikipedia semantic metadata.
    // imageRef is cleared but its BLOB is deliberately left in the repo: git
    // keeps it in history regardless, so deleting reclaims nothing, and an undo
    // of this delete restores a ref that still resolves.
    const updates = {
      imageSrc: null,
      thumbnailSrc: null,
      imageRef: null,
      imageRefExt: null,
      imageAspectRatio: null,
      semanticMetadata: {
        ...(nodeData.semanticMetadata || {}),
        wikipediaOriginalImage: null,
        wikipediaThumbnail: null
      }
    };

    onNodeUpdate(updates);

    // Clear from image cache to update canvas immediately. Cancel rather than
    // plain-clear so an enrichment fetch still in flight can't repopulate it a
    // moment after the delete.
    if (nodeData?.id) {
      cancelThumbnailFetch(nodeData.id);
    }
  };

  const savedNodeIds = useGraphStore((state) => state.savedNodeIds);
  const toggleSavedNode = useGraphStore((state) => state.toggleSavedNode);

  if (!nodeData) {
    return (
      <div style={{ padding: '10px', color: theme.canvas.textSecondary, fontFamily: "'EmOne', sans-serif" }}>
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
          color={expandButtonDisabled ? theme.canvas.textSecondary : theme.canvas.textPrimary}
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
  const isSaved = !!(savedNodeIds && nodeData?.id && savedNodeIds.has(nodeData.id));

  const handleSemanticDiscoverySearch = () => {
    const query = nodeData?.name || '';
    if (!query.trim()) return;
    try {
      // Ask left panel to switch to Semantic Discovery; its listener runs the search
      window.dispatchEvent(new CustomEvent('openSemanticDiscovery', { detail: { query } }));
    } catch { }
  };

  const handleAskWizard = () => {
    try {
      window.dispatchEvent(new CustomEvent('rs-ask-wizard-define-node', {
        detail: { prototypeId: nodeData.id }
      }));
    } catch (err) {
      console.error('[SharedPanelContent] Failed to dispatch ask-wizard-define-node:', err);
    }
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
        fillColor={theme.canvas.textPrimary}
        hoverFillColor={accentColor}
        onClick={() => toggleSavedNode && nodeData?.id && toggleSavedNode(nodeData.id)}
        title={isSaved ? 'Remove from Saved Things' : 'Save to Saved Things'}
      />
      <PanelIconButton
        icon={TextSearch}
        onClick={handleSemanticDiscoverySearch}
        title="Search this in Semantic Discovery"
      />
      {!isHomeTab && wizardEnabled && nodeData?.id && (
        <PanelIconButton
          icon={Sparkles}
          onClick={handleAskWizard}
          title="Ask The Wizard"
        />
      )}
    </div>
  );

  return (
    <div className="shared-panel-content">
      {/* Header Section */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '8px',
        // Only matters when the buttons share this row: a long node name grows
        // to its max width and would otherwise touch the icon column.
        gap: isUltraSlim ? 0 : '12px'
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
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', alignSelf: 'center', flexShrink: 0 }}>
            {actionButtons}
            {secondaryButtons}
          </div>
        )}
      </div>

      {/* Ultra slim: the Thing's buttons under its title, above the type row,
          so they never run into the type's own buttons */}
      {isUltraSlim && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px', marginBottom: '16px' }}>
          {actionButtons}
          {secondaryButtons}
        </div>
      )}

      {/* Type Section - under title */}
      {(() => {
        // Get the type name and color
        const typePrototype = nodeData.typeNodeId && nodePrototypes
          ? nodePrototypes.get(nodeData.typeNodeId)
          : null;
        const typeName = typePrototype?.name || 'Thing';
        const typeColor = typePrototype?.color || theme.accent.primary;

        if (typeName === 'Type') {
          console.error(`[TypeRenderingBug] typeName is "Type"! nodeData.typeNodeId:`, nodeData.typeNodeId);
          console.error(`[TypeRenderingBug] typePrototype:`, typePrototype);
        }

        // Open the type in the panel and expand its definition: the same pair
        // Web Definitions uses, here acting on the type, spaced as it spaces
        // them. Beside the type pill when the panel has room, under it when it
        // doesn't.
        const typeButtons = typeActionsAvailable && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <PanelIconButton
              icon={NotebookText}
              onClick={onOpenTypeInPanel}
              disabled={!onOpenTypeInPanel}
              title={onOpenTypeInPanel ? `Open ${typeName} in panel` : 'This is its tab'}
            />
            <PanelIconButton
              icon={ArrowUpFromDot}
              onClick={typeExpandDisabled ? undefined : onExpandType}
              disabled={typeExpandDisabled}
              title={typeExpandDisabled ? `${typeName}'s Web is open` : `Expand ${typeName}'s definition`}
            />
          </div>
        );

        return (
          <div style={{
            marginBottom: isUltraSlim ? '16px' : '12px'
          }}>
            {isUltraSlim ? (
              // Ultra slim layout: "Is a" on top, type button below, its buttons under that
              <>
                <div style={{
                  marginBottom: '6px',
                  minWidth: '120px',
                  whiteSpace: 'nowrap'
                }}>
                  <span style={{
                    fontSize: '0.9rem',
                    color: theme.canvas.textSecondary,
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
                      backgroundColor: typeColor,
                      color: getTextColor(typeColor, theme.darkMode),
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
                  {typeButtons && <div style={{ marginTop: '10px' }}>{typeButtons}</div>}
                </div>

              </>
            ) : (
              // Normal layout: "Is a" and type button inline, the type's buttons
              // to their right, wrapping under them when the row runs out
              <div style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                // 14px plus the icon button's own 6px padding puts the first icon
                // as far from the pill as the two icons are from each other
                columnGap: '14px',
                rowGap: '10px'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  whiteSpace: 'nowrap'
                }}>
                  <span style={{
                    fontSize: '0.9rem',
                    color: theme.canvas.textSecondary,
                    fontFamily: "'EmOne', sans-serif"
                  }}>
                    Is {getArticleFor(typeName)}
                  </span>
                  <button
                    onClick={() => onTypeSelect && onTypeSelect(nodeData.id)}
                    style={{
                      backgroundColor: typeColor,
                      color: getTextColor(typeColor, theme.darkMode),
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
                {typeButtons}
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
              ref={(el) => {
                // Size the box to fit the existing bio on mount, otherwise a
                // long bio opens at the fixed `rows` height (a few lines).
                if (el) {
                  el.style.height = 'auto';
                  el.style.height = Math.max(el.scrollHeight + 4, 40) + 'px';
                }
              }}
              style={{
                width: '100%',
                padding: '8px 12px 12px 12px',
                border: `3px solid ${theme.canvas.textPrimary}`,
                borderRadius: '12px',
                fontSize: '1.0rem',
                fontFamily: "'EmOne', sans-serif",
                lineHeight: '1.4',
                backgroundColor: 'transparent',
                outline: 'none',
                color: theme.canvas.textPrimary,
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
            {...bioDoubleTap}
            style={{
              marginRight: '15px',
              padding: '8px',
              fontSize: '1.0rem',
              fontFamily: "'EmOne', sans-serif",
              lineHeight: '1.4',
              color: bio ? theme.canvas.textPrimary : theme.canvas.textSecondary,
              cursor: 'pointer',
              borderRadius: '4px',
              minHeight: '20px',
              userSelect: 'text',
              textAlign: 'left'
            }}
            title="Double-click to edit"
          >
            {bio || 'Double-click to add a bio...'}
          </div>
        )}

        {/* Wikipedia Enrichment - moved inside Bio section */}
        <div style={{ marginTop: '12px' }}>
          <WikipediaEnrichment
            nodeData={enrichmentNodeData}
            onUpdateNode={handleEnrichmentUpdate}
            triggerRef={wikiSearchRef}
            onSearchingChange={setWikiIsSearching}
          />
        </div>
      </CollapsibleSection>

      {/* Dividing line above Image section */}
      <StandardDivider margin="20px 0" />

      {/* Image Section — always visible; shows image or empty state */}
      {(() => {
        // An imageRef counts as having an image even before its blob has been
        // fetched: the section must reserve space and show the loading state
        // rather than flashing the "no image" empty state on every panel open.
        const hasImage = !!(nodeData.imageSrc || nodeData.imageRef || nodeData.semanticMetadata?.wikipediaOriginalImage || nodeData.semanticMetadata?.wikipediaThumbnail);
        // A resolved blob outranks the inline thumbnail: both may be present
        // mid-migration, and the full-resolution original is what this section
        // is for.
        // Each candidate goes through safeImageSrc, so one the browser
        // shouldn't load (an SVG data URL, a file: path) falls through to the
        // next rather than blanking the section.
        const resolvedImageSrc = [
          nodeData.imageSrc,
          resolvedRefSrc,
          nodeData.semanticMetadata?.wikipediaOriginalImage,
          cachedImage?.thumbnailSrc,
          nodeData.thumbnailSrc,
          nodeData.semanticMetadata?.wikipediaThumbnail
        ].map(safeImageSrc).find(Boolean) || null;
        // Same precedence as the src above: whichever source wins should size
        // the box, or the reserved space is wrong and the panel still jumps.
        const resolvedAspectRatio =
          nodeData.imageAspectRatio ||
          cachedImage?.imageAspectRatio ||
          nodeData.semanticMetadata?.imageAspectRatio ||
          null;
        return (
          <CollapsibleSection
            title={(
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>Image</span>
              </span>
            )}
            rightAdornment={hasImage ? (
              <PanelIconButton
                icon={Trash2}
                size={14}
                onClick={handleImageDelete}
                title="Delete image"
              />
            ) : undefined}
            defaultExpanded={true}
          >
            {hasImage && resolvedImageSrc && (
              // Keyed on the src so a different image is a different element:
              // see PanelImage for why reusing one <img> shows the outgoing
              // node's picture until the incoming one decodes.
              <PanelImage
                key={resolvedImageSrc}
                src={resolvedImageSrc}
                alt={nodeData.name}
                aspectRatio={resolvedAspectRatio}
              />
            )}
            {/* An image the graph says exists but that we have nothing to draw
                yet: a ref whose blob is still being fetched, or one that could
                not be fetched at all. Without this branch the section renders
                EMPTY — no image, no explanation, and not even the "no image"
                empty state, because hasImage is true. */}
            {hasImage && !resolvedImageSrc && (
              imageRef && !refResolutionFailed ? (
                <div style={{
                  width: '100%',
                  aspectRatio: resolvedAspectRatio ? `1 / ${resolvedAspectRatio}` : '1 / 1',
                  borderRadius: '6px',
                  overflow: 'hidden',
                  position: 'relative',
                  background: '#cfcfcf'
                }}>
                  <PanelImageShimmer />
                </div>
              ) : (
                <div style={{
                  marginRight: '15px',
                  color: theme.canvas.textSecondary,
                  fontSize: '0.9rem',
                  fontFamily: "'EmOne', sans-serif",
                  textAlign: 'left',
                  padding: '20px 0 20px 15px'
                }}>
                  This image couldn't be loaded.<br />
                  {imageRef
                    ? 'Its file is missing from the connected repository.'
                    : 'The source it points to is unreachable.'}
                </div>
              )
            )}
            {!hasImage && imageLoading && (
              <div style={{
                width: '100%',
                aspectRatio: '1 / 1',
                borderRadius: '6px',
                overflow: 'hidden',
                position: 'relative',
                background: '#cfcfcf'
              }}>
                <PanelImageShimmer />
              </div>
            )}
            {!hasImage && !imageLoading && (
              <div style={{
                marginRight: '15px',
                color: theme.canvas.textSecondary,
                fontSize: '0.9rem',
                fontFamily: "'EmOne', sans-serif",
                textAlign: 'left',
                padding: '20px 0 20px 15px'
              }}>
                No image uploaded.<br />Upload or pull from Wikipedia.
              </div>
            )}
            {!hasImage && !imageLoading && (
              <PanelIconButton
                icon={BookOpen}
                size={12}
                label={wikiIsSearching ? 'Searching Wikipedia...' :
                  nodeData.semanticMetadata?.wikipediaUrl ? 'Pull from Linked Wikipedia' : 'Pull from Wikipedia'}
                labelFontSize={11}
                variant="outline"
                color={accentColor}
                onClick={() => wikiSearchRef.current?.()}
                disabled={wikiIsSearching}
                style={{
                  borderColor: accentColor,
                  cursor: wikiIsSearching ? 'wait' : 'pointer',
                  marginLeft: '15px',
                  marginBottom: '10px'
                }}
              />
            )}
          </CollapsibleSection>
        );
      })()}

      {/* Dividing line above About section */}
      <StandardDivider margin="20px 0" />

      {/* About: what other systems call this subject, and where it came from.
          Replaces the old Origin section, which rendered the same externalLinks
          array as Semantic Web's External References card and split into two
          mutually exclusive branches — so a semantic node never saw its links
          and an ordinary node never saw its provenance. */}
      <CollapsibleSection
        title="About"
        defaultExpanded={true}
        rightAdornment={
          <InfoPopover label="What is this section?" size={14}>
            {ABOUT_INTRO}
          </InfoPopover>
        }
      >
        <AboutSection
          nodeData={nodeData}
          onNodeUpdate={onNodeUpdate}
          isHomeTab={isHomeTab}
          graphData={graphData}
          isUltraSlim={isUltraSlim}
        />
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
                key={node.id}
                node={node}
                onOpenNode={onOpenNode}
              />
            ))}
          </div>
        ) : (
          <div style={{
            marginRight: '15px',
            color: theme.canvas.textSecondary,
            fontSize: '0.9rem',
            fontFamily: "'EmOne', sans-serif",
            textAlign: 'left',
            padding: '20px 0 20px 15px'
          }}>
            This {isHomeTab ? 'graph' : 'prototype'} is not yet a component of other definitions.
          </div>
        )}
      </CollapsibleSection>

      {/* Dividing line above Web Definitions section */}
      <StandardDivider margin="20px 0" />

      {/* Web Definitions: the Webs that define this Thing, for skimming — each
          drawn as the decompose preview draws it, with its own description. */}
      <CollapsibleSection
        title="Web Definitions"
        count={definitionGraphIds.length}
        defaultExpanded={true}
      >
        <WebDefinitionsSection
          nodeData={nodeData}
          definitionGraphIds={definitionGraphIds}
          definitionIndex={definitionIndex}
          currentDefinitionId={currentDefinitionId}
          onDefinitionIndexChange={onDefinitionIndexChange}
          onAddDefinition={onAddDefinition}
          onDeleteDefinition={onDeleteDefinition}
          onOpenDefinition={onOpenDefinition}
          onOpenDefinitionInPanel={onOpenDefinitionInPanel}
          onUpdateDescription={onUpdateDefinitionDescription}
          canEdit={canEditDefinitions}
          activeGraphId={activeGraphId}
          subjectWebId={subjectWebId}
          isUltraSlim={isUltraSlim}
        />
      </CollapsibleSection>

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
          <>
            <div style={{
              marginRight: '15px',
              color: theme.canvas.textSecondary,
              fontSize: '0.9rem',
              fontFamily: "'EmOne', sans-serif",
              textAlign: 'left',
              padding: '20px 0 20px 15px'
            }}>
              No components in this {isHomeTab ? 'graph' : 'definition'}.
            </div>
            {!isHomeTab && wizardEnabled && nodeData?.id && (
              // The margins live on the row rather than the button so the info
              // button sits on the same baseline instead of below it.
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                marginLeft: '15px',
                marginBottom: '10px'
              }}>
                <PanelIconButton
                  icon={Sparkles}
                  size={12}
                  label="Ask The Wizard"
                  labelFontSize={11}
                  variant="outline"
                  color={accentColor}
                  onClick={() => {
                    try {
                      window.dispatchEvent(new CustomEvent('rs-ask-wizard-define-node', {
                        detail: { prototypeId: nodeData.id }
                      }));
                    } catch (err) {
                      console.error('[SharedPanelContent] Failed to dispatch ask-wizard-define-node:', err);
                    }
                  }}
                  style={{ borderColor: accentColor }}
                />
                <InfoPopover label="About Ask The Wizard" size={13}>
                  {WIZARD_DEFINE_INTRO}
                </InfoPopover>
              </div>
            )}
          </>
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
          isUltraSlim={isUltraSlim}
        />
      </CollapsibleSection>

      {/* Dividing line above Semantic Web section */}
      <StandardDivider margin="20px 0" />

      {/* Semantic Web: how this Thing maps onto shared vocabularies. External
          references used to live here too, which is what made the name
          confusing — ordinary link management filed under an ontology heading.
          Those moved to About; what's left is genuinely semantic-web work. */}
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
