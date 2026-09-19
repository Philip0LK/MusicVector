"""Shared layout constraints for crop fitting and verification.

Numeral/text bands are protected content; observed staff regions are exclusions.
Safety checks and boundary fitting deliberately use the same component ownership.
No filenames, song identities or reviewed coordinates enter this module.
"""
import numpy as np


def content_components(stats, glyph_height, page_width, staff_regions):
    """Relevant print components; exclude attached accompaniment and faint noise."""
    h = glyph_height
    result = []
    for x, y, w, hh, area in stats:
        if not (h * .35 <= hh <= h * 2.5 and h * .15 <= w <= page_width * .3 and area >= h * 2):
            continue
        if area / (w * hh) < .2:
            continue
        if any(y < bottom and y + hh > top for top, bottom in staff_regions):
            continue
        result.append((float(y), float(y + hh)))
    return result


def crossing_components(boundary, components, glyph_height):
    margin = glyph_height * .15
    return [(top, bottom) for top, bottom in components if top + margin < boundary < bottom - margin]


def safe_boundary(initial, low, high, components, glyph_height, edge):
    """Choose nearest safe separator, within one bounded search (not chained nudges)."""
    if low > high:
        return initial, 'conflicting-layout-constraints'
    h = glyph_height
    start, end = max(low, initial - h * 1.5), min(high, initial + h * 1.5)
    if start > end:
        # Staff contamination can require trimming a large empty/foreign margin.
        # This never moves past the protected melody band.
        initial = min(high, max(low, initial))
        start, end = max(low, initial - h * 1.5), min(high, initial + h * 1.5)
    candidates = [min(high, max(low, initial)), start, end]
    for a, b in components:
        candidates.extend([a - h * .1, b + h * .1])
    valid = [v for v in candidates if start <= v <= end and not crossing_components(v, components, h)]
    if not valid:
        return min(high, max(low, initial)), 'no-safe-separator'
    # Retain the existing framing if safe; ties favour complete attached print.
    outward = [v for v in valid if (v <= initial if edge == 'top' else v >= initial)]
    chosen = min(outward or valid, key=lambda v: (abs(v - initial), v if edge == 'top' else -v))
    return chosen, None


def fit_boundaries(rows, fitted, stats, page_width, page_height, staff_regions, exclusions):
    """Solve every row within protected content and neighbouring structure bounds."""
    diagnostics = []
    for i, (row, box) in enumerate(zip(rows, fitted)):
        h = row['evidence']['height']
        bands = row['digitBands'] + row['lyricsBands'] + row.get('notationBands',[])
        protected_top = min(a for a, b in bands) * page_height
        protected_bottom = max(b for a, b in bands) * page_height
        components = content_components(stats, h, page_width, exclusions)
        previous = fitted[i - 1]['bottom'] if i else 0
        floor = max([previous, 0] + [b for a, b in staff_regions if b <= protected_top])
        next_top = fitted[i + 1]['top'] if i + 1 < len(fitted) else page_height
        if i + 1 < len(rows):
            following = rows[i + 1]
            next_bands = following['digitBands'] + following['lyricsBands'] + following.get('notationBands', [])
            # A following note/dot is a hard ownership boundary even when its
            # initial display frame was pushed down by preceding contextual ink.
            next_top = min(next_top, min(a for a, b in next_bands) * page_height)
        ceiling = min([next_top, page_height] + [a for a, b in staff_regions if a >= protected_bottom])
        before = [box['top'], box['bottom']]
        for edge, low, high in [('top', floor, protected_top), ('bottom', protected_bottom, ceiling)]:
            initial = box[edge]
            # A clipped first-page credit/header is foreign context, not a reason
            # to expand the melody crop up into the title.
            cuts = crossing_components(initial, components, h)
            if edge == 'top' and i == 0 and cuts and max(b for a, b in cuts) < protected_top - h * .5:
                initial = max(b for a, b in cuts) + h * .1
            box[edge], issue = safe_boundary(initial, low, high, components, h, edge)
            if issue:
                diagnostics.append({'row': i, 'edge': edge, 'reason': issue})
        if before != [box['top'], box['bottom']]:
            row['warnings'].append('layout-boundary-repaired')
    return diagnostics
