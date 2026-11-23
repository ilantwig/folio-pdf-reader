#pragma once
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <shlwapi.h>
#include <shellapi.h>
#include <shlobj.h>
#include <commdlg.h>
#include <objbase.h>
#include <atomic>
#include <functional>
#include <string>
#include <vector>
#include <stdexcept>
#include <filesystem>
#include <algorithm>
#if defined(__MINGW32__) && defined(__clang__)
// Preserve the SDK interface UUID attributes with LLVM-MinGW.
#undef MIDL_INTERFACE
#define MIDL_INTERFACE(id) struct __declspec(uuid(id))
#undef __uuidof
#endif
#include "vendor/WebView2.h"
#include "vendor/json.hpp"

using json = nlohmann::json;
namespace fs = std::filesystem;

template<class T> class Com {
    T* value_ = nullptr;
public:
    Com() = default;
    explicit Com(T* value, bool addRef = true) : value_(value) { if (value_ && addRef) value_->AddRef(); }
    Com(const Com& other) : Com(other.value_) {}
    Com(Com&& other) noexcept : value_(other.value_) { other.value_ = nullptr; }
    ~Com() { reset(); }
    Com& operator=(Com other) noexcept { std::swap(value_, other.value_); return *this; }
    void reset() { if (value_) value_->Release(); value_ = nullptr; }
    T* get() const { return value_; }
    T* operator->() const { return value_; }
    explicit operator bool() const { return value_ != nullptr; }
    T** put() { reset(); return &value_; }
    template<class U> Com<U> as() const { Com<U> result; if (value_) value_->QueryInterface(__uuidof(U), reinterpret_cast<void**>(result.put())); return result; }
};

template<class Interface, class... Args> class Callback final : public Interface {
    std::atomic<ULONG> references_{1};
    std::function<HRESULT(Args...)> function_;
public:
    explicit Callback(std::function<HRESULT(Args...)> function) : function_(std::move(function)) {}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id, void** out) override {
        if (!out) return E_POINTER;
        *out = nullptr;
        if (IsEqualIID(id, IID_IUnknown) || IsEqualIID(id, __uuidof(Interface))) { *out = static_cast<Interface*>(this); AddRef(); return S_OK; }
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++references_; }
    ULONG STDMETHODCALLTYPE Release() override { auto result = --references_; if (!result) delete this; return result; }
    HRESULT STDMETHODCALLTYPE Invoke(Args... args) override { try { return function_(args...); } catch (...) { return E_FAIL; } }
};
template<class I, class... A, class F> Com<I> handler(F&& function) { return Com<I>(new Callback<I, A...>(std::forward<F>(function)), false); }

inline std::string utf8(const std::wstring& text) {
    if (text.empty()) return {};
    int count = WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0, nullptr, nullptr);
    std::string result(count, '\0'); WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), result.data(), count, nullptr, nullptr); return result;
}
inline std::wstring wide(const std::string& text) {
    if (text.empty()) return {};
    int count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, text.data(), static_cast<int>(text.size()), nullptr, 0);
    if (!count) throw std::runtime_error("Invalid UTF-8 text.");
    std::wstring result(count, L'\0'); MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), result.data(), count); return result;
}
inline std::wstring takeString(LPWSTR value) { std::wstring result = value ? value : L""; CoTaskMemFree(value); return result; }
inline void check(HRESULT code, const char* action) { if (FAILED(code)) { char text[256]; snprintf(text, sizeof(text), "%s (0x%08lX)", action, static_cast<unsigned long>(code)); throw std::runtime_error(text); } }
inline std::string guid() { GUID id; check(CoCreateGuid(&id), "Create document token"); wchar_t text[40]; StringFromGUID2(id, text, 40); std::wstring value(text); value.erase(std::remove_if(value.begin(), value.end(), [](wchar_t c) { return c == L'{' || c == L'}' || c == L'-'; }), value.end()); return utf8(value); }
inline std::string readText(const fs::path& path) {
    HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) throw std::runtime_error("Could not read " + utf8(path.wstring()));
    LARGE_INTEGER size{}; if (!GetFileSizeEx(file, &size) || size.QuadPart < 0 || size.QuadPart > 32 * 1024 * 1024) { CloseHandle(file); throw std::runtime_error("Text file is too large."); }
    std::string result(static_cast<size_t>(size.QuadPart), '\0'); DWORD read = 0;
    BOOL ok = ReadFile(file, result.data(), static_cast<DWORD>(result.size()), &read, nullptr); CloseHandle(file);
    if (!ok || read != result.size()) throw std::runtime_error("Could not finish reading the file."); return result;
}
inline void writeBytes(const fs::path& path, const void* data, size_t size) {
    HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) throw std::runtime_error("Could not write " + utf8(path.wstring()));
    DWORD written = 0; BOOL ok = WriteFile(file, data, static_cast<DWORD>(size), &written, nullptr); FlushFileBuffers(file); CloseHandle(file);
    if (!ok || written != size) throw std::runtime_error("Could not finish writing the file.");
}
inline void writeText(const fs::path& path, const std::string& text) { writeBytes(path, text.data(), text.size()); }
inline std::string utcNow() { SYSTEMTIME now; GetSystemTime(&now); char text[40]; snprintf(text, sizeof(text), "%04u-%02u-%02uT%02u:%02u:%02uZ", now.wYear, now.wMonth, now.wDay, now.wHour, now.wMinute, now.wSecond); return text; }

// A real streaming file response, with delete sharing for atomic Save As over a
// source PDF. The renderer can finish reading its old handle after replacement.
class ReadStream final : public IStream {
    std::atomic<ULONG> references_{1}; HANDLE file_;
public:
    explicit ReadStream(const fs::path& path) : file_(CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr)) { if (file_ == INVALID_HANDLE_VALUE) throw std::runtime_error("Document is not available."); }
    ~ReadStream() { CloseHandle(file_); }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id, void** out) override { if (!out) return E_POINTER; *out = nullptr; if (IsEqualIID(id, IID_IUnknown) || IsEqualIID(id, IID_ISequentialStream) || IsEqualIID(id, IID_IStream)) { *out = static_cast<IStream*>(this); AddRef(); return S_OK; } return E_NOINTERFACE; }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++references_; }
    ULONG STDMETHODCALLTYPE Release() override { auto result = --references_; if (!result) delete this; return result; }
    HRESULT STDMETHODCALLTYPE Read(void* data, ULONG count, ULONG* read) override { DWORD actual = 0; if (!ReadFile(file_, data, count, &actual, nullptr)) return HRESULT_FROM_WIN32(GetLastError()); if (read) *read = actual; return actual == count ? S_OK : S_FALSE; }
    HRESULT STDMETHODCALLTYPE Write(const void*, ULONG, ULONG*) override { return STG_E_ACCESSDENIED; }
    HRESULT STDMETHODCALLTYPE Seek(LARGE_INTEGER offset, DWORD origin, ULARGE_INTEGER* position) override { if (origin > STREAM_SEEK_END) return STG_E_INVALIDFUNCTION; LARGE_INTEGER result{}; if (!SetFilePointerEx(file_, offset, &result, origin)) return HRESULT_FROM_WIN32(GetLastError()); if (position) position->QuadPart = result.QuadPart; return S_OK; }
    HRESULT STDMETHODCALLTYPE SetSize(ULARGE_INTEGER) override { return STG_E_ACCESSDENIED; }
    HRESULT STDMETHODCALLTYPE CopyTo(IStream* other, ULARGE_INTEGER count, ULARGE_INTEGER* read, ULARGE_INTEGER* written) override {
        if (read) read->QuadPart = 0; if (written) written->QuadPart = 0;
        unsigned char buffer[65536]; ULONGLONG total = 0;
        while (total < count.QuadPart) { ULONG actual = 0, output = 0; HRESULT result = Read(buffer, static_cast<ULONG>(std::min<ULONGLONG>(sizeof(buffer), count.QuadPart - total)), &actual); if (FAILED(result)) return result; if (!actual) break; result = other->Write(buffer, actual, &output); total += actual; if (read) read->QuadPart += actual; if (written) written->QuadPart += output; if (FAILED(result) || output != actual) return STG_E_WRITEFAULT; } return S_OK;
    }
    HRESULT STDMETHODCALLTYPE Commit(DWORD) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE Revert() override { return STG_E_INVALIDFUNCTION; }
    HRESULT STDMETHODCALLTYPE LockRegion(ULARGE_INTEGER, ULARGE_INTEGER, DWORD) override { return STG_E_INVALIDFUNCTION; }
    HRESULT STDMETHODCALLTYPE UnlockRegion(ULARGE_INTEGER, ULARGE_INTEGER, DWORD) override { return STG_E_INVALIDFUNCTION; }
    HRESULT STDMETHODCALLTYPE Stat(STATSTG* info, DWORD) override { if (!info) return E_POINTER; *info = {}; info->type = STGTY_STREAM; info->grfMode = STGM_READ; LARGE_INTEGER size; if (!GetFileSizeEx(file_, &size)) return E_FAIL; info->cbSize.QuadPart = size.QuadPart; return S_OK; }
    HRESULT STDMETHODCALLTYPE Clone(IStream**) override { return E_NOTIMPL; }
};
