/* Per-instance, on-page signature appearance. One history entry per gesture. */
window.FolioSignatureInline = {
  initialize({ app, manager, records, recordFor, process, addStamp, show, changed, toast }) {
    const toolbar = document.createElement('div'); toolbar.id = 'signatureInlineToolbar'; toolbar.hidden = true;
    toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', 'Selected signature color and thickness');
    toolbar.innerHTML = `<fieldset disabled><legend class="visuallyHidden">Selected signature only</legend><span class="inlineSignatureLabel">This signature</span><div class="inlineColors"><button type="button" data-inline-color="original" title="Restore original ink color">Original</button><button type="button" class="inlineBlack" data-inline-color="#151515" aria-label="Black signature ink" title="Black ink"></button><button type="button" class="inlineBlue" data-inline-color="#184aa0" aria-label="Blue signature ink" title="Blue ink"></button><input id="signatureInlineColor" type="color" value="#184aa0" aria-label="Selected signature ink color" title="Custom ink color"></div><label class="inlineThickness">Thickness <input id="signatureInlineThickness" type="range" min="-3" max="8" step="0.25" value="0" aria-label="Selected signature stroke thickness"><output id="signatureInlineThicknessValue">0</output></label><button type="button" id="signatureInlineMore" title="Rotation, opacity, and other options">More…</button></fieldset>`;
    document.getElementById('signatureTools').append(toolbar);
    const $ = id => document.getElementById(id), fieldset = toolbar.querySelector('fieldset');
    let target = null, targetRecord = null, selectionToken = 0, sequence = 0, applying = false, session = null;
    let desired = null, queue = Promise.resolve();
    const cloneRecord = record => ({ source: record.source, settings: { ...record.settings } });
    const originalColors = new WeakMap();
    function originalColor(image) {
      if (!image) return '#151515';
      if (originalColors.has(image.canvas)) return originalColors.get(image.canvas);
      const pixels = image.canvas.getContext('2d').getImageData(0, 0, image.canvas.width, image.canvas.height).data;
      let score = -1, color = '#151515';
      for (let i = 0; i < pixels.length; i += 4) {
        const value = pixels[i + 3] * (255 - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]));
        if (value > score) { score = value; color = '#' + [...pixels.subarray(i, i + 3)].map(n => n.toString(16).padStart(2, '0')).join(''); }
      }
      originalColors.set(image.canvas, color); return color;
    }
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const bitmapId = editor => editor.editorType === 'stamp' ? (editor.serialize(false)?.bitmapId || editor.serialize(true).bitmapId) : null;
    async function snapshot(editor, record) {
      const id = bitmapId(editor);
      // Pin history images so restoring their exact IDs also restores clean state.
      if (id) await manager().imageManager.getFromId(id);
      return { editor, bitmapId: id, record: cloneRecord(record) };
    }
    function setBitmap(editor, canvas, key) {
      const previous = bitmapId(editor), geometry = { x: editor.x, y: editor.y, width: editor.width, height: editor.height, rotation: editor.rotation };
      editor.div.querySelector('canvas')?.remove();
      editor.setCanvas(key, canvas);
      Object.assign(editor, geometry); editor.setDims(); editor.fixAndSetPosition(); editor._onResized();
      if (previous) manager().imageManager.deleteId(previous);
    }
    function restore(value, select = true) {
      const editor = value.editor;
      const detached = !editor.parent;
      if (detached) manager().rebuild(editor);
      if (value.bitmapId && editor.parent && !detached) {
        const placeholder = document.createElement('canvas'); placeholder.width = placeholder.height = 1;
        setBitmap(editor, placeholder, value.bitmapId);
      }
      records.set(editor, cloneRecord(value.record));
      if (select) manager().setSelected(editor);
      changed(); targetRecord = null;
    }
    async function commit() {
      if (!session) return;
      const change = session; session = null;
      const currentRecord = records.get(change.editor);
      if (same(change.before.record.settings, currentRecord.settings)) {
        if (change.editor !== change.before.editor) change.editor.remove();
        restore(change.before);
        if (change.before.bitmapId) manager().imageManager.deleteId(change.before.bitmapId);
        return;
      }
      const after = await snapshot(change.editor, currentRecord), before = change.before;
      manager().addCommands({
        cmd: () => { if (before.editor !== after.editor) before.editor.remove(); restore(after); },
        undo: () => { if (before.editor !== after.editor) after.editor.remove(); restore(before); },
        mustExec: false
      });
      changed();
    }
    async function preview(editor, options) {
      const sameSession = session && (editor === session.editor || editor === session.before.editor);
      if (session && !sameSession) await commit();
      const active = sameSession ? session.editor : editor;
      if (!active?.parent || !app.pdfDocument) return;
      const record = records.get(active) || await recordFor(active);
      if (same(record.settings, options)) return;
      const canvas = process(record.source.canvas, options);
      if (!session) session = { before: await snapshot(active, record), editor: active };
      applying = true;
      try {
        if (active.editorType !== 'stamp' || active.annotationElementId) {
          const replacement = await addStamp(canvas, options, active.pageIndex, active.getPDFRect(), active.rotation, active, { source: record.source, history: false, select: false, focus: false });
          session.editor = replacement;
          if (!manager().firstSelectedEditor || manager().firstSelectedEditor === active) manager().setSelected(replacement);
        } else {
          setBitmap(active, canvas, 'folio-inline-' + crypto.randomUUID());
          records.set(active, { source: record.source, settings: { ...options } });
        }
        const selected = manager().firstSelectedEditor;
        if (selected === session.editor || selected === session.before.editor || (!selected && target === session.before.editor)) {
          target = session.editor; targetRecord = records.get(target);
        }
        changed(); position();
      } finally { applying = false; }
    }
    function sync(record) {
      const options = record.settings;
      $('signatureInlineColor').value = options.color === 'original' ? originalColor(record.source || targetRecord?.source) : options.color;
      $('signatureInlineThickness').value = options.thickness || 0;
      $('signatureInlineThicknessValue').value = (options.thickness > 0 ? '+' : '') + (options.thickness || 0);
      toolbar.querySelectorAll('[data-inline-color]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.inlineColor === options.color)));
    }
    function position() {
      if (toolbar.hidden || !target?.parent) return;
      const box = target.div.getBoundingClientRect();
      if (box.bottom < 100 || box.top > innerHeight - 30 || !box.width) { toolbar.style.visibility = 'hidden'; return; }
      toolbar.style.visibility = '';
      const width = toolbar.offsetWidth, height = toolbar.offsetHeight;
      toolbar.style.left = Math.max(8, Math.min(innerWidth - width - 8, (box.left + box.right - width) / 2)) + 'px';
      const top = box.top - height - 10 >= 100 ? box.top - height - 10 : box.bottom + 12;
      toolbar.style.top = Math.max(100, Math.min(innerHeight - height - 36, top)) + 'px';
    }
    async function select(editor, focus = false) {
      if (applying) { position(); return; }
      if (editor === target && targetRecord === records.get(editor)) {
        if (editor && !document.getElementById('signatureDialog').open) { toolbar.hidden = false; position(); }
        if (focus) { document.getElementById('editorStampParamsToolbar')?.classList.add('hidden'); $('signatureInlineThickness').focus(); }
        return;
      }
      if (target && editor !== target && (!session || (editor !== session.editor && editor !== session.before.editor))) flush().catch(error => toast(error.message));
      target = editor; targetRecord = null; desired = null;
      const token = ++selectionToken;
      if (!editor) { toolbar.hidden = true; return; }
      document.getElementById('editorStampParamsToolbar')?.classList.add('hidden');
      document.getElementById('editorStampButton')?.setAttribute('aria-expanded', 'false');
      toolbar.hidden = false; fieldset.disabled = true; position();
      try {
        const record = records.get(editor) || await recordFor(editor);
        if (token !== selectionToken || target !== editor) return;
        targetRecord = record; desired = { ...record.settings }; sync(record); fieldset.disabled = false; position();
        if (focus) $('signatureInlineThickness').focus();
      } catch (error) { if (token === selectionToken) { toolbar.hidden = true; target = null; } }
    }
    function change(patch, finish = false) {
      if (!target || fieldset.disabled) return queue;
      const editor = target, record = records.get(editor) || targetRecord;
      desired = { ...(desired || record.settings), ...patch };
      // Stroke changes work on extracted ink, without a separate dialog step.
      if ('thickness' in patch && patch.thickness !== record.settings.thickness) desired.removeWhite = true;
      const options = { ...desired }, ticket = ++sequence;
      sync({ settings: options });
      queue = queue.then(async () => {
        if (ticket !== sequence && !finish) return;
        await preview(editor, options);
        if (finish) await commit();
      }).catch(error => { toast(error.message); const record = target && records.get(target); if (record) { desired = { ...record.settings }; sync(record); } });
      return queue;
    }
    function flush() {
      queue = queue.then(commit); return queue;
    }
    for (const event of ['pointerdown', 'pointerup', 'click']) toolbar.addEventListener(event, e => e.stopPropagation());
    toolbar.addEventListener('focusin', () => { if (target) target._focusEventsAllowed = false; });
    toolbar.addEventListener('focusout', event => { if (!toolbar.contains(event.relatedTarget)) { if (target) target._focusEventsAllowed = true; flush().catch(error => toast(error.message)); } });
    toolbar.querySelectorAll('[data-inline-color]').forEach(button => button.onclick = () => change({ color: button.dataset.inlineColor }, true));
    $('signatureInlineColor').oninput = () => change({ color: $('signatureInlineColor').value });
    $('signatureInlineColor').onchange = () => change({ color: $('signatureInlineColor').value }, true);
    $('signatureInlineThickness').oninput = () => change({ thickness: Number($('signatureInlineThickness').value) });
    $('signatureInlineThickness').onchange = () => change({ thickness: Number($('signatureInlineThickness').value) }, true);
    $('signatureInlineThickness').onpointerup = () => flush().catch(error => toast(error.message));
    $('signatureInlineMore').onclick = async () => { await flush(); if (target?.parent) await show(target); };
    document.getElementById('viewerContainer').addEventListener('scroll', position, { passive: true });
    window.addEventListener('resize', position);
    app.eventBus.on('scalechanging', () => requestAnimationFrame(position));
    window.addEventListener('keydown', event => {
      if (!toolbar.contains(event.target) || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      event.preventDefault(); event.stopImmediatePropagation();
      flush().then(() => { key === 'y' || event.shiftKey ? manager().redo() : manager().undo(); select(manager().firstSelectedEditor); });
    }, true);
    return {
      select, flush,
      hide() { toolbar.hidden = true; selectionToken++; },
      get editor() { return target; },
      get appearance() { return target && records.has(target) ? { ...records.get(target).settings } : null; },
      reset() { toolbar.hidden = true; selectionToken++; target = targetRecord = desired = null; session = null; }
    };
  }
};
