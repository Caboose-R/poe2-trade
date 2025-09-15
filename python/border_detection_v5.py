#!/usr/bin/env python3
"""
Border Detection V5 - Square/Rectangular Border Detection
Focuses specifically on detecting square/rectangular purple borders using shape analysis
"""

import cv2
import numpy as np
import pyautogui
import time
from pathlib import Path
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class RectangleBorderDetector:
    def __init__(self):
        # HSV ranges for purple detection (from reference app)
        self.purple_lower = np.array([125, 50, 50])
        self.purple_upper = np.array([155, 255, 255])
        
        # Detection parameters
        self.min_area = 300  # Lower minimum area
        self.max_area = 100000
        self.confidence_threshold = 0.4  # Lower confidence threshold
        
        # Rectangle detection parameters optimized for PoE2 item borders
        self.epsilon_factor = 0.02  # For approxPolyDP (more lenient)
        self.min_vertices = 4       # Exactly 4 vertices for rectangles
        self.max_vertices = 4       # Exactly 4 vertices for rectangles
        
        # PoE2 specific aspect ratios (with tolerance for detection noise)
        self.poe2_aspect_ratios = [
            0.25,   # Tall skinny rectangle
            0.5,    # Taller rectangle  
            0.667,  # Tall rectangle
            1.0,    # Square
            2.0     # Wide rectangle
        ]
        self.aspect_ratio_tolerance = 0.15  # 15% tolerance around target ratios
        
        # Merchant window coordinates (from our UI config)
        self.merchant_x = 834
        self.merchant_y = 284
        self.merchant_width = 875
        self.merchant_height = 867
        
        # Debug mode
        self.debug_mode = True
        
    def capture_merchant_region(self):
        """Capture the merchant window region"""
        try:
            # Capture the merchant window region
            screenshot = pyautogui.screenshot(region=(
                self.merchant_x, 
                self.merchant_y, 
                self.merchant_width, 
                self.merchant_height
            ))
            
            # Convert PIL to OpenCV format
            image = cv2.cvtColor(np.array(screenshot), cv2.COLOR_RGB2BGR)
            
            if self.debug_mode:
                logger.info(f"Screenshot captured: {image.shape}")
                
            return image
            
        except Exception as e:
            logger.error(f"Error capturing screenshot: {e}")
            return None
    
    def preprocess_image(self, image):
        """Convert to HSV and create purple mask"""
        # Convert to HSV for better color detection
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        
        # Create purple mask
        purple_mask = cv2.inRange(hsv, self.purple_lower, self.purple_upper)
        
        if self.debug_mode:
            logger.info(f"Purple mask created: {purple_mask.shape}")
            # Save mask for debugging
            cv2.imwrite("debug_v5_purple_mask.png", purple_mask)
            
        return purple_mask
    
    def clean_mask(self, mask):
        """Apply morphological operations to clean up the mask"""
        # Small kernel for gentle cleaning
        kernel = np.ones((2, 2), np.uint8)
        
        # Close small gaps in the mask
        cleaned_mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        
        if self.debug_mode:
            cv2.imwrite("debug_v5_cleaned_mask.png", cleaned_mask)
            
        return cleaned_mask
    
    def check_poe2_aspect_ratio(self, aspect_ratio):
        """Check if aspect ratio matches any PoE2 item border ratio"""
        for target_ratio in self.poe2_aspect_ratios:
            min_ratio = target_ratio * (1 - self.aspect_ratio_tolerance)
            max_ratio = target_ratio * (1 + self.aspect_ratio_tolerance)
            
            if min_ratio <= aspect_ratio <= max_ratio:
                # Return descriptive name for the matched ratio
                ratio_names = {
                    0.25: "Tall Skinny Rectangle",
                    0.5: "Taller Rectangle", 
                    0.667: "Tall Rectangle",
                    1.0: "Square",
                    2.0: "Wide Rectangle"
                }
                return ratio_names.get(target_ratio, f"Ratio {target_ratio}")
        
        return None
    
    def detect_rectangle_contours(self, mask):
        """Detect contours and filter for rectangular shapes (squares, tall rectangles, wide rectangles)"""
        # Find contours
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        if self.debug_mode:
            logger.info(f"Found {len(contours)} raw contours")
        
        rectangle_contours = []
        
        for i, contour in enumerate(contours):
            area = cv2.contourArea(contour)
            
            # Filter by area
            if area < self.min_area or area > self.max_area:
                if self.debug_mode:
                    logger.debug(f"Contour {i}: Area {area:.0f} outside range [{self.min_area}, {self.max_area}]")
                continue
            
            if self.debug_mode:
                logger.info(f"Contour {i}: Area {area:.0f} - PASSED area filter")
            
            # Approximate the contour to a polygon
            epsilon = self.epsilon_factor * cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, epsilon, True)
            
            # Check if it's exactly 4 vertices (rectangular)
            num_vertices = len(approx)
            if num_vertices != 4:
                if self.debug_mode:
                    logger.debug(f"Contour {i}: {num_vertices} vertices (need exactly 4 for rectangles)")
                continue
            
            if self.debug_mode:
                logger.info(f"Contour {i}: Exactly 4 vertices - PASSED rectangular filter")
            
            # Get bounding rectangle
            x, y, w, h = cv2.boundingRect(contour)
            
            # Calculate aspect ratio and check if it matches PoE2 item border ratios
            aspect_ratio = w / h
            matched_ratio = self.check_poe2_aspect_ratio(aspect_ratio)
            
            if not matched_ratio:
                if self.debug_mode:
                    logger.debug(f"Contour {i}: Aspect ratio {aspect_ratio:.3f} doesn't match PoE2 item ratios")
                continue
            
            if self.debug_mode:
                logger.info(f"Contour {i}: Aspect ratio {aspect_ratio:.3f} - MATCHES PoE2 {matched_ratio}")
            
            # Additional rectangle verification
            if self.is_rectangle_like(approx, contour):
                rectangle_contours.append({
                    'contour': contour,
                    'approx': approx,
                    'area': area,
                    'bbox': (x, y, w, h),
                    'aspect_ratio': aspect_ratio,
                    'vertices': num_vertices
                })
                
                if self.debug_mode:
                    logger.info(f"✅ Contour {i}: Rectangle-like! Area={area:.0f}, AR={aspect_ratio:.2f}, Vertices={num_vertices}")
            else:
                if self.debug_mode:
                    logger.info(f"❌ Contour {i}: FAILED rectangle-like verification")
        
        return rectangle_contours
    
    def is_rectangle_like(self, approx, contour):
        """Additional verification that the contour is rectangular-like (squares, tall rectangles, wide rectangles)"""
        try:
            # More lenient approach - just check basic rectangular properties
            if len(approx) >= 3:  # At least triangle
                
                # Calculate contour area vs bounding rectangle area
                contour_area = cv2.contourArea(contour)
                x, y, w, h = cv2.boundingRect(contour)
                rect_area = w * h
                
                if rect_area > 0:
                    area_ratio = contour_area / rect_area
                    
                    # For rectangular shapes, this ratio should be reasonable
                    # (not too low - meaning very irregular shape)
                    if area_ratio < 0.3:  # Too irregular
                        if self.debug_mode:
                            logger.debug(f"Area ratio {area_ratio:.2f} too low (irregular shape)")
                        return False
                
                # If we have 4+ vertices, do some basic angle checking
                if len(approx) >= 4:
                    # Check a few key angles (don't need to be perfect 90°)
                    angles = []
                    for i in range(min(4, len(approx))):  # Check first 4 angles
                        p1 = approx[i][0]
                        p2 = approx[(i + 1) % len(approx)][0]
                        p3 = approx[(i + 2) % len(approx)][0]
                        
                        # Calculate angle at p2
                        v1 = p1 - p2
                        v2 = p3 - p2
                        
                        if np.linalg.norm(v1) > 0 and np.linalg.norm(v2) > 0:
                            cos_angle = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2))
                            cos_angle = np.clip(cos_angle, -1.0, 1.0)
                            angle = np.arccos(cos_angle) * 180 / np.pi
                            angles.append(angle)
                    
                    if len(angles) > 0:
                        # Check if angles are reasonable (not too acute or obtuse)
                        extreme_angles = [a for a in angles if a < 45 or a > 135]
                        if len(extreme_angles) > len(angles) * 0.5:  # More than half are extreme
                            if self.debug_mode:
                                logger.debug(f"Too many extreme angles: {extreme_angles}")
                            return False
            
            return True
            
        except Exception as e:
            if self.debug_mode:
                logger.debug(f"Error in rectangular verification: {e}")
            return False
    
    def calculate_confidence(self, contour_data):
        """Calculate confidence score for a detected PoE2 rectangle border"""
        aspect_ratio = contour_data['aspect_ratio']
        vertices = contour_data['vertices']
        
        # PoE2 aspect ratio confidence (bonus for exact matches)
        matched_ratio = self.check_poe2_aspect_ratio(aspect_ratio)
        if matched_ratio:
            # Give high confidence for PoE2 ratio matches
            aspect_confidence = 0.9 + (0.1 * (1 - self.aspect_ratio_tolerance))  # 0.9-1.0
        else:
            # Lower confidence for non-PoE2 ratios
            aspect_confidence = 0.3
        
        # Vertex count confidence (exactly 4 vertices = perfect score)
        vertex_confidence = 1.0 if vertices == 4 else 0.0
        
        # Combined confidence (focus on aspect ratio and vertices only)
        confidence = (aspect_confidence * 0.7 + vertex_confidence * 0.3)
        
        return min(1.0, max(0.0, confidence))
    
    def detect_purple_borders(self):
        """Main detection function"""
        logger.info("🔍 Starting V5 PoE2 rectangle border detection...")
        
        # Capture image
        image = self.capture_merchant_region()
        if image is None:
            return []
        
        # Preprocess
        purple_mask = self.preprocess_image(image)
        cleaned_mask = self.clean_mask(purple_mask)
        
        # Detect rectangle contours
        rectangle_contours = self.detect_rectangle_contours(cleaned_mask)
        
        if not rectangle_contours:
            logger.info("❌ No rectangle-like purple borders found")
            return []
        
        # Calculate confidence and filter
        detected_items = []
        for contour_data in rectangle_contours:
            confidence = self.calculate_confidence(contour_data)
            
            if confidence >= self.confidence_threshold:
                x, y, w, h = contour_data['bbox']
                
                # Convert to absolute coordinates
                abs_x = self.merchant_x + x
                abs_y = self.merchant_y + y
                center_x = abs_x + w // 2
                center_y = abs_y + h // 2
                
                item = {
                    'x': center_x,
                    'y': center_y,
                    'width': w,
                    'height': h,
                    'area': contour_data['area'],
                    'confidence': confidence,
                    'aspect_ratio': contour_data['aspect_ratio'],
                    'vertices': contour_data['vertices'],
                    'region': (abs_x, abs_y, w, h)
                }
                
                detected_items.append(item)
                
                logger.info(f"✅ Detected rectangle border: ({center_x}, {center_y}) - Confidence: {confidence:.2f}")
                logger.info(f"   Size: {w}x{h}, Area: {contour_data['area']:.0f}, Vertices: {contour_data['vertices']}")
        
        # Sort by confidence
        detected_items.sort(key=lambda x: x['confidence'], reverse=True)
        
        logger.info(f"🎯 V5 PoE2 Detection complete: {len(detected_items)} valid PoE2 rectangle borders found")
        
        return detected_items
    
    def create_debug_visualization(self, detected_items):
        """Create a debug visualization showing detected rectangles"""
        image = self.capture_merchant_region()
        if image is None:
            return
        
        # Draw detected rectangles
        for i, item in enumerate(detected_items):
            x, y, w, h = item['region']
            confidence = item['confidence']
            
            # Draw rectangle
            color = (0, 255, 0) if confidence > 0.8 else (0, 255, 255)
            cv2.rectangle(image, (x - self.merchant_x, y - self.merchant_y), 
                         (x + w - self.merchant_x, y + h - self.merchant_y), color, 2)
            
            # Add label
            label = f"#{i+1}: {confidence:.2f}"
            cv2.putText(image, label, (x - self.merchant_x, y - self.merchant_y - 10), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
            
            # Add center point
            center_x = x - self.merchant_x + w // 2
            center_y = y - self.merchant_y + h // 2
            cv2.circle(image, (center_x, center_y), 3, (255, 0, 0), -1)
        
        # Save debug image
        cv2.imwrite("debug_v5_detected_rectangles.png", image)
        logger.info("🔍 Debug visualization saved: debug_v5_detected_rectangles.png")

def main():
    """Test the V5 rectangle border detection"""
    detector = RectangleBorderDetector()
    
    logger.info("🧪 Testing V5 PoE2 Rectangle Border Detection")
    logger.info("=" * 50)
    
    # Detect purple borders
    detected_items = detector.detect_purple_borders()
    
    if detected_items:
        logger.info(f"✅ SUCCESS: Found {len(detected_items)} PoE2 rectangle purple borders!")
        
        for i, item in enumerate(detected_items):
            logger.info(f"   Item {i+1}:")
            logger.info(f"      Position: ({item['x']}, {item['y']})")
            logger.info(f"      Size: {item['width']}x{item['height']}")
            logger.info(f"      Area: {item['area']:.0f} pixels")
            logger.info(f"      Confidence: {item['confidence']:.3f}")
            logger.info(f"      Aspect Ratio: {item['aspect_ratio']:.2f}")
            logger.info(f"      Vertices: {item['vertices']}")
        
        # Create debug visualization
        detector.create_debug_visualization(detected_items)
        
    else:
        logger.info("❌ No PoE2 rectangle purple borders detected")
    
    logger.info("=" * 50)
    logger.info("V5 detection test complete")

if __name__ == "__main__":
    main()
