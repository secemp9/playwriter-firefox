/**
 * Firefox extension popup for screen recording.
 *
 * Uses getDisplayMedia() which requires user interaction.
 * The user must click the button and select a screen/window/tab to record.
 */

import browser from 'webextension-polyfill'

interface PopupResponse {
  success: boolean
  isRecording?: boolean
  error?: string
}

let isRecording = false
let recordingStartTime: number | null = null
let timerInterval: number | null = null

const statusEl = document.getElementById('status') as HTMLDivElement
const timerEl = document.getElementById('timer') as HTMLDivElement
const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement

/**
 * Update the UI based on recording state.
 */
function updateUI(recording: boolean, error?: string): void {
  isRecording = recording

  if (error) {
    statusEl.className = 'status error'
    statusEl.textContent = error
    recordBtn.textContent = 'Try Again'
    recordBtn.className = 'start'
    timerEl.style.display = 'none'
    stopTimer()
    return
  }

  if (recording) {
    statusEl.className = 'status recording'
    statusEl.textContent = 'Recording in progress...'
    recordBtn.textContent = 'Stop Recording'
    recordBtn.className = 'stop'
    timerEl.style.display = 'block'
    startTimer()
  } else {
    statusEl.className = 'status idle'
    statusEl.textContent = 'Ready to record'
    recordBtn.textContent = 'Start Recording'
    recordBtn.className = 'start'
    timerEl.style.display = 'none'
    stopTimer()
  }
}

/**
 * Format time as MM:SS.
 */
function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

/**
 * Start the recording timer.
 */
function startTimer(): void {
  recordingStartTime = Date.now()
  timerEl.textContent = '00:00'

  timerInterval = window.setInterval(() => {
    if (recordingStartTime) {
      const elapsed = Date.now() - recordingStartTime
      timerEl.textContent = formatTime(elapsed)
    }
  }, 1000)
}

/**
 * Stop the recording timer.
 */
function stopTimer(): void {
  if (timerInterval) {
    clearInterval(timerInterval)
    timerInterval = null
  }
  recordingStartTime = null
}

/**
 * Start screen recording.
 */
async function startRecording(): Promise<void> {
  try {
    recordBtn.disabled = true
    statusEl.textContent = 'Requesting screen capture...'

    // Request display media - this will show the picker
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      },
      audio: false, // Firefox doesn't support audio capture with getDisplayMedia
    })

    // Get current tab ID
    const tabs = await browser.tabs.query({ active: true, currentWindow: true })
    const tabId = tabs[0]?.id

    if (!tabId) {
      stream.getTracks().forEach(track => track.stop())
      throw new Error('No active tab found')
    }

    // Get background page and call startRecordingFromPopup
    const backgroundPage = await browser.runtime.getBackgroundPage()

    if (!backgroundPage || !(backgroundPage as any).startRecordingFromPopup) {
      stream.getTracks().forEach(track => track.stop())
      throw new Error('Background script not ready')
    }

    const result = await (backgroundPage as any).startRecordingFromPopup(stream, tabId)

    if (!result.success) {
      stream.getTracks().forEach(track => track.stop())
      throw new Error(result.error || 'Failed to start recording')
    }

    // Handle stream ending (user stopped sharing)
    stream.getVideoTracks()[0].onended = () => {
      console.log('Screen sharing stopped by user')
      stopRecording()
    }

    updateUI(true)
  } catch (error: unknown) {
    console.error('Failed to start recording:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to start recording'

    // Handle user cancellation gracefully
    if (errorMessage.includes('Permission denied') || errorMessage.includes('NotAllowedError')) {
      updateUI(false)
    } else {
      updateUI(false, errorMessage)
    }
  } finally {
    recordBtn.disabled = false
  }
}

/**
 * Stop screen recording.
 */
async function stopRecording(): Promise<void> {
  try {
    recordBtn.disabled = true
    statusEl.textContent = 'Stopping recording...'

    const response = (await browser.runtime.sendMessage({ action: 'stopRecording' })) as PopupResponse

    if (!response.success) {
      throw new Error(response.error || 'Failed to stop recording')
    }

    updateUI(false)
    statusEl.textContent = 'Recording saved!'

    // Close popup after a brief delay
    setTimeout(() => {
      window.close()
    }, 1500)
  } catch (error: unknown) {
    console.error('Failed to stop recording:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to stop recording'
    updateUI(false, errorMessage)
  } finally {
    recordBtn.disabled = false
  }
}

/**
 * Handle button click.
 */
recordBtn.addEventListener('click', async () => {
  if (isRecording) {
    await stopRecording()
  } else {
    await startRecording()
  }
})

/**
 * Check initial recording state.
 */
async function checkInitialState(): Promise<void> {
  try {
    const response = (await browser.runtime.sendMessage({ action: 'getStatus' })) as PopupResponse
    if (response.isRecording) {
      updateUI(true)
    }
  } catch {
    // Background script not ready yet
  }
}

// Check initial state on load
checkInitialState()
