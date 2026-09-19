English | [中文](THIRD_PARTY_NOTICES.md)

# Third-party notices

## Salamander Grand Piano V3

The piano OGG samples bundled with this project come from Salamander Grand Piano V3.

- Original author: Alexander Holm
- Original sound source: https://archive.org/details/SalamanderGrandPianoV3
- License: Creative Commons Attribution 3.0 Unported (CC BY 3.0)
- License text: https://creativecommons.org/licenses/by/3.0/

This project uses three velocity layers of the original sound source, and plays them by sampling every minor third with a small amount of pitch shifting for adjacent pitches.

The mobile practice app (`android/`) bundles 30 sample files from the medium layer in its installation package, with no audio changes made.

## @audio-samples/piano-velocity*

The OGG files were obtained through the `@audio-samples/piano-velocity3`, `piano-velocity6` and `piano-velocity8` 1.0.5 packages maintained by Jan Forst.

- Project: https://github.com/darosh/samples-piano
- Packaging code license: MIT
- Audio sample license: CC BY 3.0, author Alexander Holm

MIT License

Copyright (c) 2019 Jan Forst

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


## Bundled runtime environment

The license for Node.js 24.14.0 and the notices for its built-in dependencies are in `runtime/node/LICENSE`; those for Python 3.12.14 are in `runtime/python/LICENSE.txt`. The full licenses for OpenCV 4.12.0.88, NumPy 2.2.6 and Pillow 11.3.0, together with the notices for bundled libraries, are kept in `runtime/python/Lib/site-packages/*dist-info/`. The ADB notices are in `runtime/adb/NOTICE.txt`.

Third-party JavaScript licenses for the front end and the local service are collected in `licenses`, including React, React DOM, AI SDK, the individual model adapters, qrcode-generator and their dependencies. Versions are pinned by the source package-lock.json.

## Android app

The existing Android app and its signature are kept, so that existing installations can be upgraded in place; the phone data format is unchanged. It uses AndroidX Activity/Compose/Lifecycle (Android Open Source Project), Kotlin (JetBrains), ZXing core (ZXing authors) and ZXing Android Embedded 4.3.0 (Journey Mobile). These libraries use the Apache License 2.0; the licenses and the ZXing notices are in `licenses/mobile`. Corresponding source code:

- https://android.googlesource.com/platform/frameworks/support/
- https://github.com/JetBrains/kotlin
- https://github.com/zxing/zxing
- https://github.com/journeyapps/zxing-android-embedded

The phone audio source and attribution are as above.
