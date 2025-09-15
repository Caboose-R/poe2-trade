const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Building PoE2 Trade application...');

// Create dist directory
if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist');
}

// Build Electron app
console.log('Building Electron application...');
try {
    execSync('npm run dist', { stdio: 'inherit' });
    console.log('Electron build completed successfully');
} catch (error) {
    console.error('Electron build failed:', error.message);
    process.exit(1);
}

// Copy Python dependencies
console.log('Copying Python dependencies...');
const pythonDistPath = path.join('dist', 'python');
if (!fs.existsSync(pythonDistPath)) {
    fs.mkdirSync(pythonDistPath, { recursive: true });
}

// Copy all Python scripts
const pythonFiles = [
    'cv_detection.py',
    'install_python.py',
    'requirements.txt'
];

pythonFiles.forEach(file => {
    const srcPath = path.join('python', file);
    const destPath = path.join(pythonDistPath, file);
    if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`Copied ${file}`);
    }
});

// Create Python requirements file for embedded environment
const embeddedRequirements = `opencv-python==4.8.1.78
numpy==1.24.3
mss==9.0.1
Pillow==10.0.1
pyautogui==0.9.54`;
fs.writeFileSync(path.join(pythonDistPath, 'requirements.txt'), embeddedRequirements);

console.log('Build completed successfully!');
console.log('Executable location: dist/');
