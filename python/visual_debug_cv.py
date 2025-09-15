#!/usr/bin/env python3
"""
Visual debug script for computer vision detection
Captures a screenshot and saves it for visual inspection
"""

import cv2
import numpy as np
import mss
import logging

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def capture_and_save_debug_images():
    """Capture screenshot and save debug images"""
    sct = mss.mss()
    
    # Default coordinates for 3440x1440 resolution
    x, y, width, height = 834, 284, 875, 867
    
    logger.info(f"Capturing screen region: x={x}, y={y}, width={width}, height={height}")
    
    try:
        monitor = {
            "top": y,
            "left": x,
            "width": width,
            "height": height
        }
        screenshot = sct.grab(monitor)
        img = np.array(screenshot)
        # Convert from BGRA to BGR
        img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
        
        # Save original image
        cv2.imwrite('debug_original.png', img)
        logger.info("Saved debug_original.png")
        
        # Convert to HSV and save HSV image
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        cv2.imwrite('debug_hsv.png', hsv)
        logger.info("Saved debug_hsv.png")
        
        # Create and save purple masks
        purple_ranges = [
            ([120, 50, 50], [140, 255, 255], "blue_purple"),
            ([140, 50, 50], [160, 255, 255], "purple"),
            ([160, 50, 50], [180, 255, 255], "red_purple"),
            ([110, 30, 30], [150, 255, 255], "wide_purple"),
            ([100, 20, 20], [180, 255, 255], "very_wide_purple")
        ]
        
        for lower, upper, name in purple_ranges:
            mask = cv2.inRange(hsv, np.array(lower), np.array(upper))
            pixel_count = cv2.countNonZero(mask)
            logger.info(f"{name}: {pixel_count} pixels")
            
            # Save mask
            cv2.imwrite(f'debug_mask_{name}.png', mask)
            
            # Create colored version of the mask for better visualization
            colored_mask = cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR)
            colored_mask[:,:,0] = 0  # Remove blue
            colored_mask[:,:,1] = 0  # Remove green
            # Keep red channel for purple visualization
            cv2.imwrite(f'debug_colored_{name}.png', colored_mask)
        
        # Combine all masks
        combined_mask = cv2.inRange(hsv, np.array([100, 20, 20]), np.array([180, 255, 255]))
        cv2.imwrite('debug_combined_mask.png', combined_mask)
        
        # Apply morphological operations
        kernel = np.ones((3, 3), np.uint8)
        cleaned_mask = cv2.morphologyEx(combined_mask, cv2.MORPH_CLOSE, kernel)
        cleaned_mask = cv2.morphologyEx(cleaned_mask, cv2.MORPH_OPEN, kernel)
        cleaned_mask = cv2.GaussianBlur(cleaned_mask, (3, 3), 0)
        cv2.imwrite('debug_cleaned_mask.png', cleaned_mask)
        
        # Find and draw contours
        contours, _ = cv2.findContours(cleaned_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        # Draw contours on original image
        contour_img = img.copy()
        cv2.drawContours(contour_img, contours, -1, (0, 255, 0), 2)
        
        # Draw bounding rectangles
        for contour in contours:
            area = cv2.contourArea(contour)
            if area > 100:  # Only draw significant contours
                x, y, w, h = cv2.boundingRect(contour)
                cv2.rectangle(contour_img, (x, y), (x + w, y + h), (255, 0, 0), 2)
                
                # Add text with area
                cv2.putText(contour_img, f"{int(area)}", (x, y - 10), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        
        cv2.imwrite('debug_contours.png', contour_img)
        logger.info(f"Found {len(contours)} contours, saved debug_contours.png")
        
        logger.info("Debug images saved! Check the PNG files to see what's being detected.")
        
    except Exception as e:
        logger.error(f"Error capturing debug images: {e}")

if __name__ == "__main__":
    capture_and_save_debug_images()
