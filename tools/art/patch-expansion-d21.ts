// Apply one generated correction while keeping every other concept and the original captions.
import { join } from 'node:path';
import sharp from 'sharp';
import { ROOT } from './lib/sheets';

const dir=join(ROOT,'art/concepts/2026-10-23');
const source=join(dir,'drafts/05-towers-traps-before-d21.png');
const patch=await sharp(join(dir,'patches/d21-pitch-basin.png'))
  .extract({left:24,top:100,width:1206,height:910})
  .resize(380,279,{fit:'fill'}).png().toBuffer();
const output=join(dir,'05-towers-traps.png');
await sharp(source).composite([{input:patch,left:10,top:670}]).png().toFile(output);
const before=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
const after=await sharp(output).ensureAlpha().raw().toBuffer();
for(let y=0;y<before.info.height;y++)for(let x=0;x<before.info.width;x++){
  if(x>=10&&x<390&&y>=670&&y<949)continue;
  const offset=(y*before.info.width+x)*4;
  for(let c=0;c<4;c++)if(before.data[offset+c]!==after[offset+c])throw new Error('Changed pixels outside D21 art');
}
console.log('Corrected D21 art only; all other pixels and captions are unchanged.');
