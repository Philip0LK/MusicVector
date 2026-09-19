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

```bash
npm run build
node tools/package.mjs --refresh                     # releases/乐北斗（空库，供分发）
node tools/package.mjs --refresh --with-data <目录>   # releases/乐北斗－自用（带指定曲库）
```

打包要求 `runtime/` 与手机端 APK（`android/` 下构建产物）都在。正式发布前跑一次：

```bash
npm run check:publish
```

它会列出将公开的文件，并在发现个人内容（曲谱、曲库、截图）时直接失败。

## 目录约定

| 目录 | 说明 |
|---|---|
| `src/` `server/` `python/` | 前端、本地服务、随包 Python 切片 |
| `tools/` | 开发模式、打包、夹具生成、发布前检查 |
| `tests/` | 单元与验收测试 |
| `android/` | 手机端（只接收与播放，不做编辑） |
| `local/` | **不进仓库**：个人曲谱夹具、只在本机跑的 UI 回归测试 |
| `data/` `releases/` `runtime/` `qa/` | **不进仓库**：运行数据、成品、运行环境、测试产物 |
