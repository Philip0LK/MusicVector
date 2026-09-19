"""Identical raster sampling for crop fitting and independent verification."""
import cv2
import numpy as np

def analysis_gray(image, width=1400):
    gray = cv2.cvtColor(np.asarray(image.convert('RGB')), cv2.COLOR_RGB2GRAY)
    scale = width / image.width
    # Passing rounded dimensions instead changes OpenCV sampling vertically.
    # Both fitting and validation must inspect the exact same print pixels.
    return cv2.resize(gray, None, fx=scale, fy=scale)
