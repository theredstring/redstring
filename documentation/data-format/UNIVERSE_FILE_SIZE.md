# Universe File Size

How Redstring reads and writes a `.redstring` file that is too big to handle as one piece of text, and the limits that remain.

## Why

A `.redstring` file used to be one JavaScript string on its way to and from disk. A string can't be longer than about 536 million characters, and well before that the window that has to hold one can run out of room. In October 2026 a universe holding all of Mondo (59,029 Things, 47,358 webs) saved as a 512 MB file, and the app then crashed every time it tried to open it: Electron read the file as text and handed the window a string of 512 million characters, about 1 GB in memory.

## The rules

- **Files are bytes, built and read a piece at a time** (`src/formats/universeBytes.js`).
  - `serializeRedstring` builds the file straight into UTF-8 bytes. It walks the top few levels of the exported universe and stringifies each Thing, web and entry on its own, so no piece of text is bigger than one of them. The bytes are exactly those of `JSON.stringify(data, null, indent)`, without building that string; the tests hold it to this byte for byte, over real universes, random values built to hit `JSON.stringify`'s corners, and the 512 MB Mondo file itself.
  - `parseRedstringBytes` reads a file under 64 MB with `JSON.parse`, as files always were read. A bigger one goes through `@streamparser/json` 4 MB at a time, yielding to the window between slices. Both give the same object (including a `__proto__` key kept as data, the last of two same keys, a skipped byte-order mark, and the same refusals of broken or truncated files).
- **A large universe is written compact.** At 5,000 Things plus webs (`COMPACT_AT`) the file has no indentation, about a third smaller. A smaller universe stays pretty-printed, byte for byte as before. Nothing in the app compares universe files as text: conflicts are decided by comparing contents (`semanticHash.js`), so the two shapes behave the same everywhere.
- **Every writer uses it**: the save worker, the local file write and its main-thread fallbacks (quit, hide, Save Now), the legacy file storage, and Git sync. The local write takes the worker's bytes as they are (until this change it accepted only text, so every autosave threw the worker's bytes away and serialized again on the main thread).
- **Every local reader uses it**: loading a linked file, Link Existing File, Load from Local File, Open, Open Recent, auto-connect, and the two checks that read a file before writing it (workspace adoption, the empty-write guard). Electron reads through `file:readBytes`, which returns the file's bytes and never decodes them to text. A window reloaded onto an older preload (main and preload change only on restart) falls back to the text read.

## Limits that remain

- **Git sync carries at most 50 MB** (`GIT_WRITE_CAP_BYTES` in `gitSyncEngine.js`): the most any device reads back (`maxGitReadBytes`; 25 MB on mobile). A bigger commit is refused with a status message, nothing is written, and the engine stops fingerprinting and building that universe (both mean holding it whole on the main thread) until its Things and webs shrink enough to fit, judged from the refused commit's bytes per Thing or web.
- **Every save still writes the whole file.** It's built off the main thread and written atomically (temp file, then rename), but a 350 MB universe means 350 MB written per save.
- **Memory.** The 512 MB Mondo file loads in a Chromium window in about 6 s (read 0.2 s, parse 5.2 s with the window never held more than about 0.1 s at a time, import 0.7 s) at about 1.6 GB of JavaScript heap, and the save worker writes it back compact (349 MB) in about 4 s.
- **Quit.** Electron gives the window 5 s to finish a quit save. A very large universe whose last change hasn't been saved yet may not make it; the write is atomic, so the file on disk is never damaged, only the last few seconds of changes are lost.
- **Mobile** reads files as text through the Capacitor bridge; its other read paths cap files at 25 MB.
- **The wizard bridge** shares at most 19 MB of state, and a universe too big to share at all is treated as too large rather than retried.

## Next

Splitting a universe into several files, so a save rewrites only what changed and Git can carry a large universe in pieces, is the direction (agreed 2026-10-09). It needs its own design: the file layout, how Git sync and conflicts work across pieces, and how older versions of the app see a split universe.
