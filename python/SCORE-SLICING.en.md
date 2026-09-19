English | [中文](SCORE-SLICING.md)

# Whole-row jianpu + lyrics slicing experiment

## Running

Run from the project root (Python; requires numpy, opencv-python, Pillow):

```powershell
python scripts/score_slicer.py img_data --check-stability
python scripts/build_slice_review.py
```

Look at `output/lyric-slices/index.html`. Each image's `result.json` holds the coordinates, the geometric evidence and the warnings; `row-N.png` is a pixel crop of the original image. There is no AI, OCR or model call, and no coordinates are written by song name. Neither the training Demo nor the manually proofread data was rewritten.

## Method and references

1. EXIF orientation normalization; detection images are brought to a uniform width of 1400, and the original image is kept for the final crop.
2. Dark-core binarization, to reduce interference from light-colored watermarks.
3. Morphological extraction of long horizontal and vertical lines, to identify accompaniment staff regions.
4. The size, aspect ratio, density, baseline and spacing of connected components jointly propose jianpu row candidates; bar lines and the accompaniment's relative position are combined to filter out chord diagrams and header digits.
5. A continuous text band is found below the melody, supporting two lines of lyrics; going upward, the nearby repeat-house horizontal brackets are retained.
6. The detection coordinates are mapped onto the orientation-normalized original image and output as V2 `image-normalized` coordinates.

References:
- OpenCV's official morphological staff-line extraction example: https://docs.opencv.org/3.0.0/d1/dee/tutorial_moprh_lines_detection.html
- The original MUSER paper, on morphology, connected components and structural inference: https://haralick.org/journals/muser.pdf
- The projection segmentation method in a jianpu recognition paper: https://www.mdpi.com/2075-1702/13/12/1121

These materials provide the basic methods; they do not show that any particular accuracy is achievable on this project's material, with its watermarks and mixed accompaniment. The implementation in this document also does not use a fixed number of measures per row or evenly divided slices.

## Current evaluation

Detection on the 8 original source images gives 66 rows in total: BabySong 5 on each of its two pages; K歌之王 15; Shall We Talk 15; 富士山下 9 and 8 on its two pages; 爱是怀疑 4 and 5 on its two pages. The row counts on the original material agree with a manual inspection, but this is not pixel-boundary accuracy or accuracy on an independent test set.

Perturbation tests:
- Downscaled to 75%: BabySong page 2 goes from 5 rows to 4, and K歌之王 goes from 15 rows to 16.
- Brightness raised by 10%: Shall We Talk goes from 15 rows to 16, and 富士山下 page 1 goes from 9 rows to 11.
- In the remaining perturbation tests the row count is unchanged; an unchanged row count still does not prove that the boundaries are free of deviation.

`--check-stability` records row-count disagreement as `unstable-row-detection`. Rows with no lyrics are recorded as `no-lyrics-detected`, and may simply be instrumental rows. All outputs are `reviewed: false` and `reviewRequired: true`, and no existing correct slice is overwritten. The geometric thresholds still show sensitivity to the source image and the font; this is an experimental version and should not go live without review.

## Coordinate contract and limitations

- Rectangle basis: the original image after EXIF orientation normalization; the origin is top-left and x/y/width/height range from 0 to 1. The reader must use the same orientation and the original image dimensions.
- Horizontally, the full page width is currently retained, so that short rows and the symbols at the left and right ends are not cut off; watermarks and side decorations in the slice are not erased.
- The line-removal mask used for analysis does not modify the exported original image.
- Skew/perspective correction, multi-column layouts and semantic judgment of lyrics across rows are not provided at present. Dark watermarks and overlapping strokes cannot be reliably recovered by this algorithm alone.
- The next round gives priority to replacing the single hard threshold for candidate rows with multi-threshold consensus and whole-page sequence scoring, and to adding a labeled benchmark of independent material; it needs to assess full-note symbol coverage, lyric completeness rate and accompaniment-mixing rate at the same time, rather than only comparing row counts.

## 2026-09-15: V3 generality regression

The current service has been upgraded to `image-only-row-v3-consensus`; the records for the 8 images above come from an earlier experiment. The new version uses deduplication by character height, clustering of degenerate character heights, cross-validation of adjacent thresholds and grouping by shared bar lines, while keeping the original content-boundary fitting. All 93 user-reviewed boxes (including auto boxes that were not adjusted) serve as ground truth.


## V4 local staff-line re-detection (2026-09-15)

`image-only-row-v4-local-staff` fixes missed detection of skewed or short six-line staves, local detection wrongly deleting the leading melody, and missed short final rows; it excludes connected guitar rhythm beams. It follows the protection and digit-layer rules already reviewed in V3.
