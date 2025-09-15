#!/usr/bin/env python3
"""
Script to install required Python packages for computer vision functionality
"""

import subprocess
import sys
import os

def install_package(package):
    """Install a package using pip"""
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", package])
        return True
    except subprocess.CalledProcessError:
        return False

def main():
    """Install all required packages"""
    print("Installing required Python packages for PoE2 Trade Computer Vision...")
    print("=" * 60)
    
    required_packages = [
        "opencv-python",
        "numpy", 
        "mss",
        "pyautogui",
        "Pillow"
    ]
    
    failed_packages = []
    
    for package in required_packages:
        print(f"Installing {package}...", end=" ")
        if install_package(package):
            print("✓ Success")
        else:
            print("✗ Failed")
            failed_packages.append(package)
    
    print("=" * 60)
    
    if failed_packages:
        print(f"Failed to install: {', '.join(failed_packages)}")
        print("Please try installing them manually:")
        for package in failed_packages:
            print(f"  pip install {package}")
        return False
    else:
        print("✓ All packages installed successfully!")
        print("Computer vision functionality should now work.")
        return True

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
