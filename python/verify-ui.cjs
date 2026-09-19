const assert = require("node:assert/strict");
const { mkdir } = require("node:fs/promises");
const { join } = require("node:path");
const { chromium } = require("playwright");

const baseUrl = process.env.APP_URL || "http://127.0.0.1:5174";
const title = `__界面验证_${Date.now()}`;
const newTitle = `${title}_新歌`;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

(async () => {
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE || undefined,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

try {
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      if (String(input) === "/api/recognize-stream") {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      }
      return nativeFetch(input, init);
    };
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const originalSong = await page.evaluate(async ({ title }) => {
    const response = await fetch("/api/songs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        key: "1=C4",
        dynamic: "medium",
        notation: "1 5 5 4",
        images: [],
      }),
    });
    return (await response.json()).song;
  }, { title });
  await page.reload({ waitUntil: "networkidle" });

  let savedItem = page.locator(".saved-item", { hasText: title });
  assert.equal(await savedItem.count(), 1);
  await savedItem.locator("[data-load]").click();
  await page.locator("#status").filter({ hasText: "无原图" }).waitFor();
  await assertText(page, "#page-count", "共 0 页，本次识别 0 页");

  await page.locator("#images").setInputFiles([
    { name: "第一页.png", mimeType: "image/png", buffer: png },
    { name: "第二页.png", mimeType: "image/png", buffer: png },
  ]);
  await assertText(page, "#page-count", "共 2 页，本次识别 2 页");

  await page.locator("#api-key").fill("仅用于界面验证");
  await page.locator("#recognize").click();
  await assertText(page, "#recognize", "停止识别");
  await page.locator("#recognize").click();
  await assertText(page, "#recognize", "开始识别");
  await assertText(page, "#status", "识别已停止。");

  await page.locator("#song-title").fill(title);
  await page.locator("#song-key").fill("1=C4");
  await page.locator("#piano-dynamic").selectOption("strong");
  await page.locator("#notation").fill("1 5 5 4");
  await page.locator("#save-song").click();
  await page.locator("#status").filter({ hasText: title }).waitFor();

  savedItem = page.locator(".saved-item", { hasText: title });
  assert.equal(await savedItem.count(), 1);

  await page.reload({ waitUntil: "networkidle" });
  savedItem = page.locator(".saved-item", { hasText: title });
  assert.equal(await savedItem.count(), 1);
  assert.equal(await savedItem.locator("[data-load]").getAttribute("data-load"), originalSong.id);

  await savedItem.locator("[data-load]").click();
  await page.locator("#status").filter({ hasText: "2 张原图" }).waitFor();
  assert.equal(await page.locator("#piano-dynamic").inputValue(), "strong");
  await assertText(page, "#page-count", "共 2 页，本次识别 2 页");
  await page.waitForFunction(() =>
    Boolean(
      document
        .querySelector(".layout")
        .style.getPropertyValue("--workspace-panel-height"),
    ),
  );

  const panelLayout = await page.evaluate(() => ({
    bodyOverflow: getComputedStyle(document.body).overflowY,
    workspacePanelHeight: Number.parseFloat(
      document
        .querySelector(".layout")
        .style.getPropertyValue("--workspace-panel-height"),
    ),
    firstCardHeight: document
      .querySelector(".preview-card")
      .getBoundingClientRect().height,
    noteStripHeight: document
      .querySelector("#note-strip")
      .getBoundingClientRect().height,
    panels: [".controls", ".preview-panel", ".result-panel"].map((selector) => {
      const panel = document.querySelector(selector);
      const rect = panel.getBoundingClientRect();
      return {
        selector,
        top: rect.top,
        bottom: rect.bottom,
        clientHeight: panel.clientHeight,
        scrollHeight: panel.scrollHeight,
        overflowY: getComputedStyle(panel).overflowY,
      };
    }),
  }));
  assert.equal(panelLayout.bodyOverflow, "auto");
  assert.equal(new Set(panelLayout.panels.map((panel) => panel.top)).size, 1);
  assert.equal(new Set(panelLayout.panels.map((panel) => panel.bottom)).size, 1);
  assert.ok(panelLayout.panels.every((panel) => panel.overflowY === "auto"));
  assert.ok(panelLayout.panels[1].scrollHeight > panelLayout.panels[1].clientHeight);
  assert.ok(panelLayout.workspacePanelHeight >= panelLayout.firstCardHeight * 1.5);
  assert.ok(panelLayout.workspacePanelHeight < panelLayout.firstCardHeight * 1.5 + 180);
  assert.ok(panelLayout.noteStripHeight >= 419);

  const firstFrameBeforeZoom = await page
    .locator('[data-image-frame="0"]')
    .evaluate((frame) => ({
      height: frame.getBoundingClientRect().height,
      clientWidth: frame.clientWidth,
      clientHeight: frame.clientHeight,
    }));
  await page.locator('[data-zoom-in="0"]').click();
  await page.locator('[data-zoom-in="0"]').click();
  await assertText(page, '[data-zoom-reset="0"]', "150%");
  await assertText(page, '[data-zoom-reset="1"]', "100%");
  const firstFrameZoomed = await page
    .locator('[data-image-frame="0"]')
    .evaluate((frame) => ({
      height: frame.getBoundingClientRect().height,
      clientWidth: frame.clientWidth,
      clientHeight: frame.clientHeight,
      scrollWidth: frame.scrollWidth,
      scrollHeight: frame.scrollHeight,
      scrollLeft: frame.scrollLeft,
      scrollTop: frame.scrollTop,
      zoomed: frame.classList.contains("zoomed"),
    }));
  assert.ok(Math.abs(firstFrameZoomed.height - firstFrameBeforeZoom.height) < 1);
  assert.ok(firstFrameZoomed.scrollWidth > firstFrameZoomed.clientWidth);
  assert.ok(firstFrameZoomed.scrollHeight > firstFrameZoomed.clientHeight);
  assert.ok(firstFrameZoomed.scrollLeft > 0);
  assert.ok(firstFrameZoomed.scrollTop > 0);
  assert.equal(firstFrameZoomed.zoomed, true);
  await page.locator('[data-zoom-reset="0"]').click();
  await assertText(page, '[data-zoom-reset="0"]', "100%");

  const audioCheck = await page.evaluate(async () => {
    const { pianoSampleForMidi } = await import("/src/piano.js");
    const context = new AudioContext();
    const notes = [];
    for (const midi of [60, 62, 64, 65, 67, 69, 71]) {
      const sample = pianoSampleForMidi(midi, "medium");
      const response = await fetch(sample.url);
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      notes.push({
        midi,
        url: sample.url,
        status: response.status,
        type: response.headers.get("content-type"),
        duration: buffer.duration,
      });
    }
    await context.close();
    return notes;
  });
  assert.equal(audioCheck.length, 7);
  assert.ok(audioCheck.every((note) => note.status === 200));
  assert.ok(audioCheck.every((note) => note.type === "audio/ogg"));
  assert.ok(audioCheck.every((note) => note.duration > 0));

  const alignment = await page.evaluate(() =>
    ["song-key", "duration", "piano-dynamic"].map((id) => {
      const rect = document.getElementById(id).getBoundingClientRect();
      return { id, top: rect.top, bottom: rect.bottom };
    }),
  );
  assert.equal(new Set(alignment.map((item) => item.top)).size, 1);
  assert.equal(new Set(alignment.map((item) => item.bottom)).size, 1);

  await mkdir(join(process.cwd(), "artifacts"), { recursive: true });
  await page.screenshot({
    path: join(process.cwd(), "artifacts", "ui-verification.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    bodyOverflow: getComputedStyle(document.body).overflowY,
    panelOverflow: getComputedStyle(document.querySelector(".preview-panel")).overflowY,
    columns: getComputedStyle(document.querySelector(".inline-controls"))
      .gridTemplateColumns,
  }));
  assert.equal(mobileLayout.content, mobileLayout.viewport);
  assert.equal(mobileLayout.bodyOverflow, "auto");
  assert.equal(mobileLayout.panelOverflow, "visible");
  await page.screenshot({
    path: join(process.cwd(), "artifacts", "ui-verification-mobile.png"),
    fullPage: true,
  });

  await page.locator("#new-song").click();
  await assertText(page, "#status", "已新建歌曲，请上传图片后开始识别。");
  await assertText(page, "#page-count", "共 0 页，本次识别 0 页");
  assert.equal(await page.locator("#song-title").inputValue(), "");
  assert.equal(await page.locator("#song-key").inputValue(), "1=C4");
  assert.equal(await page.locator("#piano-dynamic").inputValue(), "medium");
  assert.equal(await page.locator("#notation").inputValue(), "");
  assert.equal(await page.locator(".preview-card").count(), 0);

  const oldSavedItem = page.locator(".saved-item", {
    has: page.locator(`[data-load="${originalSong.id}"]`),
  });
  assert.equal(await oldSavedItem.count(), 1);
  await page.locator("#song-title").fill(newTitle);
  await page.locator("#notation").fill("1 2 3");
  await page.locator("#save-song").click();
  await page.locator("#status").filter({ hasText: newTitle }).waitFor();
  const newSavedItem = page.locator(".saved-item", { hasText: newTitle });
  assert.equal(await newSavedItem.count(), 1);
  assert.notEqual(
    await newSavedItem.locator("[data-load]").getAttribute("data-load"),
    originalSong.id,
  );
  assert.equal(await oldSavedItem.count(), 1);

  await newSavedItem.locator("[data-delete]").click();
  await page.locator("#status").filter({ hasText: "歌曲已删除" }).waitFor();
  await oldSavedItem.locator("[data-delete]").click();
  await page.locator("#status").filter({ hasText: "歌曲已删除" }).waitFor();

  console.log(
    JSON.stringify(
      {
        pageCount: "共 2 页，本次识别 2 页",
        cancellation: "识别已停止。",
        restoredDynamic: "strong",
        panelLayout,
        imageZoom: {
          before: firstFrameBeforeZoom,
          zoomed: firstFrameZoomed,
        },
        audio: audioCheck,
        alignment,
        mobileLayout,
        newSong: "新歌使用独立歌曲 ID，旧歌未被覆盖",
        screenshot: "artifacts/ui-verification.png",
        mobileScreenshot: "artifacts/ui-verification-mobile.png",
      },
      null,
      2,
    ),
  );
} finally {
  try {
    const response = await fetch(`${baseUrl}/api/songs`);
    const { songs = [] } = await response.json();
    await Promise.all(
      songs
        .filter((song) => song.title === title || song.title === newTitle)
        .map((song) =>
          fetch(`${baseUrl}/api/songs/${encodeURIComponent(song.id)}`, {
            method: "DELETE",
          }),
        ),
    );
  } catch {}
  await browser.close();
}

async function assertText(page, selector, expected) {
  const locator = page.locator(selector);
  await locator.filter({ hasText: expected }).waitFor();
  assert.equal((await locator.textContent()).trim(), expected);
}
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
