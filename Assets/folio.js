/* Native bridge, reading workspace and PDF.js integration. No remote assets. */
(() => {
  'use strict';
  const post = message => chrome.webview.postMessage(message);
  const pending = new Map();
  let app, activeName = '', busy = false, savePromise = null, revision = 0, savedRevision = 0;
  let theme = 'light', toastTimer, restorePage = 1, pageTimer;
  let savedHash = '', lastHash = '';
  const $ = id => document.getElementById(id);
  const rpc = (type, data = {}) => new Promise((resolve, reject) => {
    const id = crypto.randomUUID(); pending.set(id, { resolve, reject }); post({ type, id, ...data });
  });
  chrome.webview.addEventListener('message', ({ data }) => {
    if (data.id && pending.has(data.id)) {
      const task = pending.get(data.id); pending.delete(data.id);
      data.error ? task.reject(new Error(data.error)) : task.resolve(data.result);
    } else if (data.type === 'state') {
      renderRecent(data.recent || []); setTheme(data.theme || 'light', false);
    }
  });
  function toast(text, duration = 4500) {
    clearTimeout(toastTimer); $('folioToast').textContent = text; $('folioToast').hidden = false;
    toastTimer = setTimeout(() => $('folioToast').hidden = true, duration);
  }
  function setTheme(value, persist = true) {
    theme = value; document.documentElement.dataset.folioTheme = value;
    document.documentElement.style.setProperty('color-scheme', value);
    if (persist) post({ type: 'theme', theme });
  }
  function renderRecent(files) {
    $('recentList').replaceChildren();
    $('libraryCount').textContent = $('recentCount').textContent = files.length;
    $('emptyRecent').hidden = files.length > 0;
    // Explicit display avoids authored flex styles overriding the hidden attribute.
    $('emptyRecent').style.display = files.length ? 'none' : '';
    $('clearRecent').hidden = !files.length;
    for (const file of files) {
      const item = document.createElement('button'); item.className = 'recentItem'; item.title = file.Path;
      const icon = document.createElement('span'); icon.className = 'recentIcon'; icon.textContent = 'PDF';
      const text = document.createElement('span'); text.className = 'recentText';
      const name = document.createElement('span'); name.className = 'recentName'; name.textContent = file.Name;
      const path = document.createElement('span'); path.className = 'recentPath'; path.textContent = file.Path;
      const meta = document.createElement('span'); meta.className = 'recentMeta'; meta.textContent = `Page ${file.Page || 1}${file.Pages ? ' of ' + file.Pages : ''}`;
      const arrow = document.createElement('span'); arrow.className = 'recentArrow'; arrow.textContent = '↗';
      text.append(name, path); item.append(icon, text, meta, arrow);
      item.onclick = () => post({ type: 'recent', path: file.Path }); $('recentList').append(item);
    }
  }
  const annotationHash = () => {
    const data = app?.pdfDocument?.annotationStorage.serializable;
    if (!data?.map) return '';
    // Undo can restore entries in a different insertion order. Compare their
    // content in key order, and release temporary bitmap clones from serialize.
    const entries = [...data.map].map(([key, value]) => {
      const { bitmap, ...content } = value;
      bitmap?.close?.();
      return [key, content];
    }).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return JSON.stringify(entries);
  };
  function dirty() { return !!app?.pdfDocument && annotationHash() !== savedHash; }
  function updateDirty() { $('changeBadge').hidden = !dirty(); }
  async function canClose() {
    if (busy) { toast('Please wait for the document to finish loading.'); return false; }
    await window.Folio?.signatures?.flushInline();
    app?.pdfViewer._layerProperties.annotationEditorUIManager?.endCurrentEditing();
    if (savePromise) await savePromise;
    if (!dirty()) return true;
    const choice = await rpc('confirmChanges');
    if (choice === 'cancel') return false;
    return choice === 'save' ? await save() : true;
  }
  function save() {
    if (savePromise) return savePromise;
    savePromise = saveImpl().finally(() => { savePromise = null; }); return savePromise;
  }
  async function saveImpl() {
    if (!app.pdfDocument || busy) return false;
    try {
      await window.Folio?.signatures?.flushInline();
      app.pdfViewer._layerProperties.annotationEditorUIManager?.endCurrentEditing();
      const accepted = await rpc('saveStart', { name: activeName || 'document.pdf' });
      if (!accepted) return false;
      const savingRevision = revision, savingHash = annotationHash();
      const bytes = app.pdfDocument.annotationStorage.size ? await app.pdfDocument.saveDocument() : await app.pdfDocument.getData();
      for (let offset = 0; offset < bytes.length; offset += 262144) {
        const chunk = bytes.subarray(offset, offset + 262144);
        const parts = [];
        for (let i = 0; i < chunk.length; i += 8192) parts.push(String.fromCharCode(...chunk.subarray(i, i + 8192)));
        await rpc('saveChunk', { data: btoa(parts.join('')) });
      }
      await rpc('saveEnd'); savedRevision = savingRevision; savedHash = savingHash; updateDirty(); updateStatus(); toast('PDF copy saved.'); return true;
    } catch (error) {
      await rpc('saveCancel').catch(() => {}); toast('Could not save: ' + error.message, 10000); return false;
    }
  }
  async function closeDocument() {
    if (!await canClose()) return false;
    window.Folio?.signatures?.reset();
    clearTimeout(pageTimer);
    if (app.pdfDocument) post({ type: 'page', page: app.page });
    // Folio owns the save/discard decision; PDF.js must not start a second download.
    app._annotationStorageModified = false;
    await app.close(); post({ type: 'releaseStreams' }); revision = savedRevision = 0; savedHash = lastHash = ''; updateDirty(); activeName = '';
    document.body.dataset.view = 'home'; $('documentName').textContent = 'Your reading space';
    clearTimeout(toastTimer); $('folioToast').hidden = true;
    $('footerStatus').textContent = 'Local files. Open possibilities.';
    post({ type: 'title', name: 'PDF Reader' }); post({ type: 'detached' }); return true;
  }
  async function openDocument({ url, name, page = 1, data }) {
    if (busy || !await canClose()) return false;
    window.Folio?.signatures?.reset();
    clearTimeout(pageTimer);
    if (app.pdfDocument) post({ type: 'page', page: app.page });
    busy = true;
    try {
      app._annotationStorageModified = false; await app.close(); post({ type: 'releaseStreams' });
      revision = savedRevision = 0; savedHash = lastHash = ''; updateDirty(); restorePage = page;
      activeName = name; $('documentName').textContent = name; document.body.dataset.view = 'reader';
      $('footerStatus').textContent = 'Opening document…';
      post(data ? { type: 'detached' } : { type: 'activated', url });
      post({ type: 'title', name });
      await app.open(data ? { data, filename: name, isEvalSupported: false, enableXfa: false } : { url, originalUrl: url, disableRange: true, isEvalSupported: false, enableXfa: false });
      await app.pdfViewer.firstPagePromise;
      for (let attempt = 0; attempt < 100 && !app.isInitialViewSet; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
      await Promise.race([app.pdfViewer.pagesPromise, new Promise(resolve => setTimeout(resolve, 10000))]);
      // The upstream viewer applies a second initial view for mixed page sizes.
      // Restore only once that has settled, so it cannot override a page change.
      await new Promise(resolve => setTimeout(resolve, 0));
      app.page = Math.min(Math.max(1, page), app.pagesCount);
      app._contentDispositionFilename = name;
      updateStatus();
      return true;
    } catch (error) {
      app._annotationStorageModified = false; await app.close();
      document.body.dataset.view = 'home'; activeName = '';
      post({ type: 'detached' });
      $('documentName').textContent = 'Your reading space'; $('footerStatus').textContent = 'Could not open document';
      post({ type: 'title', name: 'PDF Reader' });
      toast('Could not open this PDF. It may be damaged or unsupported. ' + error.message, 12000); return false;
    } finally { busy = false; }
  }
  async function drop(event) {
    event.preventDefault(); event.stopImmediatePropagation(); $('dropZone').classList.remove('dragging');
    const file = event.dataTransfer.files[0];
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { toast('Choose a PDF document.'); return; }
    // WebView2 intentionally hides dropped local paths. Browser File handles keep
    // the file local; these documents can be saved but are not added to recents.
    if (busy) return;
    await openDocument({ data: new Uint8Array(await file.arrayBuffer()), name: file.name });
  }
  function updateStatus() {
    if (!app?.pdfDocument) return;
    const scale = Math.round(app.pdfViewer.currentScale * 100);
    $('footerStatus').textContent = `Page ${app.page} of ${app.pagesCount}  ·  ${scale}%  ·  ${dirty() ? 'Unsaved changes' : 'Ready to read'}`;
  }
  function setupUi() {
    for (const id of ['headerOpen', 'heroOpen']) $(id).onclick = event => { event.stopPropagation(); post({ type: 'open' }); };
    $('dropZone').onclick = () => post({ type: 'open' });
    $('dropZone').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); post({ type: 'open' }); } };
    $('homeButton').onclick = closeDocument;
    $('sampleButton').onclick = () => post({ type: 'sample' });
    $('clearRecent').onclick = () => post({ type: 'clearRecent' });
    $('themeButton').onclick = () => setTheme(theme === 'light' ? 'dark' : 'light');
    $('helpButton').onclick = () => $('shortcutsDialog').showModal();
    $('closeHelp').onclick = () => $('shortcutsDialog').close();
    document.addEventListener('dragover', e => { e.preventDefault(); $('dropZone').classList.add('dragging'); }, true);
    document.addEventListener('dragleave', e => { if (!e.relatedTarget) $('dropZone').classList.remove('dragging'); }, true);
    document.addEventListener('drop', drop, true);
    document.addEventListener('click', e => {
      if (e.target.closest('#secondaryOpenFile')) { e.preventDefault(); e.stopImmediatePropagation(); post({ type: 'open' }); }
    }, true);
    window.addEventListener('keydown', e => {
      const ctrl = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
      if (ctrl && key === 'o') { e.preventDefault(); e.stopImmediatePropagation(); post({ type: 'open' }); }
      else if (ctrl && key === 's') { e.preventDefault(); e.stopImmediatePropagation(); save(); }
      else if (ctrl && key === 'w') { e.preventDefault(); e.stopImmediatePropagation(); closeDocument(); }
      else if (ctrl && e.altKey && key === 'g' && app.pdfDocument) { e.preventDefault(); e.stopImmediatePropagation(); $('pageNumber').focus(); $('pageNumber').select(); }
      else if (e.key === 'F4' && app.pdfDocument) { e.preventDefault(); e.stopImmediatePropagation(); $('viewsManagerToggleButton').click(); }
    }, true);
  }
  document.addEventListener('webviewerloaded', () => {
    const options = window.PDFViewerApplicationOptions;
    options.set('disablePreferences', true);
    options.set('defaultUrl', ''); options.set('enableScripting', false);
    options.set('enableAltTextModelDownload', false); options.set('enableGuessAltText', false);
    options.set('enableSignatureEditor', true); options.set('enableSignatureVerification', false);
    options.set('enableSplitMerge', false);
    options.set('enablePermissions', false);
    app = window.PDFViewerApplication;
    app.initializedPromise.then(() => {
      setupUi();
      app.downloadOrSave = save;
      const originalAttachmentOpen = app.downloadManager.openOrDownloadData.bind(app.downloadManager);
      app.downloadManager.openOrDownloadData = (data, name, destination) => {
        if (/\.pdf$/i.test(name)) { openDocument({ data, name }); return true; }
        return originalAttachmentOpen(data, name, destination);
      };
      const original = app._initializeAnnotationStorageCallbacks.bind(app);
      app._initializeAnnotationStorageCallbacks = pdf => {
        original(pdf);
        const callback = pdf.annotationStorage.onSetModified;
        pdf.annotationStorage.onSetModified = () => { callback?.(); revision++; updateDirty(); updateStatus(); };
        // A canceled save must not suppress later edits from the modified callback.
        const reset = pdf.annotationStorage.onResetModified;
        pdf.annotationStorage.onResetModified = () => { reset?.(); };
      };
      app.eventBus.on('documentloaded', () => {
        post({ type: 'loaded', pages: app.pagesCount }); updateStatus();
      });
      app.eventBus.on('pagechanging', () => {
        updateStatus(); clearTimeout(pageTimer);
        pageTimer = setTimeout(() => { if (app.pdfDocument) post({ type: 'page', page: app.page }); }, 300);
      });
      app.eventBus.on('scalechanging', updateStatus);
      // Editors retain mutable objects in annotationStorage. Compare serialized
      // hashes so edits or deletions after a save are also detected correctly.
      setInterval(() => {
        if (busy || !app.pdfDocument || savePromise) return;
        const hash = annotationHash();
        if (hash !== lastHash) { lastHash = hash; updateDirty(); updateStatus(); }
      }, 600);
      // Canceled password entry returns to a usable library instead of a blank viewer.
      $('passwordCancel').addEventListener('click', () => setTimeout(async () => {
        if (!app.pdfDocument) { busy = false; await closeDocument(); }
      }, 0));
      const signatures = window.FolioSignatures.initialize(app, toast, () => { updateDirty(); updateStatus(); });
      window.Folio = { open: openDocument, canClose, close: closeDocument, save, dirty, toast, setTheme, signatures,
        get app() { return app; }, get theme() { return theme; } };
      post({ type: 'ready' });
    });
  }, { once: true });
})();
