/**
 * Generates markdown resource files for the MCP at build time.
 * 
 * These files are written to:
 * - playwriter/dist/ - for the MCP to read at runtime
 * - website/public/ - for hosting on playwriter.dev
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dedent from 'string-dedent'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const playwriterDir = path.join(__dirname, '..')
const distDir = path.join(playwriterDir, 'dist')
const websitePublicDir = path.join(playwriterDir, '..', 'website', 'public', 'resources')

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(playwriterDir, relativePath), 'utf-8')
}

function writeToDestinations(filename: string, content: string) {
  ensureDir(distDir)
  ensureDir(websitePublicDir)
  
  const distPath = path.join(distDir, filename)
  const websitePath = path.join(websitePublicDir, filename)
  
  fs.writeFileSync(distPath, content, 'utf-8')
  fs.writeFileSync(websitePath, content, 'utf-8')
  
  console.log(`Generated ${filename}`)
}

function cleanTypes(typesContent: string): string {
  return typesContent
    .replace(/\/\/# sourceMappingURL=.*$/gm, '')
    .trim()
}

function buildDebuggerApi() {
  const debuggerTypes = cleanTypes(readFile('dist/debugger.d.ts'))
  const debuggerExamples = readFile('src/debugger-examples.ts')
  
  const content = dedent`
    # Debugger API Reference

    ## Types

    \`\`\`ts
    ${debuggerTypes}
    \`\`\`

    ## Examples

    \`\`\`ts
    ${debuggerExamples}
    \`\`\`
  `
  
  writeToDestinations('debugger-api.md', content)
}

function buildEditorApi() {
  const editorTypes = cleanTypes(readFile('dist/editor.d.ts'))
  const editorExamples = readFile('src/editor-examples.ts')
  
  const content = dedent`
    # Editor API Reference

    The Editor class provides a Claude Code-like interface for viewing and editing web page scripts at runtime.

    ## Types

    \`\`\`ts
    ${editorTypes}
    \`\`\`

    ## Examples

    \`\`\`ts
    ${editorExamples}
    \`\`\`
  `
  
  writeToDestinations('editor-api.md', content)
}

function buildStylesApi() {
  const stylesTypes = cleanTypes(readFile('dist/styles.d.ts'))
  const stylesExamples = readFile('src/styles-examples.ts')
  
  const content = dedent`
    # Styles API Reference

    The getStylesForLocator function inspects CSS styles applied to an element, similar to browser DevTools "Styles" panel.

    ## Types

    \`\`\`ts
    ${stylesTypes}
    \`\`\`

    ## Examples

    \`\`\`ts
    ${stylesExamples}
    \`\`\`
  `
  
  writeToDestinations('styles-api.md', content)
}

function buildSkill() {
  const promptContent = readFile('src/prompt.md')
  
  const frontmatter = dedent`
    ---
    name: playwriter
    description: Control Chrome browser via Playwright code snippets. Automate web interactions, take screenshots, inspect accessibility trees, and debug web applications.
    ---
  `
  
  const cliUsage = dedent`
    ## CLI Usage

    If \`playwriter\` command is not found, install globally or use npx/bunx:

    \`\`\`bash
    npm install -g playwriter
    # or use without installing:
    npx playwriter -e "..." -s 1
    bunx playwriter -e "..." -s 1
    \`\`\`

    ### Execute code

    \`\`\`bash
    playwriter -e "<code>" -s <session>
    \`\`\`

    The \`-s\` flag specifies a session name (required). Use the same session to persist state across commands.

    **Examples:**

    \`\`\`bash
    # Navigate to a page
    playwriter -e "await page.goto('https://example.com')" -s 1

    # Click a button
    playwriter -e "await page.click('button')" -s 1

    # Get page title
    playwriter -e "console.log(await page.title())" -s 1

    # Take a screenshot
    playwriter -e "await page.screenshot({ path: 'screenshot.png', scale: 'css' })" -s 1

    # Get accessibility snapshot
    playwriter -e "console.log(await accessibilitySnapshot({ page }))" -s 1
    \`\`\`

    ### Reset connection

    If the browser connection is stale or broken:

    \`\`\`bash
    playwriter reset -s <session>
    \`\`\`

  `
  
  const content = frontmatter + '\n\n' + cliUsage + '\n' + promptContent
  
  // Write to repo root skills/ folder for add-skill discovery
  const skillsDir = path.join(playwriterDir, '..', 'skills', 'playwriter')
  ensureDir(skillsDir)
  fs.writeFileSync(path.join(skillsDir, 'SKILL.md'), content, 'utf-8')
  
  console.log('Generated skills/playwriter/SKILL.md')
}

// Run all builds
buildDebuggerApi()
buildEditorApi()
buildStylesApi()
buildSkill()

console.log('Resource files generated successfully')
