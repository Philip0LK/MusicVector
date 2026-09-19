# MusicVector · 乐北斗

English | [中文速览](#中文速览)

**Turn photos of numbered notation into practice pieces you can follow note by note.**

Upload a photo of a jianpu (numbered musical notation) score and MusicVector reads the pitches and rhythms, then plays them back on a real piano sound with exact note durations. Loop a single passage, slow it down, and practise your intonation against it.

Songs, source images and practice progress stay on your own computer. Nothing is uploaded, and no account is needed.

## Download

Get the files from the **Releases** page of this repository:

| File | What it is |
|---|---|
| `MusicVector-1.0-windows-x64.zip` | Desktop app (Windows 64-bit) |
| `MusicVector-1.0-android.apk` | Phone app (Android 8.0 or newer) |

The desktop download needs no separate runtime — it is all bundled. Unzip it into any **writable** folder (for example `D:\MusicVector`) and run it from there, not from inside the archive.

## Getting started

1. Double-click **`启动.cmd`** ("Start"). A console window flashes and closes on its own; your browser opens MusicVector and the service keeps running in the background.
2. Click **New song** and upload score photos: one page per image, as many pages as you like. Images only (PNG / JPEG / WebP) — convert PDFs to images first.
3. Open **Settings** once, enter your model API key and verify it. Recognition calls a vision model online; the key is encrypted for the current Windows user and stored on this machine only, so you enter it again on another computer.
4. Click **Start recognition**. Each page is split into staff lines and recognised line by line. Results are saved before they are returned, so nothing is lost if the computer is switched off mid-way.
5. Recognition is never perfectly accurate — fix what is wrong in **Correct score** ("修正乐谱") and save.
6. Back on the practice page, click any note to start practising from there.

Double-click **`停止.cmd`** ("Stop") when you are done. Closing the browser does **not** stop the background service.

## While practising

- **Click any note** to start playback there; **select a passage** to loop only that part.
- **Speed** offers five presets — 0.5× / 0.75× / 0.9× / 1× / 1.1× — plus fine adjustment from 0.25× to 1.25×.
- **Every note lasts exactly its written value**: an eighth note is half a quarter note, so what you hear matches the page and the rhythm is not smeared by note tails.
- The **original score image** sits above the **recognised notation**, and the image zooms for side-by-side comparison.
- **Preview the current note on its own** — it plays that single note in full, which is what you want when checking intonation.

## Practising on a phone

The phone app does three things only: scan to receive a song, open a received song, delete one you no longer want. It cannot edit — editing stays on the desktop.

1. Phone and computer on the **same Wi-Fi**.
2. Copy `乐北斗.apk` to the phone and install it.
3. Open a song on the computer and click **Send to phone** ("发送到手机") to the right of the time signature — a QR code appears.
4. Scan the code with the phone app and the song is transferred, so you can practise without the computer afterwards.

Worth knowing:

- The QR code is **valid for ten minutes** and is voided when you close the send panel. Other people on the same network cannot see your library or your key — only that one temporary song can be fetched.
- If it will not connect, first check that both devices really are on the same network; when Windows Firewall asks, allow **private networks**.
- **Do not use ping** to diagnose network trouble: many networks block ping while the transfer itself works fine.

## Data and backup

Everything lives in the `data` folder inside the program directory:

```text
data/
├── library.json          song index
├── settings.json         settings
├── practice.json         where you last practised
└── songs/<song id>/
    ├── song.json         the song: notes, rhythm, key
    ├── images/           source images
    └── recognition/      recognition records
```

- **Backup**: stop the program, then copy the whole `data` folder somewhere safe — that is a complete backup.
- **Moving to another computer**: copy the whole MusicVector folder across; only the model key has to be entered again.
- **Restore**: save the current `data` aside first, then replace it wholesale. Never mix single files from different backups.
- **Starting over**: stop the program and delete the `data` folder; the next start gives you an empty library.
- If the program is interrupted, unfinished saves are recovered automatically on the next start.

## FAQ

**No sound?** Check the browser and system volume first. The first playback has to load the piano samples, so give it a second or two.

**Recognition fails with no output?** Recognition needs a network connection. Check that the key has been verified and the network works. Nothing is retried automatically; the model's raw reply is kept so the cause can be traced.

**The result is wrong overall?** Try a clearer photo: straight on, even lighting, no tilt, no glare. Recognition quality mostly follows photo quality.

**Port already in use?** The program picks another free port automatically — trust the address that opened in your browser. Double-clicking `启动.cmd` again only opens the instance that is already running.

**Does it work offline?** Practising, playback and phone transfer do, as long as phone and computer share a Wi-Fi network. Only recognition needs the internet.

**Can I use a different model?** Yes. Settings offers Kimi, Zhipu GLM, DeepSeek and Qwen, the endpoint can be changed, and other OpenAI-compatible services work as well.

## License and credits

- Released under the [MIT License](LICENSE).
- The bundled piano sound is Salamander Grand Piano V3, licensed CC BY 3.0.
- Sources and licences of the bundled runtime and open-source libraries are listed in `THIRD_PARTY_NOTICES.md`.

## 中文速览

乐北斗 MusicVector：把简谱照片变成可以逐音跟练的练习曲。识别出音高和节奏后，用真实钢琴音色按准确时值演奏，可以只听某一段、循环那一小段、放慢速度。曲目和练习记录都保存在你自己的电脑上，不上传，也不需要账号。

- **下载**：在本仓库 **Releases** 页面下载 `MusicVector-1.0-windows-x64.zip`（电脑端，已自带运行环境）或 `MusicVector-1.0-android.apk`（手机端，安卓 8.0 及以上）。解压到**可以写入**的目录，不要直接在压缩包里运行。
- **开始**：双击 `启动.cmd` → 新建歌曲、上传乐谱照片 → 在设置里填模型密钥并验证 → 开始识别 → 用「修正乐谱」改错 → 回训练页点任意一个音开始练。用完双击 `停止.cmd`（关闭浏览器不会停止服务）。
- **手机端**：手机与电脑连同一个 Wi-Fi，电脑上打开曲目后点「发送到手机」出现二维码，手机扫码接收，二维码十分钟内有效。手机端只能收曲目、打开和删除，改谱仍在电脑上做。
- **数据与网络**：全部内容都在程序目录的 `data` 文件夹里，停止程序后整体复制走就是完整备份；识别需要联网，练习和播放不需要。
- **许可**：MIT；内置钢琴音色为 Salamander Grand Piano V3（CC BY 3.0）。
