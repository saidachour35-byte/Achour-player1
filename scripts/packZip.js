import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

const zip = new JSZip();
const rootDir = process.cwd();

function addFilesRecursively(dirPath, zipFolder) {
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    if (file === 'node_modules' || file === 'dist' || file === '.git' || file === 'achour-player-5-fixed.zip') continue;

    const fullPath = path.join(dirPath, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      const subFolder = zipFolder.folder(file);
      addFilesRecursively(fullPath, subFolder);
    } else {
      const content = fs.readFileSync(fullPath);
      zipFolder.file(file, content);
    }
  }
}

addFilesRecursively(rootDir, zip);

zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }).then((buffer) => {
  const outputPath = path.join(rootDir, 'public', 'achour-player-5-fixed.zip');
  fs.writeFileSync(outputPath, buffer);
  console.log('Successfully generated achour-player-5-fixed.zip at:', outputPath);
});
