export type ConnectionState = 'idle' | 'connected' | 'extension-replaced'
export type TabState = 'connecting' | 'connected' | 'error'

export interface TabInfo {
  sessionId?: string
  targetId?: string
  state: TabState
  errorText?: string
  pinnedCount?: number
  attachOrder?: number
  isRecording?: boolean
}

export interface ExtensionState {
  tabs: Map<number, TabInfo>
  connectionState: ConnectionState
  currentTabId: number | undefined
  errorText: string | undefined
}

/** 
 * Recording state - kept separate from store since MediaRecorder/MediaStream can't be serialized.
 * Note: MediaRecorder and MediaStream types are available in the extension's browser context.
 */
export interface RecordingInfo {
  tabId: number
  startedAt: number
  recorder: any // MediaRecorder - using any to avoid DOM type dependency
  stream: any // MediaStream - using any to avoid DOM type dependency
  mimeType: string
}
