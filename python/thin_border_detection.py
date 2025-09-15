#!/usr/bin/env python3
"""
Focused detection for thin purple borders around target items in PoE2.
This script specifically targets the thin purple border that appears around
items you've traveled to a hideout to purchase.
"""

import cv2
import numpy as np
import mss
import logging
import sys

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def detect_thin_purple_borders(image, debug=True):
    """
    Detect thin purple borders around target items.
    Focus on the specific purple color and thickness of item borders.
    """
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    
    # Focus on the specific purple color of thin item borders
    # These are typically bright, saturated purples that form thin outlines
    purple_ranges = [
        # Primary range - bright purple borders
        ([130, 120, 120], [150, 255, 255]),
        # Secondary range - slightly different purple shades
        ([125, 100, 100], [155, 255, 255]),
        # Backup range - darker purple borders
        ([135, 80, 80], [145, 255, 255])
    ]
    
    combined_mask = np.zeros(hsv.shape[:2], dtype=np.uint8)
    total_purple_pixels = 0
    
    for i, (lower, upper) in enumerate(purple_ranges):
        lower = np.array(lower)
        upper = np.array(upper)
        mask = cv2.inRange(hsv, lower, upper)
        
        purple_pixel_count = np.sum(mask > 0)
        logger.info(f"Purple range {i+1}: {purple_pixel_count} pixels")
        total_purple_pixels += purple_pixel_count
        
        combined_mask = cv2.bitwise_or(combined_mask, mask)
    
    logger.info(f"Total purple pixels: {total_purple_pixels}")
    
    if total_purple_pixels == 0:
        logger.warning("No purple pixels detected!")
        return [], combined_mask
    
    # Additional step: try to isolate border-like structures
    # Apply edge detection to find border-like patterns
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    
    # Combine purple mask with edge information
    # This helps identify purple pixels that are actually on edges/borders
    border_candidates = cv2.bitwise_and(combined_mask, edges)
    border_pixel_count = np.sum(border_candidates > 0)
    logger.info(f"Purple pixels on edges: {border_pixel_count}")
    
    # Use border candidates if we have enough, otherwise fall back to full mask
    if border_pixel_count > 50:
        logger.info("Using edge-enhanced mask for border detection")
        working_mask = border_candidates
    else:
        logger.info("Using full purple mask (not enough edge pixels)")
        working_mask = combined_mask
    
    # Very conservative morphological operations to preserve thin borders
    # Only do minimal cleanup to avoid losing the actual border pixels
    kernel_small = np.ones((2, 2), np.uint8)
    
    # Just close tiny gaps, don't be aggressive
    cleaned_mask = cv2.morphologyEx(working_mask, cv2.MORPH_CLOSE, kernel_small)
    
    # Remove only very small noise (single pixels)
    kernel_tiny = np.ones((2, 2), np.uint8)
    cleaned_mask = cv2.morphologyEx(cleaned_mask, cv2.MORPH_OPEN, kernel_tiny)
    
    # Count pixels after cleaning
    cleaned_pixel_count = np.sum(cleaned_mask > 0)
    logger.info(f"Purple pixels after cleaning: {cleaned_pixel_count}")
    
    # Find contours
    contours, _ = cv2.findContours(cleaned_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    logger.info(f"Found {len(contours)} contours after cleaning")
    
    # If no contours found after cleaning, try with the raw working mask
    if len(contours) == 0:
        logger.info("No contours found after cleaning, trying with raw working mask...")
        contours, _ = cv2.findContours(working_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        logger.info(f"Found {len(contours)} contours in raw working mask")
    
    detected_items = []
    
    for i, contour in enumerate(contours):
        area = cv2.contourArea(contour)
        
        # Skip very small contours (noise)
        if area < 30:
            logger.info(f"Contour {i}: area={area:.1f} - too small, skipping")
            continue
        
        # Get bounding rectangle
        x, y, w, h = cv2.boundingRect(contour)
        aspect_ratio = w / h
        
        # Calculate how rectangular the contour is
        rect_area = w * h
        contour_rect_ratio = area / rect_area if rect_area > 0 else 0
        
        # Check if this looks like a border (thin outline) vs a filled item
        # Borders should have low area-to-perimeter ratio
        perimeter = cv2.arcLength(contour, True)
        if perimeter > 0:
            area_perimeter_ratio = area / perimeter
        else:
            area_perimeter_ratio = 0
        
        logger.info(f"Contour {i}: area={area:.1f}, size=({w}x{h}), aspect={aspect_ratio:.2f}, rect_ratio={contour_rect_ratio:.2f}, area/perim={area_perimeter_ratio:.2f}")
        
        # Filter for border-like structures (thin outlines)
        # Borders should have relatively low area compared to their bounding box
        if contour_rect_ratio > 0.6:  # Skip filled areas (high rect_ratio = mostly filled)
            logger.info(f"  -> Skipped (appears to be a filled item, not a border: rect_ratio={contour_rect_ratio:.2f})")
            continue
        
        # Borders should have reasonable area-to-perimeter ratio (not too thick)
        if area_perimeter_ratio > 3.0:  # Skip thick areas (more strict)
            logger.info(f"  -> Skipped (too thick for a border: area/perim={area_perimeter_ratio:.2f})")
            continue
        
        # Additional check: borders should be relatively small compared to their bounding box
        # A true border should not fill most of its bounding rectangle
        if area > (rect_area * 0.7):  # Skip if area is more than 70% of bounding box
            logger.info(f"  -> Skipped (area too large for a border: {area:.0f} vs {rect_area:.0f})")
            continue
        
        # Filter for item-like shapes
        # Items in PoE2 inventory are typically roughly square/rectangular
        if not (0.3 <= aspect_ratio <= 3.0):  # Allow various aspect ratios
            logger.info(f"  -> Skipped (aspect ratio {aspect_ratio:.2f} not suitable)")
            continue
        
        if contour_rect_ratio < 0.1:  # Should be reasonably rectangular (more lenient for borders)
            logger.info(f"  -> Skipped (not rectangular enough: {contour_rect_ratio:.2f})")
            continue
        
        # Calculate confidence based on border characteristics
        area_score = min(1.0, area / 500.0)  # Prefer reasonable sized areas
        
        # Border score: lower area_perimeter_ratio is better for borders
        border_score = max(0.0, 1.0 - (area_perimeter_ratio / 5.0))  # Score decreases as ratio increases
        
        # Shape score: prefer rectangular borders but not too filled
        shape_score = min(contour_rect_ratio * 2.0, 1.0)  # Cap at 1.0, favor lower ratios
        
        aspect_score = 1.0 - abs(aspect_ratio - 1.0) / 2.0  # Prefer square-ish
        
        confidence = (area_score * 0.2 + border_score * 0.4 + shape_score * 0.2 + aspect_score * 0.2)
        
        logger.info(f"  -> Confidence: {confidence:.3f} (area={area_score:.3f}, border={border_score:.3f}, shape={shape_score:.3f}, aspect={aspect_score:.3f})")
        
        # Accept items with reasonable confidence
        if confidence >= 0.3:  # Lower threshold for testing
            detected_item = {
                'x': x,
                'y': y,
                'width': w,
                'height': h,
                'area': area,
                'confidence': confidence,
                'aspect_ratio': aspect_ratio,
                'shape_score': shape_score,
                'center_x': x + w // 2,
                'center_y': y + h // 2
            }
            detected_items.append(detected_item)
            logger.info(f"  -> DETECTED: {detected_item}")
        else:
            logger.info(f"  -> Skipped (confidence {confidence:.3f} too low)")
    
    return detected_items, cleaned_mask

def main():
    """Test the thin border detection."""
    # Use your merchant window coordinates
    x, y, width, height = 834, 284, 875, 867
    
    logger.info(f"Testing thin border detection with coordinates: x={x}, y={y}, width={width}, height={height}")
    
    # Capture screenshot
    with mss.mss() as sct:
        monitor = {"top": y, "left": x, "width": width, "height": height}
        screenshot = sct.grab(monitor)
        image = np.array(screenshot)
        image = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)
    
    logger.info(f"Screenshot captured: {image.shape}")
    
    # Detect thin purple borders
    logger.info("Starting thin purple border detection...")
    detected_items, mask = detect_thin_purple_borders(image, debug=True)
    
    # Results
    logger.info("")
    logger.info("=" * 50)
    if detected_items:
        logger.info(f"SUCCESS: Found {len(detected_items)} purple-bordered items!")
        logger.info("=" * 50)
        for i, item in enumerate(detected_items, 1):
            logger.info(f"Item {i}:")
            logger.info(f"  Position: ({item['x']}, {item['y']})")
            logger.info(f"  Size: {item['width']}x{item['height']}")
            logger.info(f"  Area: {item['area']:.0f} pixels")
            logger.info(f"  Confidence: {item['confidence']:.3f}")
            logger.info(f"  Center: ({item['center_x']}, {item['center_y']})")
    else:
        logger.info("NO purple-bordered items found")
        logger.info("=" * 50)
    
    # Save debug images
    cv2.imwrite("debug_original.png", image)
    cv2.imwrite("debug_mask.png", mask)
    
    # Create overlay image
    overlay = image.copy()
    for item in detected_items:
        cv2.rectangle(overlay, (item['x'], item['y']), 
                     (item['x'] + item['width'], item['y'] + item['height']), 
                     (0, 255, 0), 2)  # Green rectangle
        cv2.putText(overlay, f"Conf: {item['confidence']:.2f}", 
                   (item['x'], item['y'] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)
    
    cv2.imwrite("debug_overlay.png", overlay)
    logger.info("Debug images saved: debug_original.png, debug_mask.png, debug_overlay.png")

if __name__ == "__main__":
    main()
