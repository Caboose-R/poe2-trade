#!/usr/bin/env python3
"""
Simple test script to verify computer vision dependencies are working
"""

import sys
import json

def test_imports():
    """Test if all required packages can be imported"""
    try:
        import cv2
        print("✓ OpenCV imported successfully")
    except ImportError as e:
        print(f"✗ OpenCV import failed: {e}")
        return False

    try:
        import numpy as np
        print("✓ NumPy imported successfully")
    except ImportError as e:
        print(f"✗ NumPy import failed: {e}")
        return False

    try:
        import mss
        print("✓ MSS (screen capture) imported successfully")
    except ImportError as e:
        print(f"✗ MSS import failed: {e}")
        return False

    try:
        import pyautogui
        print("✓ PyAutoGUI imported successfully")
    except ImportError as e:
        print(f"✗ PyAutoGUI import failed: {e}")
        return False

    return True

def test_basic_cv():
    """Test basic OpenCV functionality"""
    try:
        import cv2
        import numpy as np
        
        # Create a simple test image
        test_image = np.zeros((100, 100, 3), dtype=np.uint8)
        
        # Test HSV conversion
        hsv = cv2.cvtColor(test_image, cv2.COLOR_BGR2HSV)
        print("✓ OpenCV HSV conversion working")
        
        # Test color range detection
        mask = cv2.inRange(hsv, np.array([120, 50, 50]), np.array([180, 255, 255]))
        print("✓ OpenCV color range detection working")
        
        return True
    except Exception as e:
        print(f"✗ OpenCV basic test failed: {e}")
        return False

def test_screen_capture():
    """Test screen capture functionality"""
    try:
        import mss
        
        with mss.mss() as sct:
            # Get primary monitor
            monitor = sct.monitors[1]
            
            # Capture a small region
            screenshot = sct.grab(monitor)
            print(f"✓ Screen capture working - captured {screenshot.width}x{screenshot.height} image")
            
        return True
    except Exception as e:
        print(f"✗ Screen capture test failed: {e}")
        return False

def main():
    """Run all tests"""
    print("Computer Vision Environment Test")
    print("=" * 40)
    
    all_tests_passed = True
    
    print("\n1. Testing package imports...")
    if not test_imports():
        all_tests_passed = False
    
    print("\n2. Testing basic OpenCV functionality...")
    if not test_basic_cv():
        all_tests_passed = False
    
    print("\n3. Testing screen capture...")
    if not test_screen_capture():
        all_tests_passed = False
    
    print("\n" + "=" * 40)
    if all_tests_passed:
        print("✓ All tests passed! Computer vision environment is ready.")
        sys.exit(0)
    else:
        print("✗ Some tests failed. Please check the errors above.")
        sys.exit(1)

if __name__ == "__main__":
    main()
