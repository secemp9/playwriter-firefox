/**
 * Firefox extension type definitions.
 * Firefox has limited extension capabilities compared to Chrome.
 */

/**
 * Recording state for a tab.
 */
export interface RecordingState {
  isRecording: boolean
  startedAt?: number
  tabId?: number
}

/**
 * Extension state.
 */
export interface ExtensionState {
  /** Recording state for the current tab */
  recording: RecordingState
  /** Current active tab ID */
  currentTabId?: number
  /** WebSocket connection state */
  connectionState: 'idle' | 'connecting' | 'connected' | 'error'
  /** Error message if any */
  errorText?: string
}

/**
 * Recording info stored during active recording.
 */
export interface RecordingInfo {
  tabId: number
  startedAt: number
  stream?: MediaStream
  recorder?: MediaRecorder
}

/**
 * Message from popup to background script.
 */
export type PopupMessage =
  | { action: 'startRecording' }
  | { action: 'stopRecording' }
  | { action: 'getStatus' }

/**
 * Response from background script to popup.
 */
export interface PopupResponse {
  success: boolean
  isRecording?: boolean
  error?: string
}

/**
 * Recording chunk message sent to relay server.
 */
export interface RecordingChunkMessage {
  method: 'recordingData'
  params: {
    tabId: number
    final?: boolean
  }
}

/**
 * Recording cancelled message sent to relay server.
 */
export interface RecordingCancelledMessage {
  method: 'recordingCancelled'
  params: {
    tabId: number
  }
}
