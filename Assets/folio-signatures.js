/* Local signature-image import and appearance controls. PDF.js owns page editing,
   selection, dragging, resize handles, undo/redo, and PDF stamp serialization. */
window.FolioSignatures = {
  initialize(app, toast, changed) {
    const $ = id => document.getElementById(id);
    const manager = () => app.pdfViewer._layerProperties.annotationEditorUIManager;
    const records = new WeakMap();
    const recordLoads = new WeakMap();
    let inline;
    const defaults = () => ({ color: 'original', removeWhite: true, tolerance: 28, opacity: 100, angle: 0, widthMm: 45, thickness: 0 });
    const isSignature = editor => ['stamp', 'signature'].includes(editor?.editorType);
    let source = null, settings = defaults(), editing = null, prepared = null, armed = null, rendering = false, selected = null;
    let lastSource = null, lastSettings = null, generation = 0;
    const headerButton = document.createElement('button');
    headerButton.id = 'signatureImageButton'; headerButton.className = 'openButton';
    headerButton.textContent = '✍ Signature image'; headerButton.title = 'Import a signature image, place it, and change its appearance';
    document.querySelector('.headerActions').prepend(headerButton);
    const ui = document.createElement('div');
    ui.id = 'signatureTools';
    ui.innerHTML = `
      <dialog id="signatureDialog" aria-labelledby="signatureDialogTitle">
        <div class="sigScroll">
        <div class="sigHeading"><div><div class="sigEyebrow">MAKE IT YOURS</div><h2 id="signatureDialogTitle">Your signature, your way.</h2></div><button id="signatureClose" class="quiet" aria-label="Close signature editor">×</button></div>
        <p class="sigIntro">Choose an image of your signature, then adjust its appearance.</p>
        <input id="signatureFile" type="file" accept="image/png,image/jpeg,image/webp,image/bmp,.png,.jpg,.jpeg,.webp,.bmp" hidden>
        <div class="sigImport"><button id="signatureChoose" class="sigSecondary">Choose image…</button><button id="signatureSelectExisting" class="sigSecondary">Select on PDF</button><span id="signatureFilename">PNG, JPG, WebP, or BMP</span></div>
        <select id="signatureSaved" aria-label="Use a saved signature" hidden><option value="">Use a saved signature…</option></select>
        <div id="signaturePreviewArea"><span id="signatureEmpty">Your signature preview will appear here.</span><canvas id="signaturePreview" hidden></canvas></div>
        <div id="signatureError" role="alert" hidden></div>
        <fieldset id="signatureOptions" disabled>
          <legend class="visuallyHidden">Signature appearance</legend>
          <div class="sigColorRow"><span class="sigLabel">Ink color</span><button data-sig-color="original" class="sigSwatch original" title="Original image colors">Original</button><button data-sig-color="#151515" class="sigSwatch black" aria-label="Black ink" title="Black ink"></button><button data-sig-color="#184aa0" class="sigSwatch blue" aria-label="Blue ink" title="Blue ink"></button><label class="sigCustom">Custom <input id="signatureColor" type="color" value="#184aa0" aria-label="Custom signature color"></label></div>
          <div class="sigGrid"><label>Width <span class="sigInputUnit"><input id="signatureWidth" type="number" min="5" max="250" step="1" value="45"> mm</span></label><label>Rotation <span class="sigInputUnit"><input id="signatureAngle" type="number" min="-180" max="180" step="1" value="0"> °</span></label></div>
          <label class="sigRangeLabel">Stroke thickness <output id="signatureThicknessValue">Original</output><input id="signatureThickness" type="range" min="-3" max="8" value="0" step="0.25"><span class="sigThicknessHint" id="signatureThicknessHint">Thinner ← · → Thicker</span></label>
          <label class="sigRangeLabel">Opacity <output id="signatureOpacityValue">100%</output><input id="signatureOpacity" type="range" min="10" max="100" value="100" step="1"></label>
          <label class="sigCheck"><input id="signatureRemoveWhite" type="checkbox" checked> Remove white background</label>
          <label class="sigRangeLabel" id="signatureCleanupLabel">Background cleanup <output id="signatureCleanupValue">28</output><input id="signatureCleanup" type="range" min="0" max="100" value="28" step="1"></label>
        </fieldset>
        <p class="sigHint" id="signatureHint">Click anywhere on a page to place it. Drag to move; use the corner handles to resize.</p>
        </div>
        <div class="sigFooter"><button id="signatureCancel" class="sigSecondary">Cancel</button><button id="signatureApply" class="primary" disabled>Place on PDF ↗</button></div>
      </dialog>
      <div id="signatureSelectionBar" hidden><span>Signature image <small>Drag to move · corners to resize</small></span><button id="signatureEdit">Edit appearance</button><button id="signatureAnother">Add another</button><button id="signatureDelete">Delete</button><button id="signatureDone">Done</button></div>
      <div id="signaturePlacementBar" hidden><span>Click a page to place your signature</span><button id="signaturePlacementCancel">Cancel <kbd>Esc</kbd></button></div>
      <img id="signatureGhost" alt="" hidden>
    `;
    document.body.append(ui);
    const dialog = $('signatureDialog');
    async function enterMode(mode) {
      if (app.pdfViewer.annotationEditorMode === mode && manager().getMode() === mode) return;
      if (app.pdfViewer.annotationEditorMode === mode) { await manager().updateMode(mode); return; }
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { app.eventBus.off('annotationeditormodechanged', onMode); reject(new Error('The page is still preparing for image editing. Try again.')); }, 15000);
        const onMode = event => { if (event.mode !== mode) return; clearTimeout(timeout); app.eventBus.off('annotationeditormodechanged', onMode); resolve(); };
        app.eventBus.on('annotationeditormodechanged', onMode);
        try { app.pdfViewer.annotationEditorMode = { mode }; }
        catch (error) { clearTimeout(timeout); app.eventBus.off('annotationeditormodechanged', onMode); reject(error); }
      });
    }
    const fail = message => { $('signatureError').hidden = !message; $('signatureError').textContent = message || ''; };
    function syncInputs() {
      $('signatureColor').value = settings.color === 'original' ? '#184aa0' : settings.color;
      $('signatureWidth').value = Math.round(settings.widthMm * 10) / 10;
      $('signatureAngle').value = settings.angle;
      $('signatureOpacity').value = settings.opacity;
      $('signatureRemoveWhite').checked = settings.removeWhite;
      $('signatureCleanup').value = settings.tolerance;
      $('signatureThickness').value = settings.thickness || 0;
      updateLabels();
    }
    function updateLabels() {
      $('signatureOpacityValue').value = settings.opacity + '%';
      $('signatureCleanupValue').value = settings.tolerance;
      $('signatureCleanup').disabled = !settings.removeWhite;
      const weight = settings.thickness || 0;
      $('signatureThicknessValue').value = weight === 0 ? 'Original' : (weight > 0 ? '+' : '') + weight.toFixed(2);
      $('signatureThickness').disabled = !settings.removeWhite;
      $('signatureThicknessHint').textContent = settings.removeWhite ? 'Thinner ← · → Thicker' : 'Enable background removal to adjust ink thickness.';
      document.querySelectorAll('[data-sig-color]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.sigColor === settings.color)));
    }
    function readInputs() {
      settings.widthMm = Math.min(250, Math.max(5, Number($('signatureWidth').value) || 45));
      settings.angle = Math.min(180, Math.max(-180, Number($('signatureAngle').value) || 0));
      settings.opacity = Number($('signatureOpacity').value);
      settings.removeWhite = $('signatureRemoveWhite').checked;
      settings.tolerance = Number($('signatureCleanup').value);
      settings.thickness = Number($('signatureThickness').value);
      updateLabels();
    }
    async function load(file, options = defaults()) {
      const token = ++generation;
      $('signatureApply').disabled = true;
      const loaded = await readSource(file);
      if (token !== generation) return;
      source = loaded; settings = { ...defaults(), ...options };
      $('signatureFilename').textContent = file.name; $('signatureOptions').disabled = false;
      syncInputs(); render(); return source;
    }
    async function readSource(file) {
      if (!file || file.size > 25 * 1024 * 1024) throw new Error('Choose an image smaller than 25 MB.');
      if (!/\.(png|jpe?g|webp|bmp)$/i.test(file.name)) throw new Error('Choose a PNG, JPG, WebP, or BMP image.');
      let bitmap;
      try { bitmap = await createImageBitmap(file); }
      catch { throw new Error('This image could not be read. Try a PNG or JPG.'); }
      const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      return { canvas, name: file.name };
    }
    // Separable sliding-window min/max filter, linear in the number of pixels.
    // Carry the source pixel index so thickening retains the original ink color.
    function morph(mask, width, height, radius, dilate) {
      const initial = new Uint32Array(mask.length); for (let i = 0; i < initial.length; i++) initial[i] = i;
      if (!radius) return { mask, indices: initial };
      let input = mask, indices = initial;
      for (const vertical of [false, true]) {
        const output = new Uint8Array(mask.length), outputIndices = new Uint32Array(mask.length);
        const size = vertical ? height : width, lines = vertical ? width : height;
        const queue = new Int32Array(size);
        for (let line = 0; line < lines; line++) {
          let head = 0, tail = 0, next = 0;
          const index = pos => vertical ? pos * width + line : line * width + pos;
          for (let pos = 0; pos < size; pos++) {
            const end = Math.min(size - 1, pos + radius);
            while (next <= end) {
              const value = input[index(next)];
              while (tail > head && (dilate ? input[index(queue[tail - 1])] <= value : input[index(queue[tail - 1])] >= value)) tail--;
              queue[tail++] = next++;
            }
            while (tail > head && queue[head] < pos - radius) head++;
            const picked = index(queue[head]), destination = index(pos);
            output[destination] = input[picked]; outputIndices[destination] = indices[picked];
          }
        }
        input = output; indices = outputIndices;
      }
      return { mask: input, indices };
    }
    function process(canvas, options) {
      const amount = options.removeWhite ? Math.max(-3, Math.min(8, options.thickness || 0)) : 0;
      const radius = Math.abs(amount) * canvas.width / 600;
      const paddingForInk = amount ? Math.ceil(radius) + 2 : 0;
      const out = document.createElement('canvas'); out.width = canvas.width + 2 * paddingForInk; out.height = canvas.height + 2 * paddingForInk;
      const ctx = out.getContext('2d', { willReadFrequently: true }); ctx.drawImage(canvas, paddingForInk, paddingForInk);
      const data = ctx.getImageData(0, 0, out.width, out.height), pixels = data.data;
      const color = /^#[0-9a-f]{6}$/i.test(options.color) ? [1, 3, 5].map(i => parseInt(options.color.slice(i, i + 2), 16)) : null;
      let left = out.width, top = out.height, right = -1, bottom = -1;
      for (let i = 0; i < pixels.length; i += 4) {
        const darkness = 255 - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
        const coverage = options.removeWhite ? Math.min(1, Math.max(0, (darkness - options.tolerance) / 60)) : 1;
        pixels[i + 3] = Math.round(pixels[i + 3] * coverage * options.opacity / 100);
        if (color) {
          // When retaining paper, recolor only its ink rather than turning the
          // white rectangle into a solid color. Transparent PNG ink stays solid.
          const ink = options.removeWhite || pixels[i + 3] < 250 * options.opacity / 100 ? 1 : darkness / 255;
          for (let channel = 0; channel < 3; channel++) pixels[i + channel] = Math.round(255 * (1 - ink) + color[channel] * ink);
        }
      }
      if (amount) {
        const mask = new Uint8Array(pixels.length / 4);
        for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 4 + 3];
        const low = morph(mask, out.width, out.height, Math.floor(radius), amount > 0);
        const high = radius % 1 ? morph(mask, out.width, out.height, Math.ceil(radius), amount > 0) : low;
        const mix = radius % 1, original = pixels.slice();
        for (let i = 0; i < mask.length; i++) {
          const at = i * 4, from = high.indices[i] * 4;
          pixels[at + 3] = Math.round(low.mask[i] * (1 - mix) + high.mask[i] * mix);
          for (let channel = 0; channel < 3; channel++) pixels[at + channel] = original[from + channel];
        }
      }
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] > 2) {
          const n = i / 4, x = n % out.width, y = Math.floor(n / out.width);
          left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
        }
      }
      if (right < left) throw new Error('No visible signature remains. Increase stroke thickness or reduce background cleanup.');
      ctx.putImageData(data, 0, 0);
      const cropped = document.createElement('canvas'), padding = 4;
      cropped.width = right - left + 1 + padding * 2; cropped.height = bottom - top + 1 + padding * 2;
      cropped.getContext('2d').drawImage(out, left, top, right - left + 1, bottom - top + 1, padding, padding, right - left + 1, bottom - top + 1);
      const angle = options.angle * Math.PI / 180;
      if (!angle) return cropped;
      const rotated = document.createElement('canvas');
      rotated.width = Math.ceil(Math.abs(cropped.width * Math.cos(angle)) + Math.abs(cropped.height * Math.sin(angle)));
      rotated.height = Math.ceil(Math.abs(cropped.width * Math.sin(angle)) + Math.abs(cropped.height * Math.cos(angle)));
      const rotation = rotated.getContext('2d'); rotation.translate(rotated.width / 2, rotated.height / 2); rotation.rotate(angle);
      rotation.drawImage(cropped, -cropped.width / 2, -cropped.height / 2); return rotated;
    }
    function render() {
      if (!source) return;
      try {
        fail(''); prepared = process(source.canvas, settings);
        const preview = $('signaturePreview'); preview.width = prepared.width; preview.height = prepared.height;
        preview.getContext('2d').drawImage(prepared, 0, 0); preview.hidden = false; $('signatureEmpty').hidden = true;
        $('signatureApply').disabled = false;
      } catch (error) { prepared = null; $('signatureApply').disabled = true; fail(error.message); }
    }
    function refresh() {
      readInputs();
      if (!rendering) { rendering = true; requestAnimationFrame(() => { rendering = false; render(); }); }
    }
    async function outlineToBlob(outline, areContours, strokeWidth) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const box = outline.viewBox.split(/\s+/).map(Number), width = 1400, height = Math.max(1, Math.round(width * box[3] / box[2]));
      svg.setAttribute('xmlns', svg.namespaceURI); svg.setAttribute('viewBox', outline.viewBox); svg.setAttribute('width', width); svg.setAttribute('height', height);
      const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', outline.toSVGPath());
      path.setAttribute('fill', areContours ? '#151515' : 'none'); path.setAttribute('stroke', areContours ? 'none' : '#151515');
      path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); path.setAttribute('stroke-width', strokeWidth);
      svg.append(path);
      const image = new Image(), url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
      try {
        image.src = url; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(image, 0, 0); return await toBlob(canvas);
      } finally { URL.revokeObjectURL(url); }
    }
    function refreshSavedSignatures() {
      const dropdown = $('signatureSaved'); dropdown.replaceChildren(new Option('Use a saved signature…', ''));
      try {
        const saved = JSON.parse(localStorage.getItem('pdfjs.signature') || '{}');
        for (const [id, entry] of Object.entries(saved)) dropdown.add(new Option(entry.description || 'Saved signature', id));
      } catch { /* A malformed legacy library must not prevent file imports. */ }
      dropdown.hidden = dropdown.options.length < 2;
    }
    async function show(editor = null) {
      if (!app.pdfDocument) { toast('Open a PDF before adding a signature.'); return; }
      await inline?.flush(); inline?.hide();
      cancelPlacement(); editing = editor; fail('');
      $('signatureApply').textContent = editor ? 'Apply changes' : 'Place on PDF ↗';
      $('signatureHint').textContent = editor ? 'Changes keep the signature in its current position. Drag it or use the handles after applying.' : 'Click anywhere on a page to place it. Drag to move; use the corner handles to resize.';
      if (editor) {
        let record;
        try { record = await recordFor(editor); }
        catch (error) { toast('Could not open this signature: ' + error.message); return; }
        source = record.source; settings = { ...record.settings, widthMm: editor.width * editor.pageDimensions[0] * 25.4 / 72 };
      } else if (lastSource) { source = lastSource; settings = { ...lastSettings }; }
      else { source = null; prepared = null; settings = defaults(); }
      $('signatureOptions').disabled = !source; $('signatureApply').disabled = !source;
      $('signatureFilename').textContent = source?.name || 'PNG, JPG, WebP, or BMP';
      $('signaturePreview').hidden = !source; $('signatureEmpty').hidden = !!source;
      syncInputs(); if (source) render(); refreshSavedSignatures(); dialog.showModal();
    }
    async function recordFor(editor) {
      if (records.has(editor)) return records.get(editor);
      if (recordLoads.has(editor)) return recordLoads.get(editor);
      const promise = (async () => {
        let blob;
        if (editor.editorType === 'signature') {
          const { areContours, outline } = editor.getSignaturePreview();
          const boxWidth = Number(outline.viewBox.split(/\s+/)[2]);
          blob = await outlineToBlob(outline, areContours, Math.max(.1, editor.serialize(true).thickness || 1) * boxWidth / (editor.width * editor.pageDimensions[0]));
        } else {
          const serialized = editor.serialize(true); blob = await (await fetch(serialized.bitmapUrl)).blob();
        }
        const loaded = await readSource(new File([blob], 'signature.png', { type: 'image/png' }));
        const record = { source: loaded, settings: { ...defaults(), widthMm: editor.width * editor.pageDimensions[0] * 25.4 / 72 } };
        records.set(editor, record); return record;
      })();
      recordLoads.set(editor, promise);
      try { return await promise; } finally { recordLoads.delete(editor); }
    }
    const toBlob = canvas => new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not prepare the signature.')), 'image/png'));
    async function addStamp(canvas, options, pageIndex, rect, rotation, original = null, behavior = {}) {
      const doc = app.pdfDocument, m = manager();
      await enterMode(13);
      const layer = m.getLayer(pageIndex);
      if (!layer) throw new Error('Wait for this page to finish loading, then try again.');
      const blob = await toBlob(canvas);
      const image = await m.imageManager.getFromFile(new File([blob], 'folio-signature-' + crypto.randomUUID() + '.png', { type: 'image/png' }));
      if (!image || app.pdfDocument !== doc) throw new Error('Could not load the signature into this document.');
      const editor = await layer.deserialize({ annotationType: 13, pageIndex, rect, rotation, bitmap: image.bitmap, bitmapId: image.id, isSvg: false, accessibilityData: { decorative: false, altText: 'Signature' } });
      // Keep the geometry returned by the base editor for a rotated page.
      const geometry = editor.getRectInCurrentCoords(rect, editor.pageDimensions[1]);
      editor.width = geometry[2] / editor.pageDimensions[0]; editor.height = geometry[3] / editor.pageDimensions[1];
      const registerUndo = layer.addUndoableEditor;
      const onceAdded = editor.onceAdded;
      try {
        layer.addUndoableEditor = () => {};
        if (behavior.focus === false) editor.onceAdded = function () { return onceAdded.call(this, false); };
        layer.add(editor);
      } finally { layer.addUndoableEditor = registerUndo; editor.onceAdded = onceAdded; }
      records.set(editor, { source: behavior.source || source, settings: { ...options } });
      if (original) original.remove();
      if (behavior.history !== false) m.addCommands({
        cmd: () => { original?.remove(); m.rebuild(editor); m.setSelected(editor); changed(); },
        undo: () => { editor.remove(); if (original) { m.rebuild(original); m.setSelected(original); } changed(); },
        mustExec: false
      });
      if (behavior.select !== false) m.setSelected(editor);
      changed(); updateSelection(); return editor;
    }
    function rectAt(pageView, x, y, canvas, options) {
      const vp = pageView.viewport;
      let width = options.widthMm * 72 / 25.4 * vp.scale, height = width * canvas.height / canvas.width;
      const fit = Math.min(1, vp.width / width, vp.height / height); width *= fit; height *= fit;
      const left = Math.max(0, Math.min(vp.width - width, x - width / 2));
      const top = Math.max(0, Math.min(vp.height - height, y - height / 2));
      const a = vp.convertToPdfPoint(left, top), b = vp.convertToPdfPoint(left + width, top + height);
      return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    }
    async function placeAt(pageIndex, x, y, canvas = prepared, options = settings) {
      const pageView = app.pdfViewer.getPageView(pageIndex);
      if (!canvas || !pageView) throw new Error('Choose a signature image and a PDF page.');
      return addStamp(canvas, options, pageIndex, rectAt(pageView, x, y, canvas, options), pageView.viewport.rotation);
    }
    async function applyEdit(editor = editing) {
      if (!prepared || !editor) return null;
      const rect = editor.getPDFRect(), centerX = (rect[0] + rect[2]) / 2, centerY = (rect[1] + rect[3]) / 2;
      let width = settings.widthMm * 72 / 25.4, height = width * prepared.height / prepared.width;
      if (editor.rotation % 180) [width, height] = [height, width];
      const page = (await app.pdfDocument.getPage(editor.pageIndex + 1)).view;
      const fit = Math.min(1, (page[2] - page[0]) / width, (page[3] - page[1]) / height); width *= fit; height *= fit;
      const left = Math.max(page[0], Math.min(page[2] - width, centerX - width / 2));
      const bottom = Math.max(page[1], Math.min(page[3] - height, centerY - height / 2));
      return addStamp(prepared, settings, editor.pageIndex, [left, bottom, left + width, bottom + height], editor.rotation, editor);
    }
    function cancelPlacement() {
      armed = null; document.body.classList.remove('placingSignature');
      $('signaturePlacementBar').hidden = $('signatureGhost').hidden = true;
    }
    function updateSelection() {
      const current = manager()?.firstSelectedEditor;
      selected = isSignature(current) && current.parent && !current.deleted ? current : null;
      $('signatureSelectionBar').hidden = !selected || !!armed || dialog.open || !app.pdfDocument;
      inline?.select(!armed && !dialog.open ? selected : null);
      if (selected) {
        // Put appearance beside the description/delete buttons shown by PDF.js.
        const buttons = selected.div.querySelector('.editToolbar .buttons');
        if (buttons && !buttons.querySelector('.folioAppearanceButton')) {
          const editor = selected, button = document.createElement('button');
          button.type = 'button'; button.className = 'folioAppearanceButton'; button.textContent = 'Color & thickness'; button.title = 'Show inline signature controls';
          button.onpointerdown = event => event.stopPropagation();
          button.onclick = event => { event.stopPropagation(); inline?.select(editor, true); };
          buttons.prepend(button);
        }
      }
    }
    const openSelected = () => {
      const editor = manager()?.firstSelectedEditor;
      if (isSignature(editor)) inline?.select(editor, true);
      else show().catch(error => toast(error.message));
    };
    headerButton.onclick = openSelected;
    $('signatureSaved').onchange = async () => {
      const id = $('signatureSaved').value; if (!id) return;
      try {
        const entry = JSON.parse(localStorage.getItem('pdfjs.signature') || '{}')[id];
        const { SignatureExtractor } = await import('/pdfjs/build/pdf.mjs');
        const data = await SignatureExtractor.decompressSignature(entry.signatureData);
        if (!data) throw new Error('The saved signature data is damaged.');
        const max = Math.max(data.width, data.height), lines = { ...data, curves: data.outlines.map(points => ({ points })) };
        const result = SignatureExtractor.processDrawnLines({ lines, pageWidth: max, pageHeight: max, rotation: 0, innerMargin: 0, mustSmooth: false, areContours: data.areContours });
        const boxWidth = Number(result.outline.viewBox.split(/\s+/)[2]);
        const blob = await outlineToBlob(result.outline, data.areContours, (data.thickness || 1) * boxWidth / data.width);
        const name = entry.description || 'saved-signature';
        await load(new File([blob], /\.png$/i.test(name) ? name : name + '.png', { type: 'image/png' })); fail('');
      } catch (error) { fail('Could not load the saved signature: ' + error.message); }
    };
    // The familiar document-with-pen icon now leads to the same full editor.
    document.addEventListener('click', event => {
      if (!event.target.closest('#editorSignatureButton, #editorSignatureAddSignature')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      $('editorSignatureParamsToolbar')?.classList.add('hidden'); openSelected();
    }, true);
    $('signatureSelectExisting').onclick = async () => {
      dialog.close();
      try { await enterMode(13); toast('Click an image signature, then choose Edit appearance.'); }
      catch (error) { toast(error.message); }
    };
    $('signatureChoose').onclick = () => $('signatureFile').click();
    $('signatureFile').onchange = async event => {
      const file = event.target.files[0]; event.target.value = '';
      if (file) { try { await load(file); } catch (error) { fail(error.message); } }
    };
    for (const id of ['signatureWidth', 'signatureAngle', 'signatureOpacity', 'signatureRemoveWhite', 'signatureCleanup', 'signatureThickness']) $(id).addEventListener('input', refresh);
    $('signatureColor').oninput = () => { settings.color = $('signatureColor').value; refresh(); };
    document.querySelectorAll('[data-sig-color]').forEach(button => button.onclick = () => { settings.color = button.dataset.sigColor; syncInputs(); render(); });
    for (const id of ['signatureClose', 'signatureCancel']) $(id).onclick = () => dialog.close();
    dialog.addEventListener('close', () => { generation++; updateSelection(); });
    $('signatureApply').onclick = async () => {
      readInputs(); render(); if (!prepared) return;
      $('signatureApply').disabled = true;
      try {
        lastSource = source; lastSettings = { ...settings };
        if (editing) { await applyEdit(); dialog.close(); toast('Signature updated. Drag to move or use the corner handles to resize.'); }
        else {
          await enterMode(13); manager().unselectAll();
          armed = { canvas: prepared, options: { ...settings } }; dialog.close();
          $('signatureGhost').src = prepared.toDataURL('image/png');
          $('signaturePlacementBar').hidden = false; document.body.classList.add('placingSignature'); updateSelection();
        }
      } catch (error) { fail(error.message); }
      finally { $('signatureApply').disabled = false; }
    };
    $('signatureEdit').onclick = () => selected && inline?.select(selected, true);
    $('signatureAnother').onclick = () => show();
    $('signatureDelete').onclick = async () => { await inline?.flush(); if (selected) { manager().setSelected(selected); manager().delete(); changed(); updateSelection(); } };
    $('signatureDone').onclick = async () => { await inline?.flush(); manager().unselectAll(); enterMode(0).catch(error => toast(error.message)); updateSelection(); };
    $('signaturePlacementCancel').onclick = cancelPlacement;
    document.addEventListener('pointermove', event => {
      if (!armed) return;
      const page = event.target.closest('.page'); $('signatureGhost').hidden = !page;
      if (!page) return;
      const index = Number(page.dataset.pageNumber) - 1, vp = app.pdfViewer.getPageView(index).viewport, bounds = page.getBoundingClientRect();
      const w = armed.options.widthMm * 72 / 25.4 * vp.scale * bounds.width / vp.width;
      const h = w * armed.canvas.height / armed.canvas.width;
      Object.assign($('signatureGhost').style, { width: w + 'px', height: h + 'px', left: event.clientX - w / 2 + 'px', top: event.clientY - h / 2 + 'px' });
    }, true);
    document.addEventListener('pointerdown', event => {
      if (!armed || event.button !== 0) return;
      const page = event.target.closest('.page'); if (!page) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const pending = armed, index = Number(page.dataset.pageNumber) - 1, vp = app.pdfViewer.getPageView(index).viewport, bounds = page.getBoundingClientRect();
      cancelPlacement();
      placeAt(index, (event.clientX - bounds.left) * vp.width / bounds.width, (event.clientY - bounds.top) * vp.height / bounds.height, pending.canvas, pending.options).then(() => toast('Signature placed. Drag to move; use the corner handles to resize.')).catch(error => toast(error.message));
    }, true);
    document.addEventListener('pointerup', () => setTimeout(updateSelection, 0), true);
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && armed) { event.preventDefault(); event.stopImmediatePropagation(); cancelPlacement(); }
    }, true);
    app.eventBus.on('annotationeditorstateschanged', () => setTimeout(updateSelection, 0));
    app.eventBus.on('documentloaded', () => { cancelPlacement(); selected = null; $('signatureSelectionBar').hidden = true; });
    setInterval(updateSelection, 500);
    inline = window.FolioSignatureInline.initialize({ app, manager, records, recordFor, process, addStamp, show, changed, toast });
    return {
      show, load, process, placeAt, applyEdit, cancelPlacement, enterMode, inline,
      flushInline: () => inline.flush(),
      configure(options) { settings = { ...settings, ...options }; syncInputs(); render(); },
      get settings() { return { ...settings }; }, get prepared() { return prepared; },
      reset() { inline.reset(); cancelPlacement(); selected = editing = null; $('signatureSelectionBar').hidden = true; if (dialog.open) dialog.close(); }
    };
  }
};
