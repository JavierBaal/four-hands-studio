LAME MP3 encoder (lamejs) in Four Hands Studio
==============================================

Four Hands Studio makes MP3 files with lamejs, a JavaScript port of the LAME MP3 encoder
(https://lame.sourceforge.io), as published on npm by @breezystack/lamejs 1.2.7
(https://github.com/BreezyStack/lamejs). LAME and lamejs are licensed under the GNU Lesser
General Public License, version 3 (LGPL-3.0): see LGPL-3.0.txt, which refers to GPL-3.0.txt.

The library is not modified and is not bundled into the app: it is this folder's lamejs.mjs,
which Four Hands Studio loads when it makes an MP3. You may replace that file with a modified
or newer version that exports the same Mp3Encoder class. In an installed copy it is in
resources/app.asar.unpacked/dist/lame/.

Source code of the version shipped: https://www.npmjs.com/package/@breezystack/lamejs/v/1.2.7
