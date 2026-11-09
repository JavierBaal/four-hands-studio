// Four Hands Engine: when the engine crashes on Windows (a plugin or the engine itself), it leaves a
// minidump next to its cache, so the next session can tell which module it was (09/11/2026: the
// engine went down once when opening a Kontakt window). No-op elsewhere.
#pragma once

namespace fh
{
/** `path`: where to write the dump (UTF-16 on Windows). Call once, early. */
void installCrashDump (const wchar_t* path);
} // namespace fh
