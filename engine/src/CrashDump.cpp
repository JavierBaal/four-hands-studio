// Kept apart from JUCE so <windows.h> and <dbghelp.h> do not meet its headers.
#include "CrashDump.h"

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <dbghelp.h>
#include <cwchar>

namespace
{
wchar_t dumpPath[MAX_PATH] = {};

LONG WINAPI writeDump (EXCEPTION_POINTERS* info)
{
    HANDLE file = CreateFileW (dumpPath, GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file != INVALID_HANDLE_VALUE)
    {
        MINIDUMP_EXCEPTION_INFORMATION exception {};
        exception.ThreadId = GetCurrentThreadId();
        exception.ExceptionPointers = info;
        exception.ClientPointers = FALSE;
        MiniDumpWriteDump (GetCurrentProcess(), GetCurrentProcessId(), file, MiniDumpWithThreadInfo, &exception, nullptr, nullptr);
        CloseHandle (file);
    }
    return EXCEPTION_CONTINUE_SEARCH;
}
} // namespace

void fh::installCrashDump (const wchar_t* path)
{
    if (path == nullptr || path[0] == 0)
        return;
    wcsncpy (dumpPath, path, MAX_PATH - 1);
    SetUnhandledExceptionFilter (writeDump);
}
#else
void fh::installCrashDump (const wchar_t*) {}
#endif
