/**
 * crop/library_modal.js  –  Fullscreen image browser for input folder.
 */
import { overlay } from "../library/popups.js";
import { apiGet } from "../library/api.js";

const THUMBNAIL_SIZE = 150;
const THUMBNAIL_GAP = 8;
const IMAGES_PER_ROW = 6;
const IMAGES_PER_LOAD = 100; // Load 100 images at a time for infinity scroll

// Sort options
const SORT_OPTIONS = [
  { name: "Name (A-Z)", key: "name", order: "asc" },
  { name: "Name (Z-A)", key: "name", order: "desc" },
  { name: "Date (Newest)", key: "date", order: "desc" },
  { name: "Date (Oldest)", key: "date", order: "asc" },
  { name: "Size (Largest)", key: "size", order: "desc" },
  { name: "Size (Smallest)", key: "size", order: "asc" },
];

/**
 * Show a fullscreen modal for browsing and selecting images from the input folder.
 * @param {(filename: string) => void} onImageSelect - Callback when an image is selected
 */
export async function showLibraryModal(onImageSelect) {
  const ov = overlay(() => ov.remove());

  // Modal container
  const modal = document.createElement("div");
  modal.style.cssText = `
    background: #1e1e1e;
    border: 1px solid #3a3a3a;
    border-radius: 8px;
    width: 90vw;
    height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 16px 60px rgba(0,0,0,0.9);
  `;
  modal.addEventListener("click", (e) => e.stopPropagation());

  // Header with title, tabs, search and sort
  const header = document.createElement("div");
  header.style.cssText = `
    padding: 16px;
    border-bottom: 1px solid #2e2e2e;
    display: flex;
    flex-direction: column;
    gap: 12px;
  `;

  // Top row: title and tabs
  const headerTop = document.createElement("div");
  headerTop.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
  `;

  const title = document.createElement("h2");
  title.textContent = "Select Image";
  title.style.cssText = "margin: 0; font-size: 16px; color: #ccc;";

  // Tab container
  const tabContainer = document.createElement("div");
  tabContainer.style.cssText = `
    display: flex;
    background: #141414;
    border-radius: 5px;
    padding: 2px;
    gap: 2px;
  `;

  let currentFolder = "input"; // Track current folder selection

  // Input tab
  const inputTab = document.createElement("button");
  inputTab.textContent = "Input";
  inputTab.style.cssText = `
    background: #3a3a3a;
    border: none;
    color: #ddd;
    padding: 6px 16px;
    font-size: 12px;
    cursor: pointer;
    border-radius: 3px;
    font-weight: 500;
  `;

  // Output tab
  const outputTab = document.createElement("button");
  outputTab.textContent = "Output";
  outputTab.style.cssText = `
    background: transparent;
    border: none;
    color: #888;
    padding: 6px 16px;
    font-size: 12px;
    cursor: pointer;
    border-radius: 3px;
  `;

  const updateTabStyles = () => {
    if (currentFolder === "input") {
      inputTab.style.background = "#3a3a3a";
      inputTab.style.color = "#ddd";
      outputTab.style.background = "transparent";
      outputTab.style.color = "#888";
    } else {
      outputTab.style.background = "#3a3a3a";
      outputTab.style.color = "#ddd";
      inputTab.style.background = "transparent";
      inputTab.style.color = "#888";
    }
  };

  const closeButton = document.createElement("button");
  closeButton.textContent = "✕";
  closeButton.style.cssText = `
    background: none;
    border: none;
    color: #666;
    font-size: 18px;
    cursor: pointer;
    padding: 4px;
  `;
  closeButton.onclick = () => ov.remove();

  headerTop.append(title, tabContainer, closeButton);
  tabContainer.append(inputTab, outputTab);

  // Bottom row: search and sort
  const headerBottom = document.createElement("div");
  headerBottom.style.cssText = `
    display: flex;
    gap: 12px;
    align-items: center;
  `;

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "Search images...";
  searchInput.style.cssText = `
    flex: 1;
    background: #141414;
    border: 1px solid #3a3a3a;
    border-radius: 5px;
    color: #ddd;
    padding: 8px 12px;
    font-size: 13px;
  `;

  // Sort dropdown
  const sortSelect = document.createElement("select");
  sortSelect.style.cssText = `
    background: #141414;
    border: 1px solid #3a3a3a;
    border-radius: 5px;
    color: #ddd;
    padding: 8px 12px;
    font-size: 13px;
    cursor: pointer;
  `;
  SORT_OPTIONS.forEach((opt, i) => {
    const option = document.createElement("option");
    option.value = i;
    option.textContent = opt.name;
    sortSelect.appendChild(option);
  });

  headerBottom.append(searchInput, sortSelect);
  header.append(headerTop, headerBottom);

  // Gallery container
  const gallery = document.createElement("div");
  gallery.style.cssText = `
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: grid;
    grid-template-columns: repeat(${IMAGES_PER_ROW}, ${THUMBNAIL_SIZE}px);
    gap: ${THUMBNAIL_GAP}px;
    justify-content: center;
    align-content: start;
  `;

  modal.append(header, gallery);
  ov.appendChild(modal);
  document.body.appendChild(ov);

  // Load and render images
  let allImages = [];
  let loadedCount = 0;
  let isLoadingMore = false;

  /**
   * Load images from API based on current folder.
   */
  async function loadImages() {
    try {
      const endpoint = currentFolder === "input"
        ? "/steaked/crop/input_images"
        : "/steaked/crop/output_images";

      const data = await apiGet(endpoint);
      allImages = data.images || [];
      loadedCount = 0;
      return true;
    } catch (err) {
      console.error(`Failed to load ${currentFolder} images:`, err);
      gallery.innerHTML = `<div style="color: #666; padding: 20px;">Failed to load images</div>`;
      return false;
    }
  }

  // Image cache for performance
  const imageCache = new Map();

  // Initial load
  const success = await loadImages();
  if (!success) return;

  /**
   * Sort images based on current sort option.
   */
  function sortImages(images, sortIndex) {
    const sortOption = SORT_OPTIONS[sortIndex];
    const sorted = [...images];

    switch (sortOption.key) {
      case "name":
        sorted.sort((a, b) => {
          const cmp = a.display_name.localeCompare(b.display_name, undefined, { numeric: true });
          return sortOption.order === "asc" ? cmp : -cmp;
        });
        break;
      case "date":
        sorted.sort((a, b) => {
          const cmp = a.modified - b.modified;
          return sortOption.order === "asc" ? cmp : -cmp;
        });
        break;
      case "size":
        sorted.sort((a, b) => {
          const cmp = a.size - b.size;
          return sortOption.order === "asc" ? cmp : -cmp;
        });
        break;
    }

    return sorted;
  }

  /**
   * Format file size for display.
   */
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  /**
   * Format date for display.
   */
  function formatDate(timestamp) {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;

    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  /**
   * Create thumbnail element.
   */
  function createThumbnail(img) {
    const container = document.createElement("div");
    container.style.cssText = `
      width: ${THUMBNAIL_SIZE}px;
      height: ${THUMBNAIL_SIZE + 40}px;
      cursor: pointer;
      border-radius: 6px;
      overflow: hidden;
      background: #141414;
      border: 1px solid #2a2a2a;
      transition: all 0.15s;
    `;

    container.addEventListener("mouseenter", () => {
      container.style.borderColor = "#4a4a4a";
      container.style.background = "#1a1a1a";
    });
    container.addEventListener("mouseleave", () => {
      container.style.borderColor = "#2a2a2a";
      container.style.background = "#141414";
    });

    // Image element
    const imgEl = document.createElement("img");
    imgEl.style.cssText = `
      width: ${THUMBNAIL_SIZE}px;
      height: ${THUMBNAIL_SIZE}px;
      object-fit: cover;
      background: #252525;
    `;
    imgEl.alt = img.display_name;

    // Load image with caching
    if (imageCache.has(img.filename)) {
      imgEl.src = img.url;
    } else {
      imgEl.src = img.url;
      imgEl.onload = () => imageCache.set(img.filename, img.url);
    }

    // Handle load error
    imgEl.onerror = () => {
      imgEl.style.background = "#1a1a1a";
      imgEl.alt = "Failed to load";
    };

    // Info bar (filename + date/size)
    const infoBar = document.createElement("div");
    infoBar.style.cssText = `
      padding: 4px 6px;
      font-size: 9px;
      color: #888;
      display: flex;
      flex-direction: column;
      gap: 1px;
      background: #141414;
    `;

    const nameEl = document.createElement("div");
    nameEl.textContent = img.display_name;
    nameEl.style.cssText = `
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: #ccc;
    `;

    const metaEl = document.createElement("div");
    metaEl.textContent = `${formatDate(img.modified)} • ${formatSize(img.size)}`;
    metaEl.style.cssText = `
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: #666;
    `;

    infoBar.append(nameEl, metaEl);
    container.append(imgEl, infoBar);
    return container;
  }

  /**
   * Filter and render function.
   * @param {boolean} firstBatch - If true, only render first batch for infinity scroll
   */
  function render(firstBatch = false, filter = "", sortIndex = 0) {
    gallery.innerHTML = "";

    // Filter by search
    let filtered = allImages.filter(img =>
      img.display_name.toLowerCase().includes(filter.toLowerCase())
    );

    // Sort
    filtered = sortImages(filtered, sortIndex);

    if (filtered.length === 0) {
      gallery.innerHTML = `<div style="color: #666; grid-column: 1/-1; text-align: center; padding: 40px;">No images found</div>`;
      return;
    }

    // Show image count
    const countLabel = document.createElement("div");
    countLabel.style.cssText = `
      grid-column: 1/-1;
      color: #666;
      font-size: 11px;
      padding: 4px;
      text-align: center;
    `;
    countLabel.textContent = `${filtered.length} image${filtered.length !== 1 ? "s" : ""}`;
    gallery.appendChild(countLabel);

    // Determine how many images to render
    const renderCount = firstBatch ? Math.min(IMAGES_PER_LOAD, filtered.length) : filtered.length;

    for (let i = 0; i < renderCount; i++) {
      const img = filtered[i];
      const thumb = createThumbnail(img);
      thumb.onclick = () => {
        // Include folder type in the filename (format: "folder_type:filename")
        const fullFilename = `${currentFolder}:${img.filename}`;
        onImageSelect(fullFilename);
        ov.remove();
      };
      gallery.appendChild(thumb);
    }

    // Update loaded count
    loadedCount = renderCount;

    // If there are more images and we're doing first batch, show "scroll for more" indicator
    if (firstBatch && filtered.length > IMAGES_PER_LOAD) {
      const moreIndicator = document.createElement("div");
      moreIndicator.style.cssText = `
        grid-column: 1/-1;
        text-align: center;
        padding: 20px;
        color: #666;
        font-size: 11px;
      `;
      moreIndicator.textContent = `↓ Scroll to load more (${filtered.length - IMAGES_PER_LOAD} remaining)`;
      gallery.appendChild(moreIndicator);
    }
  }

  /**
   * Load more images for infinity scroll.
   */
  async function loadMoreImages() {
    if (isLoadingMore || loadedCount >= allImages.length) return;

    isLoadingMore = true;

    // Show loading indicator
    const loadingIndicator = document.createElement("div");
    loadingIndicator.id = "loading-more";
    loadingIndicator.style.cssText = `
      grid-column: 1/-1;
      text-align: center;
      padding: 20px;
      color: #888;
      font-size: 12px;
    `;
    loadingIndicator.textContent = "Loading more images...";
    gallery.appendChild(loadingIndicator);

    // Wait a bit for UI update
    await new Promise(resolve => setTimeout(resolve, 100));

    // Load next batch
    const filter = searchInput.value.toLowerCase();
    const sortIndex = sortSelect.value;

    let filtered = allImages.filter(img =>
      img.display_name.toLowerCase().includes(filter)
    );
    filtered = sortImages(filtered, sortIndex);

    // Remove loading indicator
    const loading = gallery.querySelector("#loading-more");
    if (loading) loading.remove();

    // Append new thumbnails
    const startIdx = loadedCount;
    const endIdx = Math.min(loadedCount + IMAGES_PER_LOAD, filtered.length);

    for (let i = startIdx; i < endIdx; i++) {
      const img = filtered[i];
      const thumb = createThumbnail(img);
      thumb.onclick = () => {
        const fullFilename = `${currentFolder}:${img.filename}`;
        onImageSelect(fullFilename);
        ov.remove();
      };
      gallery.appendChild(thumb);
    }

    loadedCount = endIdx;
    isLoadingMore = false;
  }

  /**
   * Check if we need to load more images (infinity scroll).
   */
  function checkScrollForMore() {
    const scrollThreshold = 100; // Load more when 100px from bottom
    const scrollTop = gallery.scrollTop;
    const scrollHeight = gallery.scrollHeight;
    const clientHeight = gallery.clientHeight;

    if (scrollHeight - scrollTop - clientHeight < scrollThreshold) {
      loadMoreImages();
    }
  }

  // Initial render (first batch)
  render(true);

  // Add scroll listener for infinity scroll
  gallery.addEventListener("scroll", checkScrollForMore);

  // Search handler
  searchInput.addEventListener("input", (e) => {
    render(true, e.target.value, sortSelect.value);
  });

  // Sort handler
  sortSelect.addEventListener("change", (e) => {
    render(true, searchInput.value, e.target.value);
  });

  // Tab click handlers
  inputTab.addEventListener("click", async () => {
    if (currentFolder === "input") return;

    currentFolder = "input";
    updateTabStyles();

    // Clear gallery and reload images
    gallery.innerHTML = `<div style="color: #666; padding: 20px; text-align: center;">Loading...</div>`;

    const success = await loadImages();
    if (success) {
      render(true, searchInput.value, sortSelect.value);
    }
  });

  outputTab.addEventListener("click", async () => {
    if (currentFolder === "output") return;

    currentFolder = "output";
    updateTabStyles();

    // Clear gallery and reload images
    gallery.innerHTML = `<div style="color: #666; padding: 20px; text-align: center;">Loading...</div>`;

    const success = await loadImages();
    if (success) {
      render(true, searchInput.value, sortSelect.value);
    }
  });

  // Focus search input
  setTimeout(() => searchInput.focus(), 100);
}
