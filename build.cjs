const fs = require('fs');
const path = require('path');

const srcHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

// Write to root index.html
fs.writeFileSync(path.join(__dirname, 'index.html'), srcHtml);

// Create dist directory and copy index.html & static files
const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}
fs.writeFileSync(path.join(distDir, 'index.html'), srcHtml);

// Copy static assets from public/ to dist/
const pubFiles = fs.readdirSync(path.join(__dirname, 'public'));
pubFiles.forEach(f => {
  const p = path.join(__dirname, 'public', f);
  if (fs.statSync(p).isFile()) {
    fs.copyFileSync(p, path.join(distDir, f));
  }
});

console.log('✓ Build successful: dist/ and root index.html generated.');
