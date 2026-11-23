(async()=>{
  const app=Folio.app, tool=Folio.signatures, results=[];
  const assert=(test,passed)=>results.push({test,passed:!!passed});
  const wait=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Legacy signature test timed out: '+document.getElementById('signatureError').textContent+' / '+document.getElementById('folioToast').textContent);};
  const {SignatureExtractor}=await import('/pdfjs/build/pdf.mjs');
  const points=new Float32Array([20,90,65,20,110,100,165,48,215,90,290,40,350,70]);
  const lines={curves:[{points}],thickness:3,width:400,height:130};
  const oldLibrary=localStorage.getItem('pdfjs.signature');
  try {
    const signatureData=await SignatureExtractor.compressSignature({outlines:[points],thickness:3,width:400,height:130,areContours:false});
    localStorage.setItem('pdfjs.signature',JSON.stringify({'test-legacy':{description:'Previously saved signature',signatureData}}));
    await tool.show();const saved=document.getElementById('signatureSaved');
    assert('Previous signature library appears in the full editor',!saved.hidden&&saved.options.length===2);
    saved.value='test-legacy';saved.dispatchEvent(new Event('change'));
    await wait(()=>document.getElementById('signatureFilename').textContent.includes('Previously saved signature'));
    assert('Saved signature from the old menu loads without re-import',tool.prepared.width>0&&!document.getElementById('signatureOptions').disabled);
    document.getElementById('signatureDialog').close();
    app.page=2;await tool.enterMode(101);
    const m=app.pdfViewer._layerProperties.annotationEditorUIManager;await wait(()=>m.getLayer(1));
    const native=m.getLayer(1).createAndAddNewEditor({offsetX:200,offsetY:180},false,{signatureData:{lines,mustSmooth:false,areContours:false,description:'Legacy signature',heightInPage:45}});
    m.setSelected(native);await wait(()=>native.div.querySelector('.folioAppearanceButton'));
    assert('Native signatures get the same appearance action',native.editorType==='signature'&&!!native.div.querySelector('.folioAppearanceButton'));
    native.div.querySelector('.folioAppearanceButton').click();await wait(()=>!document.getElementById('signatureInlineToolbar').hidden&&!document.querySelector('#signatureInlineToolbar fieldset').disabled);
    assert('Existing native signature gets inline instance controls',tool.inline.editor===native&&!document.getElementById('signatureDialog').open);
    const box=native.getPDFRect();
    const color=document.getElementById('signatureInlineColor');color.value='#184aa0';color.dispatchEvent(new Event('input',{bubbles:true}));
    const weight=document.getElementById('signatureInlineThickness');weight.value='2';weight.dispatchEvent(new Event('input',{bubbles:true}));weight.dispatchEvent(new Event('change',{bubbles:true}));
    await tool.flushInline();const replacement=tool.inline.editor;
    assert('Native signature changes live while preserving its instance bounds',!native.parent&&replacement.parent&&replacement.pageIndex===1&&box.every((v,i)=>Math.abs(v-replacement.getPDFRect()[i])<.01)&&tool.inline.appearance.color==='#184aa0'&&tool.inline.appearance.thickness===2);
    m.setSelected(replacement);m.delete();
    app.page=1;
  } finally {if(oldLibrary===null)localStorage.removeItem('pdfjs.signature');else localStorage.setItem('pdfjs.signature',oldLibrary);if(document.getElementById('signatureDialog').open)document.getElementById('signatureDialog').close();}
  return results;
})()
