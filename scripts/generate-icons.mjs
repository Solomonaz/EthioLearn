import sharp from 'sharp';
import { mkdirSync } from 'fs';

mkdirSync('public/icons', { recursive: true });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="80" fill="#1B5E20"/>
  <text x="256" y="220" font-family="system-ui,sans-serif" font-size="200" font-weight="900" fill="white" text-anchor="middle" dominant-baseline="middle">A</text>
  <text x="256" y="390" font-family="system-ui,sans-serif" font-size="64" font-weight="600" fill="#FDD835" text-anchor="middle">Abugida</text>
</svg>`;

await sharp(Buffer.from(svg)).resize(192, 192).png().toFile('public/icons/icon-192.png');
await sharp(Buffer.from(svg)).resize(512, 512).png().toFile('public/icons/icon-512.png');
console.log('Icons generated!');
