const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.APP_URL || "http://127.0.0.1:5174";
const title = `__分页识别验证_${Date.now()}`;
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
      const encoder = new TextEncoder();
      const harness = {
        active: 0,
        maxActive: 0,
        requests: [],
        responses: [],
      };
      window.__recognitionHarness = harness;

      window.fetch = (input, init = {}) => {
        if (String(input) !== "/api/recognize-stream") {
          return nativeFetch(input, init);
        }

        const body = JSON.parse(String(init.body || "{}"));
        const text = harness.responses.shift();
        harness.active += 1;
        harness.maxActive = Math.max(harness.maxActive, harness.active);
        harness.requests.push({
          imageCount: Array.isArray(body.images) ? body.images.length : 0,
        });

        return new Promise((resolve, reject) => {
          let settled = false;
          const finish = () => {
            if (settled) return false;
            settled = true;
            harness.active -= 1;
            return true;
          };

          init.signal?.addEventListener(
            "abort",
            () => {
              if (!finish()) return;
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );

          setTimeout(() => {
            if (!finish()) return;
            if (!text) {
              resolve(new Response("没有配置模拟识别结果", { status: 500 }));
              return;
            }

            const recognition = {
              songTitle: "分页验证歌曲",
              key: "1=C4",
              warnings: [],
              pages: [
                {
                  page: 1,
                  rows: text.split("\n").map((rowText) => ({
                    text: rowText,
                    notes: [],
                  })),
                },
              ],
            };
            const rawModelText = JSON.stringify(recognition);
            const frames = [
              `event: status\ndata: ${JSON.stringify({ message: "正在读取简谱" })}\n\n`,
              `event: delta\ndata: ${JSON.stringify({ text: rawModelText })}\n\n`,
              `event: result\ndata: ${JSON.stringify({ recognition, rawModelText })}\n\n`,
              "event: end\ndata: {}\n\n",
            ].join("");
            const stream = new ReadableStream({
              start(controller) {
                controller.enqueue(encoder.encode(frames));
                controller.close();
              },
            });
            resolve(
              new Response(stream, {
                status: 200,
                headers: { "content-type": "text/event-stream" },
              }),
            );
          }, 30);
        });
      };
    });

    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.locator("#api-key").fill("仅用于本地自动验证");
    await page.locator("#images").setInputFiles({
      name: "第一页.png",
      mimeType: "image/png",
      buffer: png,
    });
    await assertText(page, "#page-count", "共 1 页，本次识别 1 页");
    await queueResponses(page, ["1 1\n5 5"]);
    await recognizeAndWait(page);
    assert.equal(await page.locator("#notation").inputValue(), "1 1\n5 5");

    await page.locator("#images").setInputFiles({
      name: "第二页.png",
      mimeType: "image/png",
      buffer: png,
    });
    await assertText(page, "#page-count", "共 2 页，本次识别 2 页");
    await page.locator('[data-select-page="0"]').uncheck();
    await assertText(page, "#page-count", "共 2 页，本次识别 1 页");
    await queueResponses(page, ["2 2\n6 6"]);
    await recognizeAndWait(page);
    assert.equal(
      await page.locator("#notation").inputValue(),
      "1 1\n5 5\n\n2 2\n6 6",
    );

    await page.locator("#images").setInputFiles({
      name: "第三页.png",
      mimeType: "image/png",
      buffer: png,
    });
    await assertText(page, "#page-count", "共 3 页，本次识别 2 页");
    await page.locator('[data-select-page="1"]').uncheck();
    await queueResponses(page, ["3 3\n4 4"]);
    await recognizeAndWait(page);
    assert.equal(
      await page.locator("#notation").inputValue(),
      "1 1\n5 5\n\n2 2\n6 6\n\n3 3\n4 4",
    );

    await page.locator('[data-select-page="1"]').check();
    await page.locator('[data-select-page="2"]').uncheck();
    await queueResponses(page, ["6 6\n7 7"]);
    await recognizeAndWait(page);
    assert.equal(
      await page.locator("#notation").inputValue(),
      "1 1\n5 5\n\n6 6\n7 7\n\n3 3\n4 4",
    );

    assert.equal(await page.locator(".note-row").count(), 6);
    assert.deepEqual(
      await page.locator(".note-row-label").allTextContents(),
      ["1", "2", "1", "2", "1", "2"],
    );
    assert.equal(
      await page.locator('.note-row[data-page="1"][data-source-line="0"] .note-row-label').evaluate(
        (label) => getComputedStyle(label).userSelect,
      ),
      "none",
    );
    assert.deepEqual(
      await page.locator(".note-page-heading").allTextContents(),
      ["第 1 页", "第 2 页", "第 3 页"],
    );
    const gutterCoverage = await page.evaluate(() => {
      const strip = document.querySelector("#note-strip");
      strip.scrollLeft = 60;
      const label = document.querySelector(
        '.note-row[data-page="1"][data-source-line="0"] .note-row-label',
      );
      const stripRect = strip.getBoundingClientRect();
      const labelRect = label.getBoundingClientRect();
      const topElement = document.elementFromPoint(
        labelRect.right - 2,
        labelRect.top + labelRect.height / 2,
      );
      return {
        gutterAtLeft: Math.abs(labelRect.left - (stripRect.left + 1)) < 2,
        labelOnTop: topElement === label || label.contains(topElement),
      };
    });
    assert.equal(gutterCoverage.gutterAtLeft, true);
    assert.equal(gutterCoverage.labelOnTop, true);

    const requestStats = await page.evaluate(() => ({
      count: window.__recognitionHarness.requests.length,
      imageCounts: window.__recognitionHarness.requests.map(
        (request) => request.imageCount,
      ),
      maxActive: window.__recognitionHarness.maxActive,
    }));
    assert.equal(requestStats.count, 4);
    assert.deepEqual(requestStats.imageCounts, [1, 1, 1, 1]);
    assert.equal(requestStats.maxActive, 1);

    await page.locator("#reset").click();
    await assertText(page, "#progress", "1 / 12");
    await page.locator("#next-note").click();
    await assertText(page, "#progress", "1 / 12");
    await page.locator("#next-note").click();
    await assertText(page, "#progress", "2 / 12");

    await page.locator("#reset").click();
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      "notation",
    );
    await page.keyboard.press("ArrowRight");
    await assertText(page, "#progress", "1 / 12");
    await page.keyboard.press("ArrowRight");
    await assertText(page, "#progress", "2 / 12");
    await page.keyboard.press("ArrowLeft");
    await assertText(page, "#progress", "1 / 12");

    await page.locator('.note-chip[data-index="3"]').click();
    await assertText(page, "#progress", "4 / 12");
    await page.locator("#next-note").click();
    await assertText(page, "#progress", "4 / 12");
    await page.locator("#next-note").click();
    await assertText(page, "#progress", "5 / 12");

    await page.locator("#song-title").fill(title);
    await page.locator("#save-song").click();
    await page.locator("#status").filter({ hasText: title }).waitFor();
    await page.reload({ waitUntil: "networkidle" });

    const savedItem = page.locator(".saved-item", { hasText: title });
    assert.equal(await savedItem.count(), 1);
    await savedItem.locator("[data-load]").click();
    await page.locator("#status").filter({ hasText: "3 张原图" }).waitFor();
    await assertText(page, "#page-count", "共 3 页，本次识别 3 页");
    assert.equal(await page.locator("[data-select-page]:checked").count(), 3);
    assert.equal(await page.locator(".preview-card img").count(), 3);
    assert.equal(
      await page.locator("#notation").inputValue(),
      "1 1\n5 5\n\n6 6\n7 7\n\n3 3\n4 4",
    );

    const longRows = Array.from({ length: 10 }, () => "1 2 3 4 5 6 7");
    longRows.push(Array.from({ length: 60 }, () => "7").join(" "));
    await page.locator("#notation").fill(
      `${longRows.join("\n")}\n\n${longRows.join("\n")}`,
    );
    const longNoteCount = await page.locator(".note-chip").count();
    await page.locator(`.note-chip[data-index="${longNoteCount - 1}"]`).click();
    const notationJump = await page.locator("#notation").evaluate((textarea) => ({
      selection: textarea.value.slice(textarea.selectionStart, textarea.selectionEnd),
      scrollTop: textarea.scrollTop,
      scrollLeft: textarea.scrollLeft,
      maxScrollTop: textarea.scrollHeight - textarea.clientHeight,
      maxScrollLeft: textarea.scrollWidth - textarea.clientWidth,
    }));
    assert.equal(notationJump.selection, "7");
    assert.ok(notationJump.scrollTop > 0);
    assert.ok(notationJump.scrollLeft > 0);
    assert.ok(notationJump.maxScrollTop > 0);
    assert.ok(notationJump.maxScrollLeft > 0);

    console.log(
      JSON.stringify(
        {
          requests: requestStats,
          replacement: "第一页保留，第二页局部替换，第三页保留",
          noteRows: 6,
          gutterCoverage,
          notationJump,
          keyboardNavigation: "简谱文本框聚焦时，左右方向键仍可控制上一个和下一个",
          playback: "首次下一音停留，第二次推进",
          persistence: "3 张图片全部恢复且默认全选",
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
          .filter((song) => song.title === title)
          .map((song) =>
            fetch(`${baseUrl}/api/songs/${encodeURIComponent(song.id)}`, {
              method: "DELETE",
            }),
          ),
      );
    } catch {}
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function queueResponses(page, responses) {
  await page.evaluate((items) => {
    window.__recognitionHarness.responses.push(...items);
  }, responses);
}

async function recognizeAndWait(page) {
  await page.locator("#recognize").click();
  await page.locator("#status").filter({ hasText: "识别完成" }).waitFor();
  await assertText(page, "#recognize", "开始识别");
}

async function assertText(page, selector, expected) {
  const locator = page.locator(selector);
  await locator.filter({ hasText: expected }).waitFor();
  assert.equal((await locator.textContent()).trim(), expected);
}
