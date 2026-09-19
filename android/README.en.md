English | [中文](README.md)

# 乐北斗 · Phone practice client (Android)

The desktop side sends **already calibrated** pieces to the phone via a QR code; the phone practises note by note in landscape.
The phone side **only receives and plays back**: no recognition, no proofing, no score editing, no editing capability beyond song management.

## How to use it

1. Open the piece on the desktop side and click 「发送到手机」("Send to phone") in the training area's top bar, **next to the time signature**.
2. A QR code appears on the computer (valid for about 10 minutes).
3. Open this App on the phone → 「扫描二维码接收曲目」("Scan QR code to receive song") → point it at the QR code.
4. Once receiving finishes, the practice page opens automatically; after that you **can practise even offline** (the data is already stored on the phone).

Because the original score image is about 1.6 MB, the QR code can only carry an address, so:

- The phone and the computer must be on the **same Wi‑Fi**;
- On the desktop side, just run `npm run dev`——this single command starts the UI, the 「发送到手机」("Send to phone") service and the LAN listener at the same time, and when it detects a phone connected for USB debugging it will also take care of `adb reverse` and launch this App. After startup the terminal prints the address the phone should use.
- The desktop panel states this directly.

If you cannot connect, troubleshoot in this order:

- **Do not use ping to judge connectivity**: campus and hotel networks often block only ICMP——`ping` shows 100% packet loss, but HTTP itself works.
  This has been observed in practice: on the same campus network, ping to the computer failed completely, yet receiving by QR code scan on the phone worked perfectly. Trust the prompt in the App.
- Confirm that the desktop side was started with `npm run dev`, and that the address shown on the panel is on the same subnet as the phone (if it was started with `npm run dev:local`, it only listens on the local machine, and the panel says so directly).
- Windows Firewall on the computer must allow Node inbound (a dialog usually pops up on first launch; choose 「允许」("Allow")).
- If you really hit client isolation (two devices on the same Wi‑Fi cannot reach each other), turn on a hotspot on one device and connect the other one to it.

## Interface and controls

Landscape. At the top are the song title, `1=E4` (the reference register) and the time signature, with settings at the top right; in the middle is the whole song in a continuous scroll, with the **original score image on the upper line and the jianpu on the lower line**; at the bottom is the playback bar.

Playback behaviour aligned item by item with the desktop side:

| Desktop side | Phone side |
| --- | --- |
| Space to play/pause | 「播放/暂停」("Play/Pause") button |
| Enter to audition the current note | 「试听当前音」("Audition current note") |
| When the current note has not been played yet, ←→ auditions only the current note the first time, and only changes note the second time | 「上一音/下一音」("Previous note/Next note") follows the same rule |
| Play from the beginning (from the segment start when there is a selection) | 「从头播放」("Play from the beginning") |
| Selection + automatic segment loop (1 second between rounds) + cancel selection | 「选段」("Select segment") + tap the start and end notes on the score |
| Speed 0.5/0.75/0.9/1/1.1, step 0.05, 0.25–1.25 | 「速度」("Speed") sheet, the same set of values |
| Changing speed during playback reschedules from the current note | Same |
| Automatic follow-scroll; manual scrolling stops following + 「回到当前音」("Back to current note") | Same (a finger scroll stops following) |
| Rests only advance the timeline; tied repeats of the same pitch are merged into a single sound | Same (tie relationships are computed by the desktop side) |
| Samples are preloaded before playback; an individual sample failure only downgrades that pitch | The samples this song needs are decoded before playback; a missing pitch is simply muted |
| Speed/position persistence | Same (stored on the device per song) |

In settings you can change the **reference register** (`1=E4`, which transposes the whole song) and the **BPM** (the original tempo corresponding to 1×). These two only affect practice of this one song on the phone and are never written back to the desktop side.

### Sound generation rules (same source as the desktop side)

What the product needs is **exact duration ratios**: an eighth note is exactly twice a sixteenth note, a dotted note exactly one and a half times. So each note's audible window
**is exactly equal to its own duration**, and the fade in/out is scaled in proportion to the duration (fade-in ≤ 20% of the duration, tail ≤ 30%), so the ratio is not broken by the fade-out
and there is no hard-cut pop. The desktop side (`src/lib/envelope.js`) and the phone side (`PcmMixer.kt`) are two implementations of the same set of rules,
each pinned by its own tests: `tests/envelope.test.mjs` and `SoundLengthTest.kt`.

Earlier on, both sides used "duration + a fixed 35ms tail", and that fixed tail squeezed the ratio down to 1.87 (455+35 : 227+35) instead of 2;
both sides have now been changed to exact ratios.

**Auditioning the current note is the exception**: the audition does not cut to the score duration but simply lets the sample ring out naturally (a low note will ring for ten or twenty seconds),
which is the only way to hear a note clearly; the whole sample is decoded on demand, and only the one or two pitches that were tapped are affected.

### Other differences

- No keyboard shortcuts (phones have no keyboard); ↑↓ to switch lines is replaced by tapping/scrolling.
- Only the medium piano sample set is included.

## Directory

```
app/src/main/java/com/yuebeidou/player/
├── model/      Song package parsing, playback plan, pitch (Ports of desktop JS)
├── score/      Glyph layout geometry, crop rectangles
├── audio/      Sample decoding (MediaCodec) + AudioTrack streaming mixing, per-frame timing values
├── handoff/    Address parsing and download of QR scan results
├── storage/    Song persistence
├── settings/   Reference register / BPM / speed
└── ui/         Practice page, song page, state machine
app/src/main/assets/piano/      30 medium samples (the same naming as the desktop side)
app/src/test/resources/fixtures/ golden standards generated by the desktop side
```

## Build

The toolchain (JDK 17 + Android SDK + Gradle 8.10.2) is not put in the repository. The scripts look in order for the
`YUEBEIDOU_TOOLING` environment variable → the `.tooling` directory junction inside the project. First use:

```powershell
# Point at the toolchain already installed on this machine (or set the YUEBEIDOU_TOOLING environment variable)
New-Item -ItemType Junction -Path .\.tooling -Target E:\AI\知音音韵\zhiyin\.tooling

# Unit tests
.\scripts\gradle-local.ps1 :app:testDebugUnitTest

# Build the package (adding -Install runs adb install -r)
.\scripts\build-apk.ps1
.\scripts\build-apk.ps1 -Install

# After installing on the device: auto install, launch, screenshot and collect logcat (screenshots and crash records go to qa/)
.\scripts\verify-device.ps1
```

The project path contains Chinese characters, which AGP does not accept, so the scripts first map a drive letter with `subst` and then build.

## Tests

`app/src/test/.../DesktopParityTest.kt` is the core guarantee of "consistent with the desktop side": the expected values come from
`tools/mobile-fixtures.mjs` in the root directory of the desktop repository, and cover the playback plan (tie merging, dotted notes, rests, ranges, speed,
multiple BPMs), pitch offset and reference register changes, measure layout glyphs, and crop rectangles.

`SoundLengthTest.kt` keeps an eye on sound generation: the audible window is exactly equal to the duration, the durations are in exact integer ratios to one another (16:8:4:2:whole = 1:2:4:8:16,
a dotted note exactly 1.5×), and the tolerance allows only the rounding error of a single sample frame. Any "fixed extra time" or "fixed deducted time" will make it fail——
the "a sixteenth note is even faster than twice as fast" that users actually observed was the latter.

One round of settling on sound quality (2026-09-18): `SoundPool` was used originally, calling `stop` at the planned moment, and since `SoundPool` has a device output latency when it starts,
the same latency was deducted from every note, so short notes lost a larger proportion and sixteenth notes were heard as "even faster than twice as fast". It has now been changed to decoding PCM ourselves +
`AudioTrack` streaming mixing, with both the onset and the tail landing on sample frames; measured `AudioTrack.underrunCount = 0`.

After the desktop side changes its playback or layout algorithm, the fixtures must be regenerated, otherwise both the Node side's `tests/handoff.test.mjs`
and the Android side's `DesktopParityTest` will fail:

```powershell
cd ..
npm run fixtures:mobile
```

## On-device verification (when there is no usable Wi-Fi near the computer)

With a USB debugging connection you can verify entirely without the network——`adb reverse` forwards the phone's `127.0.0.1:4177` to port 4177 on the computer,
and then a deep link hands the song address straight to the App, so no camera scan is needed:

```powershell
adb reverse tcp:4177 tcp:4177
# Open a piece on the desktop side, click 「发送到手机」("Send to phone"), and copy the address from the panel (the phone port is 4177)
adb shell am start -a android.intent.action.VIEW -d "yuebeidou://receive?u=<urlencoded address>"
# Screenshots, precise tapping by text, crash checks
.\scripts\verify-device.ps1
node scripts\ui-bounds.mjs qa\ui.xml
```

Record of testing on a real device (Redmi 23013RK75C / Android 15 / landscape 914×411dp):

- **Camera scan → receive**: on a campus network the user scanned the code themselves and imported 《太阳与地球》("The Sun and the Earth"), a piece from the desktop library (178 notes / 6 lines / 2 pages),
  and the manifest generation time on the phone matched the moment 「发送到手机」("Send to phone") was clicked on the desktop side, with all four page images present.
  On the same network `ping` to the computer showed 100% packet loss, but HTTP worked normally——do not draw conclusions from ping when troubleshooting.
- Receiving (with the real desktop address), the practice page's "image on top, score below" continuous scroll of the whole song, play/pause/automatic follow-scroll,
  previous note and next note (the first tap does not skip a note), auditioning the current note, selection looping (11 of 12 frames differed within 15 seconds, proving it really was replaying repeatedly),
  speed (0.5× shows 40 beats/minute), changing the key signature and reference register in settings with the change surviving a restart, and the prompts and ways out when the QR code expires or the computer cannot be reached,
  have all passed.

## Provenance and licence

The piano samples come from Salamander Grand Piano V3 (CC‑BY 3.0), see `THIRD_PARTY_NOTICES.md` in the repository root.
