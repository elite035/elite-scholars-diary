import { build } from 'esbuild';
await build({
  entryPoints: ['client/export.mjs'],
  outfile: 'public/export.js',
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2022',
  legalComments: 'eof',
});
console.log('Browser document renderer bundled.');
