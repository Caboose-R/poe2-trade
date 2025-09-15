#!/usr/bin/env python3
"""
Border Detection V3 - Based on reference app architecture
Combines our current design with proven detection logic from the reference implementation.
"""

import cv2
import numpy as np
import mss
import logging
import sys

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class BorderDetectorV3:
    def __init__(self):
        # HSV ranges from reference app - balanced for purple detection
        self.purple_lower = np.array([125, 50, 50])
        self.purple_upper = np.array([155, 255, 255])
        
        # Detection parameters from reference app
        self.min_area = 600
        self.max_area = 100000
        self.confidence_threshold = 0.6
        
        # Merchant window coordinates (our current setup)
        self.merchant_window = {
            "x": 834,
            "y": 284, 
            "width": 875,  # 1709 - 834
            "height": 867  # 1151 - 284
        }
    
    def detect_purple_borders(self, image):
        """
        Detect purple borders using reference app's proven approach.
        This method combines color detection with morphological operations
        and contour analysis based on the working reference implementation.
        """
        # Convert to HSV for better color detection
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        
        # Create mask for purple colors (from reference app)
        purple_mask = cv2.inRange(hsv, self.purple_lower, self.purple_upper)
        
        logger.info(f"Purple mask pixels: {np.sum(purple_mask > 0)}")
        
        # Apply gentle morphological operations (from reference app)
        kernel = np.ones((2,2), np.uint8)
        purple_mask = cv2.morphologyEx(purple_mask, cv2.MORPH_CLOSE, kernel)
        
        # Find contours
        contours, _ = cv2.findContours(purple_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        logger.info(f"Found {len(contours)} raw contours")
        
        detected_items = []
        
        for i, contour in enumerate(contours):
            area = cv2.contourArea(contour)
            
            # Area filtering (from reference app)
            if not (self.min_area <= area <= self.max_area):
                logger.info(f"Contour {i}: area={area:.1f} - outside range [{self.min_area}, {self.max_area}]")
                continue
            
            # Get bounding rectangle
            x, y, w, h = cv2.boundingRect(contour)
            aspect_ratio = w / h
            
            logger.info(f"Contour {i}: area={area:.1f}, size=({w}x{h}), aspect={aspect_ratio:.2f}")
            
            # Aspect ratio check (from reference app)
            if not (0.4 <= aspect_ratio <= 2.5):
                logger.info(f"  -> Skipped (aspect ratio {aspect_ratio:.2f} not in range [0.4, 2.5])")
                continue
            
            # Calculate contour properties (from reference app)
            perimeter = cv2.arcLength(contour, True)
            circularity = 4 * np.pi * area / (perimeter * perimeter) if perimeter > 0 else 0
            
            logger.info(f"  -> Perimeter: {perimeter:.1f}, Circularity: {circularity:.3f}")
            
            # Circularity check (from reference app)
            if circularity <= 0.05:
                logger.info(f"  -> Skipped (circularity {circularity:.3f} too low)")
                continue
            
            # Calculate confidence (from reference app)
            area_confidence = min(area / 1500, 1.0)
            shape_confidence = 1.0 - abs(aspect_ratio - 1.0) * 0.3
            circularity_confidence = min(circularity * 1.5, 1.0)
            
            confidence = (area_confidence * 0.5 + shape_confidence * 0.3 + circularity_confidence * 0.2)
            
            logger.info(f"  -> Confidence: {confidence:.3f} (area={area_confidence:.3f}, shape={shape_confidence:.3f}, circularity={circularity_confidence:.3f})")
            
            # Confidence threshold check (from reference app)
            if confidence >= self.confidence_threshold:
                detected_item = {
                    'x': x,
                    'y': y,
                    'width': w,
                    'height': h,
                    'area': area,
                    'confidence': confidence,
                    'aspect_ratio': aspect_ratio,
                    'circularity': circularity,
                    'center_x': x + w // 2,
                    'center_y': y + h // 2
                }
                detected_items.append(detected_item)
                logger.info(f"  -> DETECTED: {detected_item}")
            else:
                logger.info(f"  -> Skipped (confidence {confidence:.3f} below threshold {self.confidence_threshold})")
        
        # Sort by confidence (from reference app)
        detected_items.sort(key=lambda x: x['confidence'], reverse=True)
        
        # Remove overlapping items (from reference app)
        filtered_items = []
        for item in detected_items:
            is_overlapping = False
            for existing in filtered_items:
                distance = ((item['center_x'] - existing['center_x'])**2 + 
                           (item['center_y'] - existing['center_y'])**2)**0.5
                min_separation = max(item['width'], item['height'], 
                                   existing['width'], existing['height']) * 0.8
                
                if distance < min_separation:
                    is_overlapping = True
                    logger.info(f"  -> Filtered overlapping item at ({item['center_x']}, {item['center_y']})")
                    break
            
            if not is_overlapping:
                filtered_items.append(item)
        
        logger.info(f"Final filtered items: {len(filtered_items)}")
        return filtered_items, purple_mask
    
    def capture_merchant_window(self):
        """Capture the merchant window using our current coordinates"""
        try:
            with mss.mss() as sct:
                monitor = {
                    "top": self.merchant_window["y"],
                    "left": self.merchant_window["x"], 
                    "width": self.merchant_window["width"],
                    "height": self.merchant_window["height"]
                }
                screenshot = sct.grab(monitor)
                image = np.array(screenshot)
                image = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)
                
                logger.info(f"Captured merchant window: {image.shape}")
                return image
        except Exception as e:
            logger.error(f"Failed to capture merchant window: {e}")
            return None
    
    def save_debug_images(self, original_image, mask, detected_items):
        """Save debug images with overlays"""
        # Save original
        cv2.imwrite("debug_original_v3.png", original_image)
        
        # Save mask
        cv2.imwrite("debug_mask_v3.png", mask)
        
        # Create overlay
        overlay = original_image.copy()
        for item in detected_items:
            # Draw rectangle around detected item
            color = (0, 255, 0) if item['confidence'] > 0.8 else (0, 255, 255)
            cv2.rectangle(overlay, (item['x'], item['y']), 
                         (item['x'] + item['width'], item['y'] + item['height']), color, 2)
            
            # Add confidence label
            label = f"{item['confidence']:.2f}"
            cv2.putText(overlay, label, (item['x'], item['y'] - 10), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
            
            # Add center point marker
            cv2.circle(overlay, (item['center_x'], item['center_y']), 5, (255, 0, 0), -1)
        
        cv2.imwrite("debug_overlay_v3.png", overlay)
        logger.info("Debug images saved: debug_original_v3.png, debug_mask_v3.png, debug_overlay_v3.png")

def main():
    """Test the V3 border detection"""
    detector = BorderDetectorV3()
    
    logger.info("Testing Border Detection V3 with reference app logic")
    logger.info(f"Merchant window: x={detector.merchant_window['x']}, y={detector.merchant_window['y']}, "
                f"width={detector.merchant_window['width']}, height={detector.merchant_window['height']}")
    
    # Capture merchant window
    image = detector.capture_merchant_window()
    if image is None:
        logger.error("Failed to capture merchant window")
        return
    
    # Detect purple borders
    logger.info("Starting purple border detection with reference app parameters...")
    detected_items, mask = detector.detect_purple_borders(image)
    
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
            logger.info(f"  Aspect Ratio: {item['aspect_ratio']:.2f}")
            logger.info(f"  Circularity: {item['circularity']:.3f}")
            logger.info(f"  Center: ({item['center_x']}, {item['center_y']})")
    else:
        logger.info("NO purple-bordered items found")
        logger.info("=" * 50)
    
    # Save debug images
    detector.save_debug_images(image, mask, detected_items)

if __name__ == "__main__":
    main()
