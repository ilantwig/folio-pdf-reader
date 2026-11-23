(async()=>{
  const results=[], app=Folio.app, tool=Folio.signatures;
  const assert=(test,passed)=>results.push({test,passed:!!passed});
  const wait=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Saved signature did not become editable');};
  app.pdfViewer.currentScaleValue='page-fit';await new Promise(r=>setTimeout(r,100));app.page=1;
  const m=app.pdfViewer._layerProperties.annotationEditorUIManager;
  await wait(()=>app.pdfViewer.getPageView(0).renderingState===3);
  await tool.enterMode(13);
  await wait(()=>app.pdfViewer.getPageView(0).div.querySelector('.stampEditor canvas'));
  const element=app.pdfViewer.getPageView(0).div.querySelector('.stampEditor');
  const original=m.getEditor(element.id);m.setSelected(original);
  assert('Saved signature can be selected for editing',!!original&&original.editorType==='stamp');
  await tool.inline.select(original);await wait(()=>!document.querySelector('#signatureInlineToolbar fieldset').disabled);
  assert('Saved signature image exposes inline instance controls',!document.getElementById('signatureInlineToolbar').hidden&&!document.getElementById('signatureDialog').open);
  const before=original.getPDFRect(),color=document.getElementById('signatureInlineColor'),weight=document.getElementById('signatureInlineThickness');
  weight.focus();color.value='#184aa0';color.dispatchEvent(new Event('input',{bubbles:true}));
  weight.value='1.5';weight.dispatchEvent(new Event('input',{bubbles:true}));weight.dispatchEvent(new Event('change',{bubbles:true}));await tool.flushInline();
  const replacement=tool.inline.editor;
  const after=replacement.getPDFRect();
  assert('Inline editing a saved signature preserves its exact frame',before.every((v,i)=>Math.abs(v-after[i])<.01));
  assert('Saved signature editing retains slider focus',document.activeElement===weight);
  assert('Rapid inline edits on a saved signature keep the final color and thickness',tool.inline.appearance.color==='#184aa0'&&tool.inline.appearance.thickness===1.5);
  assert('Recoloring a saved signature is saved through native PDF save',await Folio.save());
  m.setSelected(replacement);m.delete();const deletedDirty=Folio.dirty();m.undo();
  await wait(()=>replacement.parent&&replacement.div.querySelector('canvas'));
  assert('Deleting and undoing a saved image keeps accurate unsaved state',deletedDirty&&!Folio.dirty());
  return results;
})()
