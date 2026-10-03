[English](DEVELOPMENT.en.md) | 中文

# 开发说明

面向改这个仓库的人。第一次使用产品的说明在 [README.md](./README.md)。

## 准备

- Node 20 或更高（`node -v` 能看到即可）。
- `npm ci` 安装依赖。
- `runtime/` 是随包运行环境（Node + Python + ADB），不进仓库。没有它也能跑界面，但**图片切片会失败**——切片由 `runtime/python/python.exe` 执行。从发行包里拷一份过来即可。

## 开发（改代码即时生效）

```bash
npm run dev                      # 用仓库内 data/ 作为曲库
npm run dev -- --data <目录>      # 指定曲库目录
npm run dev -- --port 5180       # 指定 Vite 端口（被占用会自动往后找）
npm run dev -- --no-open         # 不自动打开浏览器
```

命令会同时起两件事：**产品服务**（曲库、图片、切片、识别、发送到手机都在它那儿）和 **Vite**（前端源码与热更新）。浏览器连的是 Vite，`/api`、`/media`、`/handoff` 由 Vite 反向代理转给产品服务，所以：

- 改 `src/` 里的文件保存后，页面自动更新，不用重新构建、不用手动刷新；
- 界面上的功能全部走真实服务，和打包后的行为一致。

代理的认证由 `tools/dev.mjs` 处理（注入启动令牌、改写 Host、去掉写请求的 Origin），产品代码不需要为开发模式做任何改动。

停止：在终端按 `Ctrl+C`。

## 测试

```bash
npm test               # 单元测试（算法、协议、存储、几何）
npm run test:ai        # 空库 → 识别（本地模拟模型）→ 校对 → 播放 全链路
npm run test:release   # 便携包验收：复制两份真实启动，验证端口隔离、上传切片、重启保留
npm run test:editor    # 编辑工具栏在三档分辨率下的稳定性
npm run fixtures:mobile  # 改了播放/排版算法后，重新生成手机端金标准夹具
```

个别单元测试需要 `local/fixtures` 下的个人曲谱夹具；没有它们时那些用例会明确跳过（`skipped`），其余照常运行。

## 手机端

```bash
cd android
./scripts/gradle-local.ps1 :app:testDebugUnitTest :app:assembleDebug
```

- 工具链（JDK 17 + Android SDK + Gradle）不在仓库里：设 `YUEBEIDOU_TOOLING` 指向它，或在 `android/` 下建一个指向它的 `.tooling` 目录联接。
- 调试版包名是 `com.yuebeidou.player.debug`，可与正式版同时安装。
- 正式签名：把 `keystore.properties.example` 复制成 `keystore.properties` 并填好，`assembleRelease` 就会用它签名；该文件与密钥库都不进仓库。

## 打包

只维护一份源码。公开包与个人包从指定提交的临时工作副本生成；开发目录的未提交改动不会进入候选包。

首次配置：运行 `tools/install-gitleaks.ps1` 安装固定版本的密钥扫描器，运行 `npm run setup:git` 启用提交与推送检查。保留 `runtime/` 和被忽略的 `android/keystore.properties`；通过 `YUEBEIDOU_TOOLING` 或本机 `local/release-settings.json` 指定 Android 工具链。签名密钥继续放在仓库外。

```powershell
npm run release:prepare -- --ref <完整提交号或版本标签>
npm run release:prepare -- --ref <完整提交号或版本标签> --with-data <曲库目录>
```

入口会安装锁定依赖，运行原测试、本机 UI 回归和发布检查，重新构建正式 APK，校验原签名，验收空库包，再生成压缩包。个人包另外复制并校验曲库快照。全程使用隔离副本；结果在 `releases/candidates/`，以 `验收记录.json` 的状态为准。失败候选保留日志。

正式上传前：统一修改 package.json、package-lock.json 和 Android 版本，增加 Android versionCode，提交并重建候选；选一个未使用的标签，再运行：

```powershell
npm run release:verify -- --run <候选目录> --tag v1.1.0
```

`v1.1.0` 仅为格式示例。复核拒绝个人包、已使用标签、未增加的 versionCode 和被改写的附件。负责人确认代码与附件后，才推送分支/标签并上传 GitHub Release。本机生成候选不会自动公开。

`npm run package` 是组包组件，要求来源提交干净、前端与服务端构建记录一致、正式 APK 记录与版本/签名/校验值一致，不再回退到调试 APK。常规开发仍可运行 `npm run build`。

## 日常 Git

使用本机任务分支开发，按实际目的提交；确认后才推送公开远端。`npm run check:publish` 检查候选路径和密钥内容，`npm run check:secrets -- --history` 检查所有可达历史。检查输出只提供脱敏线索。

本机 hook 可能被绕过，公开仓库还应启用推送保护，并将 `Source quality / checks` 设为 main 的必需合并检查。仓库包含对应工作流；远端设置需仓库管理员核对。本机的未推送提交、曲库、凭据、工作区文档和工具另做私有备份。

## 时值与附点的一条硬规矩

**音符的附点在界面上一律只支持一个**：

- 识别端读到两个及以上附点时，按一个取值并记一条 `dots-downgraded` 留档（不改写原始归档、不丢音符）；
- 延时横线并入后若得到单附点表示不了的时值（如 18+24=42，即双附点四分音符），取**不超过它的最大可显示值**并记一条 `duration-approximated`；
- 显示、排版、播放、手机清单与小节满/欠拍判定都必须读同一个口径 `annotationDots()`（`src/lib/musicStructure.js`），**不要**再单独读布尔 `dotted`：两处口径分叉就会出现「看着满拍、统计却说多拍」。

## 音区（高低音点）的口径

标注界面支持 **中音 / 高音（一个点）/ 双高音（两个点）/ 低音 / 双低音** 五档，即 `note.octave ∈ {0, ±1, ±2}`：

- 升/降八度按钮与 `R`/`F` 快捷键逐级增减，到 ±2 停下；「修改本行音符」的文本通道接受 `1''`（高两个八度）与 `..1`（低两个八度），最多两个标记；
- 识别早已接受 −2..2（`src/recognitionContract.js`）；显示（桌面 `src/EngravedRow.jsx`、手机 `ScoreRow.kt` 都按 `Math.min(2, |octave|)` 画点）、播放（音高 `octave × 12`，取样取最接近的采样）与手机清单都按 `octave` 直读；
- 只有超过 ±2 才在结构诊断里告警（`PITCH_OCTAVE_OUT_OF_RANGE`），标注界面不提供该范围。

## 目录约定

| 目录 | 说明 |
|---|---|
| `src/` `server/` `python/` | 前端、本地服务、随包 Python 切片 |
| `tools/` | 开发模式、打包、夹具生成、发布前检查 |
| `tests/` | 单元与验收测试 |
| `android/` | 手机端（只接收与播放，不做编辑） |
| `local/` | **不进仓库**：个人曲谱夹具、只在本机跑的 UI 回归测试 |
| `data/` `releases/` `runtime/` `qa/` | **不进仓库**：运行数据、成品、运行环境、测试产物 |
