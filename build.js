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

// Copy Python script
fs.copyFileSync('python/cv_detection.py', path.join(pythonDistPath, 'cv_detection.py'));

// Create Python requirements file for embedded environment
const embeddedRequirements = `opencv-python==4.8.1.78
numpy==1.24.3
mss==9.0.1
Pillow==10.0.1`;
fs.writeFileSync(path.join(pythonDistPath, 'requirements.txt'), embeddedRequirements);

console.log('Build completed successfully!');
console.log('Executable location: dist/');
