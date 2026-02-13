import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const defineEnv: Record<string, string> = {
  'process.env.PLAYWRITER_PORT': JSON.stringify(process.env.PLAYWRITER_PORT || '19988'),
};
if (process.env.TESTING) {
  defineEnv['import.meta.env.TESTING'] = 'true';
}

// Allow tests to build per-port extension outputs to avoid parallel run conflicts.
const outDir = process.env.PLAYWRITER_EXTENSION_DIST || 'dist';

export default defineConfig({
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: resolve(__dirname, 'icons/*'),
          dest: 'icons'
        },
        {
          src: resolve(__dirname, 'manifest.json'),
          dest: '.',
          transform: (content) => {
            const manifest = JSON.parse(content);

            // For development builds, use a different extension ID
            if (!process.env.PRODUCTION) {
              manifest.browser_specific_settings = {
                gecko: {
                  id: '{deadbeef-dead-beef-dead-beefdeadbeef}',
                  strict_min_version: '109.0'
                }
              };
            }

            return JSON.stringify(manifest, null, 2);
          }
        },
      ]
    })
  ],

  build: {
    outDir,
    emptyOutDir: false,
    minify: false,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
        'recording-popup': resolve(__dirname, 'src/recording-popup.html'),
      },
      output: {
        entryFileNames: '[name].js',
        format: 'es',
      },
    },
  },
  define: defineEnv
});
