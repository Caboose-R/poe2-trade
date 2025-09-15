#!/usr/bin/env python3
"""
Improved border detection that focuses on finding complete rectangular purple borders.
This approach looks for purple pixels that form complete rectangular outlines around items.
"""

import cv2
import numpy as np
import mss
import logging
import sys

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def detect_rectangular_purple_borders(image):
    """
    Detect complete rectangular purple borders around items.
    This approach looks for purple pixels that form complete rectangular outlines.
    """
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    
    # Focus on the specific purple color of borders
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
        return []
    
    # Instead of complex morphological operations, let's find contours directly
    # and then analyze them for border-like properties
    contours, _ = cv2.findContours(combined_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    logger.info(f"Found {len(contours)} contours")
    
    detected_items = []
    
    for i, contour in enumerate(contours):
        area = cv2.contourArea(contour)
        
        # Skip very small contours (noise)
        if area < 100:  # Increased minimum area
            logger.info(f"Contour {i}: area={area:.1f} - too small, skipping")
            continue
        
        # Get bounding rectangle
        x, y, w, h = cv2.boundingRect(contour)
        aspect_ratio = w / h
        
        # Calculate how rectangular the contour is
        rect_area = w * h
        contour_rect_ratio = area / rect_area if rect_area > 0 else 0
        
        logger.info(f"Contour {i}: area={area:.1f}, size=({w}x{h}), aspect={aspect_ratio:.2f}, rect_ratio={contour_rect_ratio:.2f}")
        
        # Check if this looks like a border vs a filled item
        # Borders should have relatively low area compared to their bounding box
        if contour_rect_ratio > 0.3:  # Much more strict - skip anything that's more than 30% filled
            logger.info(f"  -> Skipped (appears to be a filled item: rect_ratio={contour_rect_ratio:.2f})")
            continue
        
        # Check if it's a reasonable size for an item border
        # Item borders in PoE2 are typically 1-3 pixels thick
        min_dimension = min(w, h)
        if min_dimension < 20:  # Too small for a reasonable item
            logger.info(f"  -> Skipped (too small: {min_dimension}px)")
            continue
        
        if min_dimension > 200:  # Too large for a single item
            logger.info(f"  -> Skipped (too large: {min_dimension}px)")
            continue
        
        # Check aspect ratio - items can be various shapes
        if not (0.2 <= aspect_ratio <= 5.0):  # Very lenient aspect ratio
            logger.info(f"  -> Skipped (aspect ratio {aspect_ratio:.2f} not suitable)")
            continue
        
        # Additional check: analyze perimeter vs area to detect border-like structures
        perimeter = cv2.arcLength(contour, True)
        if perimeter > 0:
            area_perimeter_ratio = area / perimeter
            # Borders should have relatively low area-to-perimeter ratio (thin structures)
            if area_perimeter_ratio > 4.0:  # Skip thick/filled areas
                logger.info(f"  -> Skipped (too thick for a border: area/perim={area_perimeter_ratio:.2f})")
                continue
            logger.info(f"  -> Area/perimeter ratio: {area_perimeter_ratio:.2f}")
        else:
            area_perimeter_ratio = 0
        
        # Should be reasonably rectangular
        if contour_rect_ratio < 0.05:  # Very lenient for borders
            logger.info(f"  -> Skipped (not rectangular enough: {contour_rect_ratio:.2f})")
            continue
        
        # Calculate confidence heavily favoring border-like structures
        size_score = min(1.0, area / 1000.0)  # Prefer larger areas
        
        # Border score: lower area_perimeter_ratio is better for borders
        border_score = max(0.0, 1.0 - (area_perimeter_ratio / 4.0))  # Higher score for thinner structures
        
        # Shape score: prefer rectangular but not too filled
        shape_score = min(contour_rect_ratio * 3.0, 1.0)  # Favor lower rect_ratio (more border-like)
        
        aspect_score = 1.0 - abs(aspect_ratio - 1.0) / 3.0  # Prefer square-ish but not too strict
        
        # Weight heavily toward border characteristics
        confidence = (size_score * 0.2 + border_score * 0.5 + shape_score * 0.2 + aspect_score * 0.1)
        
        logger.info(f"  -> Confidence: {confidence:.3f} (size={size_score:.3f}, border={border_score:.3f}, shape={shape_score:.3f}, aspect={aspect_score:.3f})")
        
        # Accept items with reasonable confidence
        if confidence >= 0.3:
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
    
    return detected_items, combined_mask

def main():
    """Test the rectangular border detection."""
    # Use your merchant window coordinates
    x, y, width, height = 834, 284, 875, 867
    
    logger.info(f"Testing rectangular border detection with coordinates: x={x}, y={y}, width={width}, height={height}")
    
    # Capture screenshot
    with mss.mss() as sct:
        monitor = {"top": y, "left": x, "width": width, "height": height}
        screenshot = sct.grab(monitor)
        image = np.array(screenshot)
        image = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)
    
    logger.info(f"Screenshot captured: {image.shape}")
    
    # Detect rectangular purple borders
    logger.info("Starting rectangular purple border detection...")
    detected_items, mask = detect_rectangular_purple_borders(image)
    
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
    cv2.imwrite("debug_original_v2.png", image)
    cv2.imwrite("debug_mask_v2.png", mask)
    
    # Create overlay image
    overlay = image.copy()
    for item in detected_items:
        cv2.rectangle(overlay, (item['x'], item['y']), 
                     (item['x'] + item['width'], item['y'] + item['height']), 
                     (0, 255, 0), 2)  # Green rectangle
        cv2.putText(overlay, f"Conf: {item['confidence']:.2f}", 
                   (item['x'], item['y'] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)
    
    cv2.imwrite("debug_overlay_v2.png", overlay)
    logger.info("Debug images saved: debug_original_v2.png, debug_mask_v2.png, debug_overlay_v2.png")

if __name__ == "__main__":
    main()
