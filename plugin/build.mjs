import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

const banner   = readFileSync(resolve(here, 'banner.txt'),       'utf8').trimEnd();
const polyfill = readFileSync(resolve(here, 'src/polyfill.js'),  'utf8').trimEnd();
const outFile  = resolve(here, '..', 'bc-offline-messenger.user.js');

const buildOptions = {
  entryPoints: [resolve(here, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  legalComments: 'inline',
  // Polyfill must run BEFORE the IIFE so its `var` declarations attach to script scope,
  // not the IIFE scope. esbuild's `banner.js` is placed before its IIFE wrapper.
  banner: { js: polyfill },
};

async function run() {
  const result = await esbuild.build(buildOptions);
  const out = result.outputFiles[0].text;
  writeFileSync(outFile, banner + '\n\n' + out);
  console.log(`built ${outFile} (${(out.length + banner.length) >> 10} KB)`);
}

if (watch) {
  const ctx = await esbuild.context({
    ...buildOptions,
    plugins: [{
      name: 'write-userscript',
      setup(build) {
        build.onEnd(result => {
          if (result.errors.length) return;
          const out = result.outputFiles[0].text;
          writeFileSync(outFile, banner + '\n\n' + out);
          console.log(`[watch] rebuilt ${(out.length + banner.length) >> 10} KB`);
        });
      },
    }],
  });
  await ctx.watch();
  console.log('watching plugin/src ...');
} else {
  await run();
}
