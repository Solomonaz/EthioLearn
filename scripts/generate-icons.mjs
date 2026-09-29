// Regenerates the PNG app icons from the vector master (public/brand/app-icon.svg).
// Run after changing the logo: npm run generate-icons
import sharp from 'sharp';
import { readFileSync } from 'fs';

const svg = readFileSync('public/brand/app-icon.svg');
const render = (size, file) =>
  sharp(svg, { density: 300 }).resize(size, size).png().toFile(`public/icons/${file}`);

await render(512, 'icon-512.png');
await render(192, 'icon-192.png');
await render(180, 'apple-touch-icon.png');
console.log('Icons generated!');
