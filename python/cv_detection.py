#!/usr/bin/env python3
"""
Computer Vision Detection Script for PoE2 Trade
Detects purple-bordered items in merchant windows using OpenCV
"""

import cv2
import numpy as np
import json
import sys
import time
import threading
from typing import List, Dict, Tuple, Optional
import logging
import pyautogui

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class ItemDetector:
    def __init__(self):
        self.config = {
            'confidence_threshold': 0.4,  # Lowered for V5
            'detection_window': {'x': 0, 'y': 0, 'width': 800, 'height': 600},
            'detection_interval': 200,
            'detection_timeout': 15000,
            'min_area': 300,  # V5 optimized
            'max_area': 100000,
            'mouse_speed': 1.0,
            'click_modifiers': ['ctrl']
        }
        self.is_detecting = False
        self.detection_thread = None
        self.stop_detection = False
        
        # V5 Purple color range in HSV (from reference app)
        self.purple_lower = np.array([125, 50, 50])
        self.purple_upper = np.array([155, 255, 255])
        
        # V5 Rectangle detection parameters
        self.epsilon_factor = 0.02
        self.min_vertices = 4
        self.max_vertices = 4
        
        # PoE2 specific aspect ratios
        self.poe2_aspect_ratios = [0.25, 0.5, 0.667, 1.0, 2.0]
        self.aspect_ratio_tolerance = 0.15
        
        # Configure PyAutoGUI
        pyautogui.FAILSAFE = True
        pyautogui.PAUSE = 0.1
        
        logger.info("ItemDetector initialized with V5 algorithm")

    def update_config(self, new_config: Dict):
        """Update detection configuration"""
        self.config.update(new_config)
        logger.info(f"Configuration updated: {self.config}")
    
    def check_poe2_aspect_ratio(self, aspect_ratio: float) -> Optional[str]:
        """Check if aspect ratio matches any PoE2 item border ratio"""
        for target_ratio in self.poe2_aspect_ratios:
            min_ratio = target_ratio * (1 - self.aspect_ratio_tolerance)
            max_ratio = target_ratio * (1 + self.aspect_ratio_tolerance)
            
            if min_ratio <= aspect_ratio <= max_ratio:
                ratio_names = {
                    0.25: "Tall Skinny Rectangle",
                    0.5: "Taller Rectangle", 
                    0.667: "Tall Rectangle",
                    1.0: "Square",
                    2.0: "Wide Rectangle"
                }
                return ratio_names.get(target_ratio, f"Ratio {target_ratio}")
        
        return None
    
    def calculate_confidence(self, contour_data: Dict) -> float:
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
    
    def is_rectangle_like(self, approx: np.ndarray, contour: np.ndarray) -> bool:
        """Additional verification that the contour is rectangular-like"""
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
                    if area_ratio < 0.3:  # Too irregular
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
                            return False
            
            return True
            
        except Exception:
            return False

    def capture_screen_region(self, window_bounds: Dict) -> Optional[np.ndarray]:
        """Capture a specific region of the screen using pyautogui (same as V5 standalone)"""
        try:
            # Use pyautogui.screenshot() like the standalone V5 script
            screenshot = pyautogui.screenshot(region=(
                window_bounds['x'], 
                window_bounds['y'], 
                window_bounds['width'], 
                window_bounds['height']
            ))
            
            # Convert PIL to OpenCV format (same as V5 standalone)
            image = cv2.cvtColor(np.array(screenshot), cv2.COLOR_RGB2BGR)
            
            logger.info(f"Screenshot captured: {image.shape} at ({window_bounds['x']}, {window_bounds['y']}) {window_bounds['width']}x{window_bounds['height']}")
            
            return image
                
        except Exception as e:
            logger.error(f"Failed to capture screen: {e}")
            return None

    def detect_purple_borders(self, image: np.ndarray) -> List[Dict]:
        """Detect purple-bordered items using V5 PoE2-optimized algorithm"""
        try:
            # Log current configuration
            logger.info(f"V5 Detection config: confidence={self.config.get('confidence_threshold', 0.4)}, min_area={self.config.get('min_area', 300)}, max_area={self.config.get('max_area', 100000)}")
            # Convert to HSV for better color detection
            hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
            
            # V5 Purple color range (from reference app)
            purple_mask = cv2.inRange(hsv, self.purple_lower, self.purple_upper)
            
            # Apply gentle morphological operations
            kernel = np.ones((2, 2), np.uint8)
            purple_mask = cv2.morphologyEx(purple_mask, cv2.MORPH_CLOSE, kernel)
            
            # Find contours
            contours, _ = cv2.findContours(purple_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            logger.info(f"Found {len(contours)} raw contours")
            
            # Debug: count purple pixels
            purple_pixel_count = cv2.countNonZero(purple_mask)
            logger.info(f"Purple pixels detected: {purple_pixel_count}")
            
            rectangle_contours = []
            
            for i, contour in enumerate(contours):
                area = cv2.contourArea(contour)
                
                # Filter by area (use config values)
                min_area = self.config.get('min_area', 300)
                max_area = self.config.get('max_area', 100000)
                if area < min_area or area > max_area:
                    logger.info(f"Contour {i}: Area {area:.0f} outside range [{min_area}, {max_area}]")
                    continue
                
                # Approximate the contour to a polygon
                epsilon = self.epsilon_factor * cv2.arcLength(contour, True)
                approx = cv2.approxPolyDP(contour, epsilon, True)
                
                # Check if it's exactly 4 vertices (rectangular)
                num_vertices = len(approx)
                if num_vertices != 4:
                    logger.info(f"Contour {i}: {num_vertices} vertices (need exactly 4 for rectangles)")
                    continue
                
                # Get bounding rectangle
                x, y, w, h = cv2.boundingRect(contour)
                
                # Calculate aspect ratio and check if it matches PoE2 item border ratios
                aspect_ratio = w / h
                matched_ratio = self.check_poe2_aspect_ratio(aspect_ratio)
                
                if not matched_ratio:
                    logger.info(f"Contour {i}: Aspect ratio {aspect_ratio:.3f} doesn't match PoE2 item ratios")
                    continue
                
                # Additional rectangle verification
                if self.is_rectangle_like(approx, contour):
                    rectangle_contours.append({
                        'contour': contour,
                        'approx': approx,
                        'area': area,
                        'bbox': (x, y, w, h),
                        'aspect_ratio': aspect_ratio,
                        'vertices': num_vertices,
                        'matched_ratio': matched_ratio
                    })
                    
                    logger.info(f"✅ Contour {i}: Rectangle-like! Area={area:.0f}, AR={aspect_ratio:.3f}, Vertices={num_vertices}, Type={matched_ratio}")
                else:
                    logger.info(f"❌ Contour {i}: FAILED rectangle-like verification")
            
            # Calculate confidence and filter
            detected_items = []
            for contour_data in rectangle_contours:
                confidence = self.calculate_confidence(contour_data)
                
                confidence_threshold = self.config.get('confidence_threshold', 0.4)
                if confidence >= confidence_threshold:
                    x, y, w, h = contour_data['bbox']
                    
                    item = {
                        'x': int(x),
                        'y': int(y),
                        'width': int(w),
                        'height': int(h),
                        'area': int(contour_data['area']),
                        'confidence': confidence,
                        'aspect_ratio': contour_data['aspect_ratio'],
                        'vertices': contour_data['vertices'],
                        'item_type': contour_data['matched_ratio'],
                        'center_x': int(x + w // 2),
                        'center_y': int(y + h // 2)
                    }
                    
                    detected_items.append(item)
                    
                    logger.info(f"✅ Detected {contour_data['matched_ratio']}: ({x + w//2}, {y + h//2}) - Confidence: {confidence:.2f}")
            
            # Sort by confidence
            detected_items.sort(key=lambda x: x['confidence'], reverse=True)
            
            logger.info(f"🎯 V5 Detection complete: {len(detected_items)} PoE2 rectangle borders found")
            
            # Save debug images for troubleshooting
            try:
                cv2.imwrite('debug_original.png', image)
                cv2.imwrite('debug_mask.png', purple_mask)
                
                # Create overlay image showing detected rectangles
                overlay = image.copy()
                for item in detected_items:
                    x, y, w, h = item['x'], item['y'], item['width'], item['height']
                    cv2.rectangle(overlay, (x, y), (x + w, y + h), (0, 255, 0), 2)
                    cv2.putText(overlay, f"{item['confidence']:.2f}", (x, y - 10), 
                               cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)
                
                cv2.imwrite('debug_overlay.png', overlay)
                logger.info("Debug images saved: debug_original.png, debug_mask.png, debug_overlay.png")
            except Exception as e:
                logger.error(f"Failed to save debug images: {e}")
            
            return detected_items
            
        except Exception as e:
            logger.error(f"Error in V5 purple border detection: {e}")
            return []

    def detect_items(self, window_bounds: Dict) -> Dict:
        """Main detection function"""
        try:
            # Capture screen region
            image = self.capture_screen_region(window_bounds)
            if image is None:
                return {
                    'success': False,
                    'error': 'Failed to capture screen',
                    'items': []
                }
            
            # Detect purple borders using V5 algorithm
            items = self.detect_purple_borders(image)
            
            return {
                'success': True,
                'items': items,
                'count': len(items),
                'confidence': items[0]['confidence'] if items else 0.0,
                'timestamp': time.time()
            }
        
        except Exception as e:
            logger.error(f"Detection failed: {e}")
            return {
                'success': False,
                'error': str(e),
                'items': []
            }

    def move_mouse(self, x: int, y: int) -> Dict:
        """Move mouse to specified coordinates with natural, human-like movement"""
        try:
            mouse_speed = self.config.get('mouse_speed', 1.0)
            # Fix mouse speed calculation - higher speed = faster movement
            base_duration = 0.3 / mouse_speed  # Reduced base duration and fixed calculation
            
            # Get current mouse position
            current_x, current_y = pyautogui.position()
            
            # Calculate distance for more realistic duration scaling
            distance = ((x - current_x) ** 2 + (y - current_y) ** 2) ** 0.5
            
            # Scale duration based on distance (longer moves take more time)
            # Add some randomness to make it more human-like
            import random
            distance_factor = min(distance / 300, 1.5)  # Reduced distance factor impact
            random_factor = random.uniform(0.9, 1.1)  # Reduced randomness to ±10%
            duration = base_duration * distance_factor * random_factor
            
            # Add a small random delay before starting movement
            pre_delay = random.uniform(0.02, 0.05)  # Reduced delay
            time.sleep(pre_delay)
            
            logger.info(f"Moving mouse from ({current_x}, {current_y}) to ({x}, {y}) with speed {mouse_speed} (duration: {duration:.3f}s, distance: {distance:.1f}px)")
            
            # Use PyAutoGUI's built-in easing for smoother movement
            # PyAutoGUI uses a natural easing function by default
            pyautogui.moveTo(x, y, duration=duration, tween=pyautogui.easeInOutQuad)
            
            # Add a small random delay after movement to simulate human reaction time
            post_delay = random.uniform(0.01, 0.03)  # Reduced delay
            time.sleep(post_delay)
            
            return {
                'success': True,
                'x': x,
                'y': y,
                'mouse_speed': mouse_speed,
                'duration': duration,
                'distance': distance,
                'pre_delay': pre_delay,
                'post_delay': post_delay
            }
        except Exception as e:
            logger.error(f"Mouse movement failed: {e}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def click_mouse(self, x: int, y: int, modifiers: List[str] = ['ctrl']) -> Dict:
        """Click mouse at specified coordinates with modifiers"""
        try:
            import pyautogui
            import time
            import random
            
            # Add a small random delay before clicking
            pre_delay = random.uniform(0.05, 0.15)
            time.sleep(pre_delay)
            
            # Press modifiers
            for modifier in modifiers:
                pyautogui.keyDown(modifier)
            
            # Perform the click
            pyautogui.click(x, y)
            
            # Release modifiers
            for modifier in modifiers:
                pyautogui.keyUp(modifier)
            
            # Add a small random delay after clicking
            post_delay = random.uniform(0.05, 0.15)
            time.sleep(post_delay)
            
            logger.info(f"Clicked mouse at ({x}, {y}) with modifiers: {modifiers}")
            
            return {
                'success': True,
                'x': x,
                'y': y,
                'modifiers': modifiers,
                'pre_delay': pre_delay,
                'post_delay': post_delay
            }
            
        except Exception as e:
            logger.error(f"Mouse click failed: {e}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def press_key(self, key: str) -> Dict:
        """Press a key"""
        try:
            import pyautogui
            import time
            import random
            
            # Add a small random delay before pressing key
            pre_delay = random.uniform(0.05, 0.15)
            time.sleep(pre_delay)
            
            # Press the key
            pyautogui.press(key)
            
            # Add a small random delay after pressing key
            post_delay = random.uniform(0.05, 0.15)
            time.sleep(post_delay)
            
            logger.info(f"Pressed key: {key}")
            
            return {
                'success': True,
                'key': key,
                'pre_delay': pre_delay,
                'post_delay': post_delay
            }
            
        except Exception as e:
            logger.error(f"Key press failed: {e}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def move_mouse_curved(self, x: int, y: int) -> Dict:
        """Move mouse with a curved path for even more natural movement"""
        try:
            mouse_speed = self.config.get('mouse_speed', 1.0)
            # Fix mouse speed calculation - higher speed = faster movement
            base_duration = 0.3 / mouse_speed  # Reduced base duration and fixed calculation
            
            # Get current mouse position
            current_x, current_y = pyautogui.position()
            
            # Calculate distance
            distance = ((x - current_x) ** 2 + (y - current_y) ** 2) ** 0.5
            
            # Only use curved movement for longer distances
            if distance < 50:
                return self.move_mouse(x, y)  # Use straight movement for short distances
            
            # Create a curved path with intermediate points
            import random
            import math
            
            # Calculate midpoint with some random offset for natural curve
            mid_x = (current_x + x) / 2
            mid_y = (current_y + y) / 2
            
            # Add random curve offset (perpendicular to the main direction)
            dx = x - current_x
            dy = y - current_y
            length = math.sqrt(dx*dx + dy*dy)
            
            if length > 0:
                # Perpendicular vector for curve
                perp_x = -dy / length
                perp_y = dx / length
                
                # Random curve amount (10-30% of distance)
                curve_amount = random.uniform(0.1, 0.3) * length
                curve_offset_x = perp_x * curve_amount * random.uniform(-1, 1)
                curve_offset_y = perp_y * curve_amount * random.uniform(-1, 1)
                
                mid_x += curve_offset_x
                mid_y += curve_offset_y
            
            # Scale duration based on distance with randomness
            distance_factor = min(distance / 200, 2.0)
            random_factor = random.uniform(0.8, 1.2)
            duration = base_duration * distance_factor * random_factor
            
            # Add pre-delay
            pre_delay = random.uniform(0.05, 0.15)
            time.sleep(pre_delay)
            
            logger.info(f"Moving mouse with curved path from ({current_x}, {current_y}) to ({x}, {y}) via ({mid_x:.1f}, {mid_y:.1f})")
            
            # Move through the curved path in two segments
            segment_duration = duration / 2
            
            # First segment to midpoint
            pyautogui.moveTo(int(mid_x), int(mid_y), duration=segment_duration, tween=pyautogui.easeInOutQuad)
            
            # Small pause at midpoint (human-like hesitation)
            time.sleep(random.uniform(0.01, 0.03))
            
            # Second segment to final position
            pyautogui.moveTo(x, y, duration=segment_duration, tween=pyautogui.easeInOutQuad)
            
            # Post-delay
            post_delay = random.uniform(0.02, 0.08)
            time.sleep(post_delay)
            
            return {
                'success': True,
                'x': x,
                'y': y,
                'mouse_speed': mouse_speed,
                'duration': duration,
                'distance': distance,
                'curved': True,
                'midpoint': (int(mid_x), int(mid_y))
            }
        except Exception as e:
            logger.error(f"Curved mouse movement failed: {e}")
            return {
                'success': False,
                'error': str(e)
            }

    def click_mouse(self, x: int, y: int, modifiers: List[str] = None) -> Dict:
        """Click mouse at specified coordinates with optional modifiers"""
        try:
            # Move to position first
            self.move_mouse(x, y)
            time.sleep(0.1)
            
            # Apply modifiers
            modifier_keys = modifiers or self.config.get('click_modifiers', [])
            
            # Press modifiers
            for modifier in modifier_keys:
                pyautogui.keyDown(modifier)
            
            # Perform click
            pyautogui.click()
            
            # Release modifiers
            for modifier in modifier_keys:
                pyautogui.keyUp(modifier)
            
            return {
                'success': True,
                'x': x,
                'y': y,
                'modifiers': modifier_keys
            }
        except Exception as e:
            logger.error(f"Mouse click failed: {e}")
            return {
                'success': False,
                'error': str(e)
            }

    def press_key(self, key: str) -> Dict:
        """Press a key"""
        try:
            pyautogui.press(key)
            return {
                'success': True,
                'key': key
            }
        except Exception as e:
            logger.error(f"Key press failed: {e}")
            return {
                'success': False,
                'error': str(e)
            }

    def purchase_item(self, item_bounds: Dict) -> Dict:
        """Complete purchase sequence for detected item"""
        try:
            # Calculate center of item bounds
            center_x = item_bounds['x'] + (item_bounds['width'] // 2)
            center_y = item_bounds['y'] + (item_bounds['height'] // 2)
            
            # Click on item with Ctrl modifier
            click_result = self.click_mouse(center_x, center_y, ['ctrl'])
            
            if not click_result['success']:
                raise Exception(click_result['error'])
            
            # Wait for purchase to process
            time.sleep(1.0)
            
            # Refresh search
            refresh_result = self.press_key('f5')
            
            return {
                'success': True,
                'item_bounds': item_bounds,
                'click_result': click_result,
                'refresh_result': refresh_result
            }
            
        except Exception as e:
            logger.error(f"Item purchase failed: {e}")
            return {
                'success': False,
                'error': str(e)
            }

    def start_detection(self, config: Dict):
        """Start continuous detection"""
        if self.is_detecting:
            logger.warning("Detection already running")
            return
        
        self.update_config(config)
        self.is_detecting = True
        self.stop_detection = False
        
        self.detection_thread = threading.Thread(target=self._detection_loop)
        self.detection_thread.daemon = True
        self.detection_thread.start()
        
        logger.info("Detection started")

    def stop_detection_process(self):
        """Stop continuous detection"""
        if not self.is_detecting:
            return
        
        self.stop_detection = True
        self.is_detecting = False
        
        if self.detection_thread and self.detection_thread.is_alive():
            self.detection_thread.join(timeout=2.0)
        
        logger.info("Detection stopped")

    def _detection_loop(self):
        """Main detection loop"""
        start_time = time.time()
        
        while not self.stop_detection:
            try:
                # Check timeout
                if time.time() - start_time > self.config['detection_timeout'] / 1000:
                    logger.info("Detection timeout reached")
                    break
                
                # Perform detection
                result = self.detect_items(self.config['detection_window'])
                
                if result['success'] and result['items']:
                    # Send detection result
                    logger.info(f"Sending detection result with {len(result['items'])} items")
                    self._send_result('detection_result', {
                        'items': result['items'],
                        'confidence': result['confidence'],
                        'timestamp': result['timestamp']
                    })
                    logger.info("Detection result sent successfully")
                    
                    # Stop after finding an item
                    break
                
                # Wait before next detection
                time.sleep(self.config['detection_interval'] / 1000.0)
                
            except Exception as e:
                logger.error(f"Error in detection loop: {e}")
                self._send_result('error', {'error': str(e)})
                break
        
        self.is_detecting = False
        self._send_result('status', {'status': 'stopped', 'message': 'Detection completed'})

    def _send_result(self, result_type: str, data: Dict):
        """Send result to main process"""
        result = {
            'type': result_type,
            'timestamp': time.time(),
            **data
        }
        
        # Print JSON to stdout for main process to read
        print(json.dumps(result))
        sys.stdout.flush()

def main():
    """Main function for standalone execution"""
    detector = ItemDetector()
    
    try:
        # Read configuration from stdin (JSON mode)
        for line in sys.stdin:
            try:
                line = line.strip()
                if not line:  # Skip empty lines
                    continue
                
                logger.info(f"Received input: {line}")
                config = json.loads(line)
                logger.info(f"Parsed config: {config}")
                command_type = config.get('type') if config else None
                
                if command_type == 'config':
                    config_data = config.get('config') if config else None
                    if config_data is not None:
                        detector.update_config(config_data)
                        # Only start continuous detection if this is for startDetection, not detectItems
                        # For one-time detection (detectItems), we just update config without starting detection loop
                        if config.get('startContinuousDetection', False):
                            detector.start_detection(detector.config)
                    else:
                        # If no config provided, just start with default config
                        detector.start_detection(detector.config)
                    
                    # Always send a response back for config commands
                    logger.info("Sending config response back to Node.js")
                    result = {
                        'success': True,
                        'message': 'Configuration updated',
                        'startContinuousDetection': config.get('startContinuousDetection', False)
                    }
                    print(json.dumps(result))
                    sys.stdout.flush()
                    logger.info("Config response sent successfully")
                    logger.info("Continuing to next input line...")
                    
                elif command_type == 'test':
                    # Simple test command to verify Python environment
                    result = {
                        'success': True,
                        'message': 'Python environment test successful',
                        'timestamp': time.time()
                    }
                    print(json.dumps(result))
                    sys.stdout.flush()
                    
                elif command_type == 'detect':
                    logger.info("Received detect command")
                    # For one-time detection, use default config if not provided
                    window_bounds = config.get('windowBounds') if config else None
                    if not window_bounds or not isinstance(window_bounds, dict):
                        window_bounds = {
                            'x': 0, 'y': 0, 'width': 800, 'height': 600
                        }
                    
                    logger.info(f"Starting one-time detection with window bounds: {window_bounds}")
                    result = detector.detect_items(window_bounds)
                    logger.info(f"Detection completed, result: {result}")
                    print(json.dumps(result))
                    sys.stdout.flush()
                    logger.info("Result sent to Node.js")
                    
                elif command_type == 'move_mouse':
                    # Choose movement type based on config
                    movement_type = detector.config.get('mouse_movement_type', 'natural')
                    if movement_type == 'curved':
                        result = detector.move_mouse_curved(config.get('x', 0), config.get('y', 0))
                    else:
                        result = detector.move_mouse(config.get('x', 0), config.get('y', 0))
                    print(json.dumps(result))
                    sys.stdout.flush()
                    
                elif command_type == 'click_mouse':
                    result = detector.click_mouse(config.get('x', 0), config.get('y', 0), config.get('modifiers', ['ctrl']))
                    print(json.dumps(result))
                    sys.stdout.flush()
                    
                elif command_type == 'press_key':
                    result = detector.press_key(config.get('key', 'f5'))
                    print(json.dumps(result))
                    sys.stdout.flush()
                    
                elif command_type == 'click':
                    result = detector.click_mouse(
                        config.get('x', 0), 
                        config.get('y', 0), 
                        config.get('modifiers', [])
                    )
                    print(json.dumps(result))
                    sys.stdout.flush()
                    
                elif command_type == 'key_press':
                    result = detector.press_key(config.get('key', ''))
                    print(json.dumps(result))
                    sys.stdout.flush()
                    
                elif command_type == 'purchase':
                    result = detector.purchase_item(config.get('itemBounds', {}))
                    print(json.dumps(result))
                    sys.stdout.flush()
                    
                elif command_type == 'capture':
                    # Just capture screen without detection
                    image = detector.capture_screen_region(config.get('windowBounds', {}))
                    result = {
                        'success': image is not None,
                        'message': 'Screen captured' if image is not None else 'Failed to capture screen'
                    }
                    print(json.dumps(result))
                    sys.stdout.flush()
                    
            except json.JSONDecodeError as e:
                logger.error(f"JSON decode error: {e}")
                error_result = {
                    'success': False,
                    'error': f'Invalid JSON: {str(e)}',
                    'type': 'error'
                }
                print(json.dumps(error_result))
                sys.stdout.flush()
                continue
            except Exception as e:
                logger.error(f"Error processing input: {e}")
                logger.error(f"Input line: {line}")
                import traceback
                logger.error(f"Traceback: {traceback.format_exc()}")
                error_result = {
                    'success': False,
                    'error': str(e),
                    'type': 'error'
                }
                print(json.dumps(error_result))
                sys.stdout.flush()
                break
            
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
    except Exception as e:
        logger.error(f"Main execution error: {e}")
    finally:
        detector.stop_detection_process()

if __name__ == "__main__":
    main()
