English | [中文](SYMBOL-BASELINE.md)

# Symbol algorithm baseline: first round of experiments

Date: 2026-09-12. The current slicing algorithm is unchanged. No AI was called this time, and the product recognition pipeline was not modified.

## Reproducible

```powershell
python scripts/prepare-symbol-baseline.py
node scripts/evaluate-symbol-baseline.mjs
```

Labels and source-image hashes: `output/symbol-baseline/labels.json`.
Per-note errors and summary: `output/symbol-baseline/results.json`.
Reference image for the annotation: `output/lyric-slices/baseline-source.jpg`.

5 real slices, 78 notes, taken from 富士山下, K歌之王 and BabySong, including single and double duration-shortening lines, augmentation dots, low-octave dots, lyrics, prolongation dashes and a short final row. The labels were established by reading the images by hand before the algorithm was run; they were not revised backwards from the run results, and no parameters were tuned. The sample is a deliberately chosen exploratory sample — not random, not an independent large-scale benchmark, looked at by one person only — and still needs review.

## Subject under test and conditions

The original `src/octaveDetector.js` was run, with `analyzeRhythmSymbols` and `analyzeLowOctaves`. As in the browser adapter, the input is scaled to 1440 pixels wide. This test used the current row slices as input and was given a manual note-digit sequence; it is not a reproduction of the old full-page end-to-end pipeline.

The algorithm uses the note count and order to match geometry, so this is "accessory-symbol recognition given the correct note sequence", not independent note recognition. The measure-end ground truth is also recorded by note index. Nothing can be inferred from this about digit recognition, AI recognition or the product's real end-to-end accuracy.

## Results on the original slices

| Item | Result | Interpretation |
|---|---|---|
| Number of duration-shortening lines | 76/78, 97.4% | Exact classification of 0/1/2 lines per note |
| Augmentation dots | True positives 3, false positives 2, missed 0 | Precision 60%, recall 100%; very few positive examples |
| Measure end | True positives 7, false positives 0, missed 6 | Precision 100%, recall 53.8% |
| Low-octave dots | True positives 2, false positives 0, missed 0 | Only 2 positive examples, not enough to claim reliability |

Variant tests (not extra independent samples):
- Downscaled to 75% first and then taken through the input pipeline: duration-shortening lines 77/78; augmentation dots correctly found 1, falsely reported 1, missed 2.
- Brightness raised by 10%: duration-shortening lines 75/78; augmentation dots correctly found 3, falsely reported 1.
- Under both kinds of perturbation, only 7/13 measure ends were found; low-octave dots were still 2/2.

Concrete failures: the lyric "咒。" in a short final row was misused as note geometry, producing a false duration-shortening line and a false augmentation dot; one row of BabySong missed all 5 measure ends, and there was one false augmentation dot and one wrong duration-shortening line count. Localization/matching failures contaminate several attributes at once, so each attribute cannot simply be given a high confidence on its own.

## Recommendations for integration boundaries

- Keep the current cropping version; the first version does not automatically re-recognize anomalies, and only records validation errors for the correction interface.
- Do not insist on one request per row any more: the recognition data is still organized by row, and the calling layer tries independent image batches of 2–4 consecutive rows from the same page, with a suggested starting point of 3 rows. The 8 pieces of material total 66 rows, so 66 calls can drop to 24 (header recognition not included). This is a configuration starting point; AI quality and actual cost have not been verified.
- Record costs separately for the repeated prompt, image input, structured output and optional thinking tokens; putting several images in one request does not guarantee that image tokens fall by the same amount. Compare the 1/3/full-page strategies after real usage has been recorded.
- The algorithm currently only outputs candidates and evidence, and does not directly override the AI. Duration-shortening lines can be the first item tried in hybrid recognition; augmentation dots and bar lines cannot yet be handled by the algorithm alone; for low-octave dots, enlarge the positive sample first.
- Note digits, accidentals, high-octave dots, arcs, slur groups, repeat structures and lyrics have not yet produced measurement conclusions this time.
- The next round needs a three-way comparison of AI, algorithm and hybrid on the same set of manual ground truth. Do not treat unchecked recognition results in old data as ground truth.
