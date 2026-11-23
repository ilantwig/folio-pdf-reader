#include "native_support.hpp"
#include <map>
#include <memory>
#include <fstream>
#include <wincrypt.h>

static constexpr UINT WM_FOLIO_INIT = WM_APP + 1;
static constexpr UINT WM_FOLIO_STEP = WM_APP + 2;
static constexpr UINT WM_FOLIO_ACTION = WM_APP + 3;
static constexpr wchar_t ORIGIN[] = L"https://folio.local";
static constexpr wchar_t VERSION[] = L"2.0.0-win32";
using Completion = std::function<void(json, std::string)>;

class FolioWindow {
    HWND window_ = nullptr;
    HINSTANCE instance_;
    HMODULE loader_ = nullptr;
    fs::path appDir_, profile_, preferencesFile_, report_, currentPath_, pendingPath_;
    std::vector<std::wstring> args_;
    json preferences_ = {{"Recent", json::array()}, {"Theme", "light"}, {"Width", 1280}, {"Height", 900}, {"Maximized", false}};
    Com<ICoreWebView2Environment> environment_;
    Com<ICoreWebView2Controller> controller_;
    Com<ICoreWebView2> browser_;
    std::map<std::string, fs::path> documents_;
    std::vector<Com<IStream>> responseStreams_;
    std::map<std::string, Completion> calls_;
    bool ready_ = false, opening_ = false, closing_ = false, approved_ = false, cancelNextSave_ = false;
    HANDLE saveFile_ = INVALID_HANDLE_VALUE;
    fs::path saveTemp_, saveTarget_;
    std::vector<std::function<void()>> testSteps_;
    size_t testIndex_ = 0;
    json testResults_ = json::array();
public:
    FolioWindow(HINSTANCE instance, std::vector<std::wstring> args) : instance_(instance), args_(std::move(args)) {
        wchar_t module[32768]; GetModuleFileNameW(nullptr, module, 32768); appDir_ = fs::path(module).parent_path();
        for (size_t i = 0; i + 1 < args_.size(); ++i) if (args_[i] == L"--self-test") report_ = fs::absolute(args_[i + 1]);
        if (!report_.empty()) { fs::create_directories(report_.parent_path()); profile_ = report_.parent_path() / L"test-profile-win32"; }
        else { PWSTR directory = nullptr; check(SHGetKnownFolderPath(FOLDERID_LocalAppData, KF_FLAG_CREATE, nullptr, &directory), "Find app data"); profile_ = fs::path(takeString(directory)) / L"Folio"; }
        fs::create_directories(profile_); preferencesFile_ = profile_ / L"preferences.json";
        try { auto stored = json::parse(readText(preferencesFile_)); preferences_.update(stored); } catch (...) {}
        if (!preferences_["Recent"].is_array()) preferences_["Recent"] = json::array();
    }
    ~FolioWindow() { cleanupSave(); if (controller_) controller_->Close(); browser_.reset(); controller_.reset(); environment_.reset(); responseStreams_.clear(); if (loader_) FreeLibrary(loader_); }
    bool create(int show) {
        WNDCLASSEXW type{sizeof(type)}; type.hInstance = instance_; type.lpfnWndProc = windowProc;
        type.lpszClassName = L"FolioNativeWin32"; type.hCursor = LoadCursorW(nullptr, IDC_ARROW); type.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
        type.hIcon = static_cast<HICON>(LoadImageW(instance_, MAKEINTRESOURCEW(101), IMAGE_ICON, 0, 0, LR_DEFAULTSIZE)); type.hIconSm = type.hIcon;
        if (!RegisterClassExW(&type) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return false;
        RECT work{}; SystemParametersInfoW(SPI_GETWORKAREA, 0, &work, 0); const auto dpi = GetDpiForSystem();
        int width = std::min<int>(MulDiv(std::clamp(preferences_.value("Width", 1280), 800, 2400), dpi, 96), work.right - work.left - 24);
        int height = std::min<int>(MulDiv(std::clamp(preferences_.value("Height", 900), 600, 1800), dpi, 96), work.bottom - work.top - 24);
        window_ = CreateWindowExW(0, type.lpszClassName, L"Folio — Native Win32 PDF Reader", WS_OVERLAPPEDWINDOW,
            work.left + (work.right - work.left - width) / 2, work.top + (work.bottom - work.top - height) / 2, width, height, nullptr, nullptr, instance_, this);
        if (!window_) return false;
        DragAcceptFiles(window_, TRUE);
        ShowWindow(window_, preferences_.value("Maximized", false) ? SW_SHOWMAXIMIZED : show); UpdateWindow(window_);
        PostMessageW(window_, WM_FOLIO_INIT, 0, 0); return true;
    }
private:
    static LRESULT CALLBACK windowProc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
        auto self = reinterpret_cast<FolioWindow*>(GetWindowLongPtrW(window, GWLP_USERDATA));
        if (message == WM_NCCREATE) { self = static_cast<FolioWindow*>(reinterpret_cast<CREATESTRUCTW*>(lparam)->lpCreateParams); self->window_ = window; SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self)); }
        if (self) { try { return self->onWindowMessage(message, wparam, lparam); } catch (const std::exception& error) { self->error(error.what()); } }
        return DefWindowProcW(window, message, wparam, lparam);
    }
    LRESULT onWindowMessage(UINT message, WPARAM wparam, LPARAM lparam) {
        switch (message) {
            case WM_FOLIO_INIT: initialize(); return 0;
            case WM_FOLIO_ACTION: { std::unique_ptr<std::function<void()>> action(reinterpret_cast<std::function<void()>*>(lparam)); (*action)(); return 0; }
            case WM_SIZE: resize(); return 0;
            case WM_DPICHANGED: { auto rect = reinterpret_cast<RECT*>(lparam); SetWindowPos(window_, nullptr, rect->left, rect->top, rect->right - rect->left, rect->bottom - rect->top, SWP_NOACTIVATE | SWP_NOZORDER); resize(); return 0; }
            case WM_GETMINMAXINFO: { auto info = reinterpret_cast<MINMAXINFO*>(lparam); UINT dpi = GetDpiForWindow(window_); info->ptMinTrackSize = {MulDiv(800, dpi, 96), MulDiv(600, dpi, 96)}; return 0; }
            case WM_SETFOCUS: if (controller_) controller_->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC); return 0;
            case WM_DROPFILES: { HDROP drop = reinterpret_cast<HDROP>(wparam); UINT count = DragQueryFileW(drop, 0, nullptr, 0); std::wstring path(count + 1, L'\0'); DragQueryFileW(drop, 0, path.data(), count + 1); path.resize(count); DragFinish(drop); openPdf(path); return 0; }
            case WM_CLOSE: close(); return 0;
            case WM_DESTROY: persistWindow(); KillTimer(window_, 1); if (controller_) controller_->Close(); PostQuitMessage(0); return 0;
            case WM_TIMER: if (wparam == 1 && !report_.empty()) failTest("Native integration run timed out."); return 0;
            case WM_FOLIO_STEP: if (testIndex_ < testSteps_.size()) testSteps_[testIndex_++](); else finishTests(); return 0;
        }
        return DefWindowProcW(window_, message, wparam, lparam);
    }
    void resize() { if (controller_) { RECT bounds; GetClientRect(window_, &bounds); controller_->put_Bounds(bounds); } }
    void postAction(std::function<void()> action) { auto pointer = new std::function<void()>(std::move(action)); if (!PostMessageW(window_, WM_FOLIO_ACTION, 0, reinterpret_cast<LPARAM>(pointer))) delete pointer; }
    bool isLocal(const std::wstring& uri) const { return uri == ORIGIN || uri.rfind(std::wstring(ORIGIN) + L"/", 0) == 0; }
    void error(const std::string& text) { if (!report_.empty()) { failTest(text); return; } MessageBoxW(window_, wide(text).c_str(), L"Folio", MB_OK | MB_ICONERROR); }
    void startupError(HRESULT result) {
        if (!report_.empty()) { failTest("WebView2 startup failed: " + std::to_string(static_cast<unsigned long>(result))); return; }
        if (MessageBoxW(window_, L"Folio needs Microsoft Edge WebView2 Runtime. No .NET installation is needed.\n\nOpen the official WebView2 download page?", L"Folio startup", MB_YESNO | MB_ICONINFORMATION) == IDYES)
            ShellExecuteW(window_, L"open", L"https://developer.microsoft.com/microsoft-edge/webview2/", nullptr, nullptr, SW_SHOWNORMAL);
        approved_ = true; DestroyWindow(window_);
    }
    void runtimeTooOld(const std::wstring& version) {
        const std::wstring message = L"Folio needs Microsoft Edge WebView2 Runtime 145 or newer.\n\nInstalled version: " + version + L"\n\nUpdate the Evergreen Runtime, then open Folio again. No .NET installation is needed.\n\nOpen Microsoft's WebView2 download page?";
        if (!report_.empty()) { failTest("WebView2 Runtime 145 or newer is required; installed " + utf8(version)); return; }
        if (MessageBoxW(window_, message.c_str(), L"Update WebView2 Runtime", MB_YESNO | MB_ICONINFORMATION) == IDYES)
            ShellExecuteW(window_, L"open", L"https://developer.microsoft.com/microsoft-edge/webview2/", nullptr, nullptr, SW_SHOWNORMAL);
        approved_ = true; DestroyWindow(window_);
    }
    void initialize() {
        loader_ = LoadLibraryExW((appDir_ / L"WebView2Loader.dll").c_str(), nullptr, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
        if (!loader_) { startupError(HRESULT_FROM_WIN32(GetLastError())); return; }
        using CreateEnvironment = HRESULT(STDAPICALLTYPE*)(PCWSTR, PCWSTR, ICoreWebView2EnvironmentOptions*, ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler*);
        auto createEnvironment = reinterpret_cast<CreateEnvironment>(GetProcAddress(loader_, "CreateCoreWebView2EnvironmentWithOptions"));
        if (!createEnvironment) { startupError(E_NOINTERFACE); return; }
        auto callback = handler<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler, HRESULT, ICoreWebView2Environment*>([this](HRESULT result, ICoreWebView2Environment* environment) {
            if (FAILED(result) || !environment) { startupError(result); return S_OK; }
            environment_ = Com<ICoreWebView2Environment>(environment);
            LPWSTR rawVersion = nullptr;
            if (FAILED(environment_->get_BrowserVersionString(&rawVersion))) { startupError(E_FAIL); return S_OK; }
            const auto runtimeVersion = takeString(rawVersion);
            // PDF.js 6 uses modern APIs including Map.getOrInsertComputed.
            if (wcstol(runtimeVersion.c_str(), nullptr, 10) < 145) { runtimeTooOld(runtimeVersion); return S_OK; }
            auto completed = handler<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler, HRESULT, ICoreWebView2Controller*>([this](HRESULT result, ICoreWebView2Controller* controller) {
                if (FAILED(result) || !controller) { startupError(result); return S_OK; }
                controller_ = Com<ICoreWebView2Controller>(controller); check(controller_->get_CoreWebView2(browser_.put()), "Create viewer"); configure(); return S_OK;
            });
            HRESULT controllerResult = environment_->CreateCoreWebView2Controller(window_, completed.get()); if (FAILED(controllerResult)) startupError(controllerResult); return S_OK;
        });
        HRESULT result = createEnvironment(nullptr, (profile_ / L"WebView").c_str(), nullptr, callback.get()); if (FAILED(result)) startupError(result);
        if (!report_.empty()) SetTimer(window_, 1, 180000, nullptr);
    }
    void configure() {
        resize(); controller_->put_IsVisible(TRUE);
        Com<ICoreWebView2Settings> settings; check(browser_->get_Settings(settings.put()), "Configure reader");
        settings->put_IsStatusBarEnabled(FALSE); settings->put_IsZoomControlEnabled(FALSE); settings->put_AreDevToolsEnabled(!report_.empty());
        if (auto keys = settings.as<ICoreWebView2Settings3>()) keys->put_AreBrowserAcceleratorKeysEnabled(FALSE);
        if (auto fill = settings.as<ICoreWebView2Settings4>()) { fill->put_IsGeneralAutofillEnabled(FALSE); fill->put_IsPasswordAutosaveEnabled(FALSE); }
        auto local = browser_.as<ICoreWebView2_3>(); if (!local) throw std::runtime_error("Please update Microsoft Edge WebView2 Runtime.");
        check(local->SetVirtualHostNameToFolderMapping(L"folio.local", (appDir_ / L"Assets").c_str(), COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY), "Load local assets");
        EventRegistrationToken token{};
        auto message = handler<ICoreWebView2WebMessageReceivedEventHandler, ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs*>([this](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) { postAction([this, pending = Com<ICoreWebView2WebMessageReceivedEventArgs>(args)] { onMessage(pending.get()); }); return S_OK; });
        check(browser_->add_WebMessageReceived(message.get(), &token), "Connect native bridge");
        auto navigation = handler<ICoreWebView2NavigationStartingEventHandler, ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs*>([this](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) { LPWSTR raw = nullptr; args->get_Uri(&raw); auto uri = takeString(raw); if (!isLocal(uri)) { args->put_Cancel(TRUE); postAction([this, uri] { openExternal(uri); }); } return S_OK; });
        browser_->add_NavigationStarting(navigation.get(), &token);
        auto popup = handler<ICoreWebView2NewWindowRequestedEventHandler, ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs*>([this](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) { LPWSTR raw = nullptr; args->get_Uri(&raw); args->put_Handled(TRUE); postAction([this, uri = takeString(raw)] { openExternal(uri); }); return S_OK; });
        browser_->add_NewWindowRequested(popup.get(), &token);
        auto permission = handler<ICoreWebView2PermissionRequestedEventHandler, ICoreWebView2*, ICoreWebView2PermissionRequestedEventArgs*>([](ICoreWebView2*, ICoreWebView2PermissionRequestedEventArgs* args) { args->put_State(COREWEBVIEW2_PERMISSION_STATE_DENY); return S_OK; });
        browser_->add_PermissionRequested(permission.get(), &token);
        auto resource = handler<ICoreWebView2WebResourceRequestedEventHandler, ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs*>([this](ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs* args) { onResource(args); return S_OK; });
        browser_->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL); browser_->add_WebResourceRequested(resource.get(), &token);
        if (auto downloads = browser_.as<ICoreWebView2_4>()) {
            auto download = handler<ICoreWebView2DownloadStartingEventHandler, ICoreWebView2*, ICoreWebView2DownloadStartingEventArgs*>([this](ICoreWebView2*, ICoreWebView2DownloadStartingEventArgs* args) {
                auto deferral = Com<ICoreWebView2Deferral>(); args->GetDeferral(deferral.put());
                LPWSTR raw = nullptr; args->get_ResultFilePath(&raw); auto name = fs::path(takeString(raw)).filename().wstring();
                postAction([this, pending = Com<ICoreWebView2DownloadStartingEventArgs>(args), deferral, name] {
                    auto path = fileDialog(true, name, false);
                    if (path.empty()) pending->put_Cancel(TRUE); else { pending->put_ResultFilePath(path.c_str()); pending->put_Handled(TRUE); }
                    if (deferral) deferral->Complete();
                }); return S_OK;
            }); downloads->add_DownloadStarting(download.get(), &token);
        }
        check(browser_->Navigate((std::wstring(ORIGIN) + L"/pdfjs/web/viewer.html?file=&folio=" + VERSION).c_str()), "Open reader");
    }
    void openExternal(const std::wstring& uri) {
        if (uri.rfind(L"https://", 0) != 0 && uri.rfind(L"http://", 0) != 0 && uri.rfind(L"mailto:", 0) != 0) return;
        if (MessageBoxW(window_, (L"Open this link in your default app?\n\n" + uri).c_str(), L"Open link", MB_OKCANCEL | MB_ICONQUESTION) == IDOK)
            ShellExecuteW(window_, L"open", uri.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    }
    void onResource(ICoreWebView2WebResourceRequestedEventArgs* args) {
        Com<ICoreWebView2WebResourceRequest> request; args->get_Request(request.put()); LPWSTR raw = nullptr; request->get_Uri(&raw); auto uri = takeString(raw);
        const std::wstring prefix = L"https://documents.folio.local/document/";
        if (isLocal(uri)) return;
        Com<ICoreWebView2WebResourceResponse> response;
        if (uri.rfind(prefix, 0) != 0) { environment_->CreateWebResourceResponse(nullptr, 403, L"Offline reader", L"", response.put()); args->put_Response(response.get()); return; }
        try {
            auto end = uri.find(L'/', prefix.size()); auto key = utf8(uri.substr(prefix.size(), end - prefix.size())); auto found = documents_.find(key);
            if (found == documents_.end()) throw std::runtime_error("Unknown document.");
            Com<IStream> stream(new ReadStream(found->second), false); STATSTG info{}; check(stream->Stat(&info, STATFLAG_NONAME), "Read document size"); responseStreams_.push_back(stream);
            auto headers = L"Content-Type: application/pdf\r\nContent-Length: " + std::to_wstring(info.cbSize.QuadPart) + L"\r\nAccess-Control-Allow-Origin: https://folio.local\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff";
            environment_->CreateWebResourceResponse(stream.get(), 200, L"OK", headers.c_str(), response.put());
        } catch (...) { environment_->CreateWebResourceResponse(nullptr, 404, L"Document unavailable", L"", response.put()); }
        args->put_Response(response.get());
    }
    void post(const json& message) { if (browser_) browser_->PostWebMessageAsJson(wide(message.dump()).c_str()); }
    void reply(const std::string& id, const json& result = nullptr, const std::string& errorText = "") { if (!id.empty()) post({{"id", id}, {"result", result}, {"error", errorText.empty() ? json(nullptr) : json(errorText)}}); }
    void evaluate(const std::string& expression, Completion completed) {
        const auto id = guid(); calls_[id] = std::move(completed);
        std::string script = "(async()=>{try{const value=await (" + expression + ");chrome.webview.postMessage({type:'callResult',callId:" + json(id).dump() + ",value:value??null});}catch(e){chrome.webview.postMessage({type:'callResult',callId:" + json(id).dump() + ",error:e.stack||String(e)});}})()";
        auto failure = handler<ICoreWebView2ExecuteScriptCompletedHandler, HRESULT, LPCWSTR>([this, id](HRESULT result, LPCWSTR) { if (FAILED(result)) completeCall(id, nullptr, "Could not execute viewer command."); return S_OK; });
        HRESULT result = browser_->ExecuteScript(wide(script).c_str(), failure.get()); if (FAILED(result)) completeCall(id, nullptr, "Viewer command failed.");
    }
    void completeCall(const std::string& id, json value, const std::string& failure) { auto found = calls_.find(id); if (found == calls_.end()) return; auto callback = std::move(found->second); calls_.erase(found); callback(std::move(value), failure); }
    void sendState() { post({{"type", "state"}, {"recent", preferences_["Recent"]}, {"theme", preferences_["Theme"]}}); }
    void persist() noexcept { try { auto temporary = preferencesFile_; temporary += L".tmp"; writeText(temporary, preferences_.dump()); MoveFileExW(temporary.c_str(), preferencesFile_.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH); } catch (...) {} }
    void persistWindow() {
        WINDOWPLACEMENT placement{sizeof(placement)}; if (GetWindowPlacement(window_, &placement)) { UINT dpi = GetDpiForWindow(window_); if (!dpi) dpi = 96; auto r = placement.rcNormalPosition; preferences_["Width"] = MulDiv(r.right - r.left, 96, dpi); preferences_["Height"] = MulDiv(r.bottom - r.top, 96, dpi); preferences_["Maximized"] = placement.showCmd == SW_SHOWMAXIMIZED; }
        persist(); cleanupSave();
    }
    fs::path fileDialog(bool save, const std::wstring& name = L"document.pdf", bool pdfOnly = true) {
        std::vector<wchar_t> filename(32768, 0); if (save) { auto safe = fs::path(name).filename().wstring(); std::copy_n(safe.c_str(), std::min(safe.size(), filename.size() - 1), filename.data()); }
        OPENFILENAMEW dialog{sizeof(dialog)}; dialog.hwndOwner = window_; dialog.lpstrFile = filename.data(); dialog.nMaxFile = static_cast<DWORD>(filename.size());
        dialog.lpstrFilter = pdfOnly ? L"PDF documents\0*.pdf\0All files\0*.*\0\0" : L"All files\0*.*\0\0";
        dialog.lpstrTitle = save ? L"Save PDF copy" : L"Open a PDF"; dialog.lpstrDefExt = pdfOnly ? L"pdf" : nullptr;
        dialog.Flags = OFN_EXPLORER | OFN_ENABLESIZING | OFN_NOCHANGEDIR | OFN_PATHMUSTEXIST | (save ? OFN_OVERWRITEPROMPT : OFN_FILEMUSTEXIST);
        return (save ? GetSaveFileNameW(&dialog) : GetOpenFileNameW(&dialog)) ? fs::path(filename.data()) : fs::path();
    }
    void cleanupSave() noexcept { if (saveFile_ != INVALID_HANDLE_VALUE) CloseHandle(saveFile_); saveFile_ = INVALID_HANDLE_VALUE; if (!saveTemp_.empty()) DeleteFileW(saveTemp_.c_str()); saveTemp_.clear(); saveTarget_.clear(); }
    bool startSave(const std::string& name) {
        cleanupSave();
        if (!report_.empty()) { if (cancelNextSave_) { cancelNextSave_ = false; return false; } saveTarget_ = report_.parent_path() / L"integration-saved.pdf"; }
        else saveTarget_ = fileDialog(true, wide(name));
        if (saveTarget_.empty()) return false;
        saveTemp_ = saveTarget_.parent_path() / (L".folio-" + wide(guid()) + L".tmp");
        saveFile_ = CreateFileW(saveTemp_.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (saveFile_ == INVALID_HANDLE_VALUE) throw std::runtime_error("Could not create the PDF copy in that folder."); return true;
    }
    void saveChunk(const std::string& encoded) {
        if (saveFile_ == INVALID_HANDLE_VALUE) throw std::runtime_error("No save is in progress.");
        DWORD length = 0; if (encoded.size() > 1400000 || !CryptStringToBinaryA(encoded.c_str(), static_cast<DWORD>(encoded.size()), CRYPT_STRING_BASE64 | CRYPT_STRING_STRICT, nullptr, &length, nullptr, nullptr) || length > 1024 * 1024) throw std::runtime_error("Invalid save data.");
        std::vector<BYTE> data(length); if (!CryptStringToBinaryA(encoded.c_str(), static_cast<DWORD>(encoded.size()), CRYPT_STRING_BASE64 | CRYPT_STRING_STRICT, data.data(), &length, nullptr, nullptr)) throw std::runtime_error("Invalid save encoding.");
        DWORD written = 0; if (!WriteFile(saveFile_, data.data(), length, &written, nullptr) || written != length) throw std::runtime_error("Could not write the PDF copy.");
    }
    void endSave() {
        if (saveFile_ == INVALID_HANDLE_VALUE) throw std::runtime_error("No save is in progress.");
        if (!FlushFileBuffers(saveFile_)) throw std::runtime_error("Could not flush the saved PDF."); CloseHandle(saveFile_); saveFile_ = INVALID_HANDLE_VALUE; responseStreams_.clear();
        if (!MoveFileExW(saveTemp_.c_str(), saveTarget_.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) throw std::runtime_error("Could not replace the selected PDF. Your original file was preserved.");
        saveTemp_.clear(); saveTarget_.clear();
    }
    void openPdf(const fs::path& path, Completion completion = {}) {
        if (!ready_ || opening_) { if (completion) completion(false, "Reader is busy."); return; }
        fs::path absolute = fs::absolute(path);
        if (!fs::exists(absolute) || fs::file_size(absolute) == 0) { if (completion) completion(false, "This file is empty or no longer available."); else error("This file is empty or no longer available. Use Open PDF to locate it."); return; }
        opening_ = true; const auto key = guid(); documents_[key] = absolute;
        int page = 1; for (const auto& recent : preferences_["Recent"]) if (recent.value("Path", "") == utf8(absolute.wstring())) page = recent.value("Page", 1);
        json payload = {{"url", "https://documents.folio.local/document/" + key + "/file.pdf"}, {"name", utf8(absolute.filename().wstring())}, {"page", page}};
        evaluate("Folio.open(" + payload.dump() + ")", [this, completion](json result, std::string failure) { opening_ = false; if (completion) completion(result, failure); else if (!failure.empty()) error(failure); });
    }
    void close() {
        if (approved_ || !ready_) { DestroyWindow(window_); return; }
        if (closing_) return; closing_ = true;
        evaluate("Folio.canClose()", [this](json result, std::string failure) { closing_ = false; if (!failure.empty()) { error(failure); return; } if (result == true) { approved_ = true; DestroyWindow(window_); } });
    }
    void onMessage(ICoreWebView2WebMessageReceivedEventArgs* args) {
        std::string id;
        try {
            LPWSTR raw = nullptr; args->get_Source(&raw); if (!isLocal(takeString(raw))) return;
            check(args->get_WebMessageAsJson(&raw), "Read viewer message"); auto message = json::parse(utf8(takeString(raw)));
            id = message.value("id", ""); const auto type = message.value("type", ""); json result = nullptr;
            if (type == "callResult") { completeCall(message.value("callId", ""), message.value("value", json(nullptr)), message.value("error", "")); return; }
            if (type == "ready") {
                ready_ = true; sendState();
                if (!report_.empty()) { startTests(); return; }
                for (const auto& arg : args_) if (arg.rfind(L"--", 0) != 0 && fs::exists(arg)) { openPdf(arg); break; }
            } else if (type == "open") { auto path = fileDialog(false); if (!path.empty()) openPdf(path); }
            else if (type == "sample") openPdf(appDir_ / L"Assets" / L"Welcome to Folio.pdf");
            else if (type == "recent") { auto path = message.value("path", ""); for (const auto& recent : preferences_["Recent"]) if (recent.value("Path", "") == path) { openPdf(wide(path)); break; } }
            else if (type == "clearRecent") { preferences_["Recent"] = json::array(); persist(); sendState(); }
            else if (type == "theme") { preferences_["Theme"] = message.value("theme", "light") == "dark" ? "dark" : "light"; persist(); }
            else if (type == "loaded" && !currentPath_.empty()) {
                json recent = {{"Path", utf8(currentPath_.wstring())}, {"Name", utf8(currentPath_.filename().wstring())}, {"Opened", utcNow()}, {"Page", 1}, {"Pages", message.value("pages", 0)}};
                auto& files = preferences_["Recent"]; files.erase(std::remove_if(files.begin(), files.end(), [&](const json& item) { return item.value("Path", "") == utf8(currentPath_.wstring()); }), files.end());
                files.insert(files.begin(), recent); while (files.size() > 12) files.erase(files.end() - 1); persist(); sendState();
            } else if (type == "page" && !currentPath_.empty()) { for (auto& recent : preferences_["Recent"]) if (recent.value("Path", "") == utf8(currentPath_.wstring())) recent["Page"] = message.value("page", 1); persist(); }
            else if (type == "title") SetWindowTextW(window_, (wide(message.value("name", "PDF Reader")) + L" — Folio Win32").c_str());
            else if (type == "detached") currentPath_.clear();
            else if (type == "releaseStreams") responseStreams_.clear();
            else if (type == "activated") { auto url = message.value("url", ""), prefix = std::string("https://documents.folio.local/document/"); if (url.rfind(prefix, 0) == 0) { auto key = url.substr(prefix.size(), url.find('/', prefix.size()) - prefix.size()); auto found = documents_.find(key); if (found != documents_.end()) currentPath_ = found->second; } }
            else if (type == "confirmChanges") {
                if (!report_.empty()) throw std::runtime_error("Integration test reached an unexpected unsaved-change prompt.");
                int choice = MessageBoxW(window_, L"Save your changes before closing this document?\n\nYes: save a PDF copy\nNo: discard changes\nCancel: keep reading", L"Unsaved changes", MB_YESNOCANCEL | MB_ICONQUESTION);
                result = choice == IDYES ? "save" : choice == IDNO ? "discard" : "cancel";
            } else if (type == "saveStart") result = startSave(message.value("name", "document.pdf"));
            else if (type == "saveChunk") saveChunk(message.value("data", ""));
            else if (type == "saveEnd") { endSave(); result = true; }
            else if (type == "saveCancel") cleanupSave();
            reply(id, result);
        } catch (const std::exception& failure) { cleanupSave(); if (!id.empty()) reply(id, nullptr, failure.what()); else error(failure.what()); }
    }
    void appendTest(const json& value) { if (value.is_array()) { for (const auto& item : value) appendTest(item); } else if (value.is_object() && value.contains("passed")) testResults_.push_back(value); }
    void nextTest() { PostMessageW(window_, WM_FOLIO_STEP, 0, 0); }
    void testScript(std::string script, bool collect = true) { testSteps_.push_back([this, script = std::move(script), collect] { evaluate(script, [this, collect](json result, std::string failure) { if (!failure.empty()) { failTest(failure); return; } if (collect) appendTest(result); nextTest(); }); }); }
    void testOpen(const fs::path& path) { testSteps_.push_back([this, path] { openPdf(path, [this](json result, std::string failure) { if (!failure.empty() || result != true) { failTest("Test PDF did not open: " + failure); return; } nextTest(); }); }); }
    void captureTest(const wchar_t* name) {
        testSteps_.push_back([this, name = std::wstring(name)] {
            Com<IStream> stream; auto path = report_.parent_path() / name;
            if (FAILED(SHCreateStreamOnFileEx(path.c_str(), STGM_CREATE | STGM_WRITE | STGM_SHARE_DENY_NONE, FILE_ATTRIBUTE_NORMAL, TRUE, nullptr, stream.put()))) { nextTest(); return; }
            auto completed = handler<ICoreWebView2CapturePreviewCompletedHandler, HRESULT>([this, stream](HRESULT) { stream->Commit(STGC_DEFAULT); nextTest(); return S_OK; });
            if (FAILED(browser_->CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, stream.get(), completed.get()))) nextTest();
        });
    }
    void startTests();
    void failTest(const std::string& failure) { if (approved_) return; testResults_.push_back({{"test", "Native Win32 integration runner"}, {"passed", false}, {"error", failure}}); finishTests(); }
    void finishTests() {
        if (approved_) return;
        bool passed = !testResults_.empty(); for (const auto& test : testResults_) passed = passed && test.value("passed", false);
        json report = {{"passed", passed}, {"timestamp", utcNow()}, {"host", "Native C++ Win32 / WebView2; no CLR"}, {"tests", testResults_}};
        try { writeText(report_, report.dump(2)); } catch (...) {}
        approved_ = true; DestroyWindow(window_);
    }
};

#include "native_tests.hpp"

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int show) {
    SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32 | LOAD_LIBRARY_SEARCH_USER_DIRS);
    HRESULT initialized = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(initialized)) return 1;
    int result = 0;
    try {
        int count = 0; LPWSTR* raw = CommandLineToArgvW(GetCommandLineW(), &count); std::vector<std::wstring> args;
        for (int i = 1; i < count; ++i) args.emplace_back(raw[i]); LocalFree(raw);
        FolioWindow app(instance, std::move(args)); if (!app.create(show)) throw std::runtime_error("Could not create the Folio window.");
        MSG message{}; while (GetMessageW(&message, nullptr, 0, 0) > 0) { TranslateMessage(&message); DispatchMessageW(&message); } result = static_cast<int>(message.wParam);
    } catch (const std::exception& failure) { MessageBoxW(nullptr, wide(failure.what()).c_str(), L"Folio", MB_OK | MB_ICONERROR); result = 1; }
    CoUninitialize(); return result;
}
