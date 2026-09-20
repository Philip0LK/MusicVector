English | [中文](USER-GUIDE.zh-CN.md)

# 乐北斗 (MusicVector)

Open a console in the folder that contains this file (type `powershell` in the folder's address bar and press Enter) and run:

```powershell
.\runtime\node\node.exe .\app\launch.cjs
```

There is no need to install Node or Python, and no need to download dependencies. The default browser opens automatically once it starts, and the console window can be closed again — the service keeps running in the background. Starting it again later just opens the copy that is already running. Please extract the whole folder to a writable location and do not run it directly from inside the archive. (In `cmd.exe`, drop the `.\` prefixes.)

To stop the program, run the following in the same folder. Closing the browser does not stop the background service; if recognition is running, wait for it to finish or stop it first.

```powershell
.\runtime\node\node.exe .\app\server\server.mjs --home . --stop
```

## Getting started

When it opens you will see an empty library — just click **新建歌曲** ("New song") to upload a photo of your score and you can begin. Recognition first requires you to enter a model key under **设置** ("Settings") and verify it; the key is encrypted by the current Windows user and stored on this computer, and it is not included when you back up the library.

## Data and backup

All song data lives in the `data` folder in this directory. `library.json` is the song index, and under `songs/<ID>/` you will find `song.json` for the current song, `images` for the original and recognised images, `recognition` for the raw recognition records and `draft.json` for an unsubmitted draft. `settings.json` holds your settings and `practice.json` your practice position.

Clearing the browser cache, switching browsers or changing the port will not clear these files; just start the program again with the command above. If a change fails to save, the interface shows **未保存** ("Not saved"). If you see a notice that another window has updated the song, keep your current edits first and then refresh, so you do not overwrite the newer version.

To move to another computer: stop the program first, then copy the entire 乐北斗 folder. The key is encrypted by the current Windows user, so after changing computer or user you need to enter it again in the settings. The key is stored separately in `private/credentials` — do not send this folder to anyone else.

Backup: stop the program, then copy the whole `data` folder to a safe place. Restore: stop the program, first save the current `data` somewhere else, then replace it with the complete backup. Do not mix individual files from different backups. `data/backups` keeps the relevant files from before each change, for troubleshooting; it is not a complete library backup. Unfinished transactions are recovered automatically the next time you start the program.

## Phone app

Install `Android/MusicVector.apk` on your phone. If an Android phone already has the app, is connected over USB and allows USB debugging, it opens together with the start command — the app is never installed or overwritten automatically. Leaving the phone unplugged does not affect use on the computer.

On the computer, click **发送到手机** ("Send to phone") and scan the QR code with the phone app. The phone and computer should be on the same Wi-Fi network; if Windows Firewall asks, allow access on trusted private networks only. The QR code is valid for ten minutes, and closing the send panel releases it; only this one temporary song can be collected, and neither your library nor your key is reachable from the local network. If there is a port conflict the program switches ports automatically — use the QR code generated this time.

## Recognition and playback

Recognition still needs an internet connection to call the model, and you must verify your own API key in the settings. The geometry analysis runs on this computer, and the recognition results and process records are saved locally; a failure is not retried automatically. If the program closes unexpectedly, the saved part is kept and marked as interrupted.

The latest playback duration adjustments are kept on both desktop and phone: the sound envelope closes within each note's actual duration, and single-note preview on the phone keeps the full sample. The editor supports inline time-signature changes, a dedicated tool area for ties, and deleting a slur directly with `W` after selecting its starting point.

Runtime logs are in `data/logs/startup.log`. At present only a Windows x64 portable package is provided; the phone app requires Android 8.0 or later, and the installer is in the `Android` folder.
