#!/usr/bin/env python3
"""
Improved computer vision detection specifically tuned for Path of Exile 2 purple borders
Based on analysis of actual game inventory screenshots
"""

import cv2
import numpy as np
import mss
import json
import sys
import logging

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class ImprovedItemDetector:
    def __init__(self):
        self.sct = mss.mss()
        
    def capture_screen_region(self, x, y, width, height):
        """Capture a specific region of the screen"""
        try:
            monitor = {
                "top": y,
                "left": x,
                "width": width,
                "height": height
            }
            screenshot = self.sct.grab(monitor)
            img = np.array(screenshot)
            # Convert from BGRA to BGR
            img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
            return img
        except Exception as e:
            logger.error(f"Failed to capture screen: {e}")
            return None

    def detect_purple_borders_improved(self, image):
        """Improved purple border detection specifically for PoE2 inventory items"""
        try:
            logger.info("Starting improved purple border detection")
            
            # Convert to HSV for better color detection
            hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
            
            # Define multiple HSV ranges for purple detection
            # Based on typical purple borders in PoE2 inventory
            purple_ranges = [
                # Standard purple ranges
                ([120, 50, 50], [140, 255, 255], "blue_purple"),
                ([140, 50, 50], [160, 255, 255], "purple"),
                ([160, 50, 50], [180, 255, 255], "red_purple"),
                
                # More lenient ranges for different lighting/contrast
                ([110, 30, 30], [150, 255, 255], "wide_purple"),
                ([100, 20, 20], [180, 255, 255], "very_wide_purple"),
                
                # Bright purple ranges (for high contrast borders)
                ([120, 100, 100], [160, 255, 255], "bright_purple"),
                
                # Dark purple ranges (for darker borders)
                ([120, 20, 50], [160, 255, 150], "dark_purple")
            ]
            
            # Combine all purple masks
            combined_mask = np.zeros(hsv.shape[:2], dtype=np.uint8)
            total_pixels = 0
            
            for lower, upper, name in purple_ranges:
                mask = cv2.inRange(hsv, np.array(lower), np.array(upper))
                pixel_count = cv2.countNonZero(mask)
                total_pixels += pixel_count
                logger.info(f"{name}: {pixel_count} pixels")
                
                # Add to combined mask
                combined_mask = cv2.bitwise_or(combined_mask, mask)
            
            logger.info(f"Total purple pixels: {total_pixels}")
            
            if total_pixels == 0:
                logger.warning("No purple pixels detected!")
                return []
            
            # Apply morphological operations to clean up noise
            kernel_small = np.ones((2, 2), np.uint8)
            kernel_medium = np.ones((3, 3), np.uint8)
            
            # Close small gaps in the mask
            cleaned_mask = cv2.morphologyEx(combined_mask, cv2.MORPH_CLOSE, kernel_small)
            # Remove small noise
            cleaned_mask = cv2.morphologyEx(cleaned_mask, cv2.MORPH_OPEN, kernel_medium)
            
            # Apply slight blur to smooth edges
            cleaned_mask = cv2.GaussianBlur(cleaned_mask, (3, 3), 0)
            
            # Find contours
            contours, _ = cv2.findContours(cleaned_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            logger.info(f"Found {len(contours)} contours")
            
            detected_items = []
            
            for i, contour in enumerate(contours):
                area = cv2.contourArea(contour)
                
                # Skip very small contours (noise)
                if area < 50:
                    continue
                
                # Get bounding rectangle
                x, y, w, h = cv2.boundingRect(contour)
                
                # Calculate aspect ratio
                aspect_ratio = w / h
                
                # Calculate how rectangular the contour is
                rect_area = w * h
                contour_rect_ratio = area / rect_area if rect_area > 0 else 0
                
                logger.info(f"Contour {i}: area={area:.1f}, size=({w}x{h}), aspect={aspect_ratio:.2f}, rect_ratio={contour_rect_ratio:.2f}")
                
                # Filter for item-like shapes
                # Items in PoE2 inventory are typically roughly square/rectangular
                if not (0.3 <= aspect_ratio <= 3.0):  # Allow various aspect ratios
                    logger.info(f"  -> Skipped (aspect ratio {aspect_ratio:.2f} not suitable)")
                    continue
                
                if contour_rect_ratio < 0.4:  # Should be reasonably rectangular
                    logger.info(f"  -> Skipped (not rectangular enough: {contour_rect_ratio:.2f})")
                    continue
                
                # Calculate confidence based on multiple factors
                area_score = min(1.0, area / 1000.0)  # Prefer larger areas
                shape_score = contour_rect_ratio
                aspect_score = 1.0 - abs(aspect_ratio - 1.0) / 2.0  # Prefer square-ish
                
                confidence = (area_score * 0.3 + shape_score * 0.4 + aspect_score * 0.3)
                
                logger.info(f"  -> Confidence: {confidence:.3f} (area={area_score:.3f}, shape={shape_score:.3f}, aspect={aspect_score:.3f})")
                
                # Accept items with reasonable confidence
                if confidence >= 0.3:  # Lower threshold for testing
                    item = {
                        'x': int(x),
                        'y': int(y),
                        'width': int(w),
                        'height': int(h),
                        'area': int(area),
                        'confidence': confidence,
                        'aspect_ratio': aspect_ratio,
                        'shape_score': contour_rect_ratio,
                        'center_x': int(x + w // 2),
                        'center_y': int(y + h // 2)
                    }
                    detected_items.append(item)
                    logger.info(f"  -> DETECTED: {item}")
                else:
                    logger.info(f"  -> Rejected (confidence too low: {confidence:.3f})")
            
            # Sort by confidence
            detected_items.sort(key=lambda x: x['confidence'], reverse=True)
            
            logger.info(f"Final result: {len(detected_items)} items detected")
            return detected_items
            
        except Exception as e:
            logger.error(f"Error in improved purple border detection: {e}")
            return []

def main():
    """Test the improved detection"""
    detector = ImprovedItemDetector()
    
    # Default coordinates for 3440x1440 resolution
    x, y, width, height = 834, 284, 875, 867
    
    logger.info(f"Testing improved detection with coordinates: x={x}, y={y}, width={width}, height={height}")
    
    # Capture screenshot
    image = detector.capture_screen_region(x, y, width, height)
    if image is None:
        logger.error("Failed to capture screenshot")
        return
    
    logger.info(f"Screenshot captured: {image.shape}")
    
    # Run improved detection
    items = detector.detect_purple_borders_improved(image)
    
    if items:
        logger.info(f"\n{'='*50}")
        logger.info(f"SUCCESS: Found {len(items)} purple-bordered items!")
        logger.info(f"{'='*50}")
        
        for i, item in enumerate(items):
            logger.info(f"Item {i+1}:")
            logger.info(f"  Position: ({item['x']}, {item['y']})")
            logger.info(f"  Size: {item['width']}x{item['height']}")
            logger.info(f"  Area: {item['area']} pixels")
            logger.info(f"  Confidence: {item['confidence']:.3f}")
            logger.info(f"  Center: ({item['center_x']}, {item['center_y']})")
    else:
        logger.info("\nNo items detected. Try adjusting the detection parameters.")

if __name__ == "__main__":
    main()
