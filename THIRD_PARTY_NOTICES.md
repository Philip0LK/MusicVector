[English](THIRD_PARTY_NOTICES.en.md) | 中文

# 第三方资源声明

## Salamander Grand Piano V3

本项目内置的钢琴 OGG 采样来自 Salamander Grand Piano V3。

- 原作者：Alexander Holm
- 原始音源：https://archive.org/details/SalamanderGrandPianoV3
- 许可：Creative Commons Attribution 3.0 Unported（CC BY 3.0）
- 许可文本：https://creativecommons.org/licenses/by/3.0/

本项目选用了原音源的三个力度层，并采用按小三度采样、相邻音高少量变调的方式播放。

手机练习端（`android/`）在安装包里内置了其中 medium 一档的 30 个采样文件，未做任何音频改动。

## @audio-samples/piano-velocity*

OGG 文件通过 Jan Forst 维护的 `@audio-samples/piano-velocity3`、`piano-velocity6` 和 `piano-velocity8` 1.0.5 包获取。

- 项目：https://github.com/darosh/samples-piano
- 打包代码许可：MIT
- 音频采样许可：CC BY 3.0，作者 Alexander Holm

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


## 随包运行环境

Node.js 24.14.0 的许可及内置依赖声明位于 `runtime/node/LICENSE`；Python 3.12.14 位于 `runtime/python/LICENSE.txt`。OpenCV 4.12.0.88、NumPy 2.2.6、Pillow 11.3.0 的完整许可及捆绑库声明保留在 `runtime/python/Lib/site-packages/*dist-info/`。ADB 的声明位于 `runtime/adb/NOTICE.txt`。

前端与本地服务的第三方 JavaScript 许可汇集于 `licenses`，包括 React、React DOM、AI SDK、各模型适配器、qrcode-generator 及其依赖。版本由源码 package-lock.json 锁定。

## Android 应用

保留现有 Android 应用及签名，便于覆盖升级已有安装；未改变手机数据格式。使用 AndroidX Activity/Compose/Lifecycle（Android Open Source Project）、Kotlin（JetBrains）、ZXing core（ZXing authors）与 ZXing Android Embedded 4.3.0（Journey Mobile）。这些库采用 Apache License 2.0；许可及 ZXing 声明位于 `licenses/mobile`。对应源码：

- https://android.googlesource.com/platform/frameworks/support/
- https://github.com/JetBrains/kotlin
- https://github.com/zxing/zxing
- https://github.com/journeyapps/zxing-android-embedded

手机音频来源及署名同上。
