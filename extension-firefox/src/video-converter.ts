/**
 * Video Converter - Converts WebM to MP4 using ffmpeg.wasm
 *
 * Firefox MediaRecorder only supports WebM format, but many use cases
 * require MP4 output. This module uses ffmpeg.wasm to convert recordings
 * to MP4 format in the browser.
 *
 * Note: Uses single-threaded ffmpeg.wasm since SharedArrayBuffer is not
 * available in Firefox extensions.
 */

// We'll use dynamic imports since ffmpeg.wasm needs to be loaded at runtime
let ffmpegInstance: any = null
let ffmpegLoading: Promise<any> | null = null

export interface ConversionProgress {
  progress: number // 0-100
  time?: number // seconds processed
  speed?: string // e.g., "1.5x"
}

export interface ConversionResult {
  success: boolean
  data?: Uint8Array
  error?: string
  inputSize?: number
  outputSize?: number
  duration?: number
}

/**
 * Load ffmpeg.wasm (lazy loading)
 */
async function loadFFmpeg(): Promise<any> {
  if (ffmpegInstance) {
    return ffmpegInstance
  }

  if (ffmpegLoading) {
    return ffmpegLoading
  }

  ffmpegLoading = (async () => {
    try {
      // Dynamic import to avoid bundling issues
      const { FFmpeg } = await import('@ffmpeg/ffmpeg')
      const { toBlobURL } = await import('@ffmpeg/util')

      const ffmpeg = new FFmpeg()

      // Use CDN for ffmpeg core files (single-threaded version)
      const baseURL = 'https://unpkg.com/@anthropic-ai/ffmpeg-core@0.12.6/dist/esm'

      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      })

      ffmpegInstance = ffmpeg
      return ffmpeg
    } catch (error) {
      console.error('Failed to load ffmpeg:', error)
      throw error
    } finally {
      ffmpegLoading = null
    }
  })()

  return ffmpegLoading
}

/**
 * Convert WebM to MP4
 *
 * @param webmData - Input WebM data as Uint8Array or Blob
 * @param onProgress - Optional progress callback
 * @returns Conversion result with MP4 data
 */
export async function convertWebMToMP4(
  webmData: Uint8Array | Blob,
  onProgress?: (progress: ConversionProgress) => void
): Promise<ConversionResult> {
  const startTime = Date.now()

  try {
    const ffmpeg = await loadFFmpeg()

    // Convert Blob to Uint8Array if needed
    let inputData: Uint8Array
    if (webmData instanceof Blob) {
      const buffer = await webmData.arrayBuffer()
      inputData = new Uint8Array(buffer)
    } else {
      inputData = webmData
    }

    const inputSize = inputData.length

    // Set up progress handler
    if (onProgress) {
      ffmpeg.on('progress', ({ progress, time }: { progress: number; time: number }) => {
        onProgress({
          progress: Math.round(progress * 100),
          time: time / 1000000, // Convert to seconds
        })
      })
    }

    // Write input file
    await ffmpeg.writeFile('input.webm', inputData)

    // Convert to MP4 with H.264 and AAC
    // Using fast preset for reasonable speed in browser
    await ffmpeg.exec([
      '-i', 'input.webm',
      '-c:v', 'libx264',
      '-preset', 'ultrafast', // Fastest encoding
      '-crf', '23', // Good quality
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart', // Web optimization
      '-y', // Overwrite output
      'output.mp4'
    ])

    // Read output file
    const outputData = await ffmpeg.readFile('output.mp4')
    const outputSize = outputData.length

    // Cleanup
    await ffmpeg.deleteFile('input.webm')
    await ffmpeg.deleteFile('output.mp4')

    const duration = Date.now() - startTime

    return {
      success: true,
      data: outputData as Uint8Array,
      inputSize,
      outputSize,
      duration,
    }
  } catch (error) {
    console.error('FFmpeg conversion failed:', error)
    return {
      success: false,
      error: String(error),
      duration: Date.now() - startTime,
    }
  }
}

/**
 * Check if ffmpeg.wasm is available/supported
 */
export async function isFFmpegAvailable(): Promise<boolean> {
  try {
    await loadFFmpeg()
    return true
  } catch {
    return false
  }
}

/**
 * Get the current ffmpeg.wasm version
 */
export function getFFmpegVersion(): string {
  return '0.12.6' // ffmpeg.wasm version
}

/**
 * Convert WebM Blob to MP4 Blob
 *
 * Convenience function that returns a Blob directly
 */
export async function convertToMP4Blob(
  webmBlob: Blob,
  onProgress?: (progress: ConversionProgress) => void
): Promise<Blob | null> {
  const result = await convertWebMToMP4(webmBlob, onProgress)

  if (result.success && result.data) {
    // Create a new ArrayBuffer to ensure correct typing for Blob
    const buffer = new ArrayBuffer(result.data.length)
    new Uint8Array(buffer).set(result.data)
    return new Blob([buffer], { type: 'video/mp4' })
  }

  return null
}

/**
 * Download a Blob as a file
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
