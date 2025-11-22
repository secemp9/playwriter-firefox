this codebase has the codebase for playwriter

the extension uses chrome.debugger to manage the user browser

read ./README.md for an overview of how this extension and mcp work

## architecture

- user installs the extension in chrome. we assume there is only one chrome window for now, the first opened. 
- extension connects to a websocket server. on 19988. if this server is still not open, it retries connecting in a loop
- the MCP spawns the ws server if not already listening on 19988, in background. the mcp then connects to this same server with a playwright client
- the server exposes /cdp/client-id which is used by playwright clients to communicate with the extension
- the extension instead connects to /extension which is used to receive cdp commands and send responses and cdp events.
- some events are treated specially for example because
  - we need to send attachedToTarget to let playwright know which pages are available
  - we need to send detachedFromTarget when we disable the extension in a tab
  - a few more events need custom handling
- tabs are identified by sessionId or targetId (CDP concepts) or tabId (chrome debugger concept only)
