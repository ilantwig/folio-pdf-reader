#pragma once
inline void FolioWindow::startTests() {
    const auto sample = appDir_ / L"Assets" / L"Welcome to Folio.pdf";
    const auto saved = report_.parent_path() / L"integration-saved.pdf";
    testOpen(sample);
    for (const auto* module : {L"integration-tests.js", L"signature-tests.js", L"inline-signature-tests.js"}) testScript(readText(appDir_ / L"Assets" / module));
    captureTest(L"inline-controls-preview.png");
    testScript(readText(appDir_ / L"Assets" / L"legacy-signature-tests.js"));
    testScript("Folio.signatures.show(window.folioTestSignature)", false);
    captureTest(L"signature-dialog-preview.png");
    testScript("document.getElementById('signatureDialog').close()", false);
    testSteps_.push_back([this] { cancelNextSave_ = true; nextTest(); });
    testScript("(async()=>({test:'Cancel native save retains unsaved form',passed:!(await Folio.save()) && Folio.dirty()}))()");
    testScript("(async()=>({test:'Native save writes PDF and clears unsaved state',passed:(await Folio.save()) && !Folio.dirty()}))()");
    testScript("(async()=>{const e=window.folioTestEditor;e.enableEditMode();e.editorDiv.innerText='Folio updated annotation';e.editorDiv.dispatchEvent(new Event('input',{bubbles:true}));e.commit();const changed=Folio.dirty();const saved=await Folio.save();return {test:'Editing an annotation after saving is detected and saved',passed:changed&&saved&&!Folio.dirty()};})()");
    testScript("(()=>{const m=Folio.app.pdfViewer._layerProperties.annotationEditorUIManager;m.setSelected(window.folioTestEditor);m.delete();const changed=Folio.dirty();m.undo();return {test:'Deleting a saved annotation is detected and undo restores it',passed:changed&&!Folio.dirty()};})()");
    testSteps_.push_back([this, saved] {
        HANDLE file = CreateFileW(saved.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
        char header[5]{}; DWORD count = 0; bool ok = file != INVALID_HANDLE_VALUE && ReadFile(file, header, 5, &count, nullptr) && count == 5 && std::string(header, 5) == "%PDF-";
        if (file != INVALID_HANDLE_VALUE) CloseHandle(file);
        appendTest({{"test", "Native save PDF header on disk"}, {"passed", ok}}); nextTest();
    });
    testScript("Folio.close()", false); testOpen(saved);
    testScript("(async()=>{const f=await Folio.app.pdfDocument.getFieldObjects();return {test:'Saved form value survives disk reopen',passed:(f.get?.('reader_name')||f.reader_name)[0].value==='Folio integration reader'};})()");
    testScript("(async()=>{const a=await (await Folio.app.pdfDocument.getPage(3)).getAnnotations();return {test:'Saved annotation survives disk reopen',passed:a.some(x=>x.contentsObj?.str==='Folio updated annotation')};})()");
    testScript("(async()=>{const a=await (await Folio.app.pdfDocument.getPage(1)).getAnnotations();const b=await (await Folio.app.pdfDocument.getPage(4)).getAnnotations();return {test:'Both image signatures survive native save and disk reopen',passed:a.filter(x=>x.subtype==='Stamp').length===1&&b.filter(x=>x.subtype==='Stamp').length===1};})()");
    testScript(readText(appDir_ / L"Assets" / L"reopened-signature-tests.js"));
    testScript("Folio.close()", false); testOpen(saved);
    testScript("(async()=>{const a=await (await Folio.app.pdfDocument.getPage(1)).getAnnotations();return {test:'Editing and resaving a signature produces one stamp without duplicates',passed:a.filter(x=>x.subtype==='Stamp').length===1};})()");
    testScript("(async()=>{Folio.app.pdfViewer.currentScaleValue='page-fit';await new Promise(r=>setTimeout(r,100));Folio.app.page=1;await new Promise(r=>setTimeout(r,400));return true;})()", false);
    captureTest(L"reader-preview.png"); testScript("Folio.close()", false); captureTest(L"home-preview.png");
    const auto encrypted = report_.parent_path() / L"test-fixtures" / L"password.pdf";
    if (fs::exists(encrypted)) {
        // The open call is intentionally concurrent with the password-prompt input.
        testSteps_.push_back([this, encrypted] {
            openPdf(encrypted, [this](json result, std::string failure) { if (!failure.empty() || result != true) { failTest("Encrypted document could not open."); return; } nextTest(); });
            evaluate("(async()=>{for(let i=0;i<150;i++){if(document.getElementById('passwordDialog').open){document.getElementById('password').value='folio-test';document.getElementById('passwordSubmit').click();return {test:'Password prompt accepts encrypted PDF',passed:true};}await new Promise(r=>setTimeout(r,100));}return {test:'Password prompt accepts encrypted PDF',passed:false};})()", [this](json result, std::string failure) { if (!failure.empty()) failTest(failure); else appendTest(result); });
        });
        testScript("(async()=>{for(let i=0;i<150;i++){if(Folio.app.pagesCount===4 && Folio.app.isInitialViewSet)return {test:'Encrypted PDF opens after password',passed:true};await new Promise(r=>setTimeout(r,100));}return {test:'Encrypted PDF opens after password',passed:false};})()");
    }
    testScript("Folio.close()", false);
    const auto broken = report_.parent_path() / L"test-fixtures" / L"broken.pdf";
    if (fs::exists(broken)) {
        testSteps_.push_back([this, broken] { openPdf(broken, [this](json, std::string failure) { if (!failure.empty()) { failTest(failure); return; } nextTest(); }); });
        testScript("({test:'Invalid PDF returns to usable library',passed:document.body.dataset.view==='home' && !Folio.app.pdfDocument})");
    }
    testOpen(sample);
    testScript("(async()=>{Folio.app.page=3;await new Promise(r=>setTimeout(r,600));return true;})()", false);
    testScript("Folio.close()", false); testOpen(sample);
    testScript("(async()=>{await new Promise(r=>setTimeout(r,700));return {test:'Recent document restores reading position',passed:Folio.app.page===3};})()");
    testSteps_.push_back([this, sample] {
        bool found = false; auto stored = json::parse(readText(preferencesFile_));
        for (const auto& recent : stored["Recent"]) if (recent.value("Path", "") == utf8(sample.wstring()) && recent.value("Page", 0) == 3) found = true;
        appendTest({{"test", "Recent files persisted on disk"}, {"passed", found}}); nextTest();
    });
    testScript("Folio.close()", false);
    const auto unicode = report_.parent_path() / L"\u05ea\u05d9\u05e7\u05d9\u05d9\u05d4 - caf\u00e9" / L"\u05de\u05e1\u05de\u05da.pdf";
    testSteps_.push_back([this, sample, unicode] { fs::create_directories(unicode.parent_path()); fs::copy_file(sample, unicode, fs::copy_options::overwrite_existing); nextTest(); });
    testOpen(unicode);
    testSteps_.push_back([this, unicode] {
        bool found = false;
        for (const auto& recent : preferences_["Recent"]) if (recent.value("Path", "") == utf8(unicode.wstring())) found = true;
        appendTest({{"test", "Native file streaming and recents support Hebrew and accented paths"}, {"passed", currentPath_ == unicode && found}});
        nextTest();
    });
    testScript("Folio.close()", false);
    testSteps_.push_back([this] {
        appendTest({{"test", "Windows window is a native Win32 class"}, {"passed", [] (HWND window) { wchar_t name[64]{}; GetClassNameW(window, name, 64); return std::wstring(name) == L"FolioNativeWin32"; }(window_)}});
        appendTest({{"test", "No CLR or .NET runtime is loaded in the native process"}, {"passed", !GetModuleHandleW(L"coreclr.dll") && !GetModuleHandleW(L"clr.dll") && !GetModuleHandleW(L"mscoree.dll")}});
        nextTest();
    });
    nextTest();
}
