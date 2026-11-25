import { mkdir, cp, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
await mkdir(new URL('dist/', root), { recursive: true });
await cp(new URL('public/',root),new URL('dist/',root),{recursive:true});
const url=process.env.SUPABASE_URL;
const key=process.env.SUPABASE_PUBLISHABLE_KEY;
if(!url || !key)throw new Error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required');
if(!url.startsWith('https://') || key.startsWith('sb_secret_'))throw new Error('Invalid public Supabase configuration');
await writeFile(new URL('dist/config.js',root),'window.SUPPLY_CONFIG='+JSON.stringify({url,key})+';\n');
console.log('Built authenticated supply planning app.');
