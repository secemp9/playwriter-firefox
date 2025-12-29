import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(__dirname, '..', 'dist')

const ENTRY_CODE = `
import { getFiberFromHostInstance, getDisplayName, traverseFiber, isCompositeFiber, isHostFiber } from 'bippy'
import { getSource, getOwnerStack, normalizeFileName, isSourceFile } from 'bippy/source'

globalThis.__bippy = {
  getFiberFromHostInstance,
  getDisplayName,
  traverseFiber,
  isCompositeFiber,
  isHostFiber,
  getSource,
  getOwnerStack,
  normalizeFileName,
  isSourceFile,
}
`

async function main() {
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true })
  }

  const entryPath = path.join(distDir, '_bippy-entry.js')
  fs.writeFileSync(entryPath, ENTRY_CODE)

  console.log('Bundling bippy...')

  const result = await Bun.build({
    entrypoints: [entryPath],
    target: 'browser',
    format: 'iife',
    define: {
      'process.env.NODE_ENV': '"development"',
    },
  })

  fs.unlinkSync(entryPath)

  if (!result.success) {
    console.error('Bundle errors:', result.logs)
    process.exit(1)
  }

  const bundledCode = await result.outputs[0].text()
  const outputPath = path.join(distDir, 'bippy.js')
  fs.writeFileSync(outputPath, bundledCode)
  console.log(`Saved to ${outputPath} (${Math.round(bundledCode.length / 1024)}kb)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
