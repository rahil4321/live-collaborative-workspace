// ==========================================
// Global State & Initialization
// ==========================================
const socket = io();
let editor = null;
let currentRoomId = null;
let currentUserId = null;
let isReceivingCode = false;
let typingTimeout = null;
const remoteCursors = new Map(); // Maps userId -> CodeMirror bookmark

// ==========================================
// DOM Elements Cache
// ==========================================
const DOM = {
  landingPage: document.getElementById('landing-page'),
  workspacePage: document.getElementById('workspace-page'),
  
  // Create Room Forms
  createRoomId: document.getElementById('create-room-id'),
  createPasscode: document.getElementById('create-passcode'),
  createUserName: document.getElementById('create-user-name'),
  btnCreateRoom: document.getElementById('btn-create-room'),
  
  // Join Room Forms
  joinRoomId: document.getElementById('join-room-id'),
  joinPasscode: document.getElementById('join-passcode'),
  joinUserName: document.getElementById('join-user-name'),
  btnJoinRoom: document.getElementById('btn-join-room'),
  
  // UI & Workspace
  errorMessage: document.getElementById('error-message'),
  roomTitle: document.getElementById('room-title'),
  roomSubtitle: document.getElementById('room-subtitle'),
  displayRoomId: document.getElementById('display-room-id'),
  btnLeaveRoom: document.getElementById('btn-leave-room'),
  btnCopyRoomId: document.getElementById('btn-copy-room-id'),
  languageSelect: document.getElementById('language-select'),
  codeEditor: document.getElementById('code-editor'),
  
  // Status & Lists
  statusIndicator: document.getElementById('status-indicator'),
  statusText: document.getElementById('status-text'),
  userCount: document.getElementById('user-count'),
  participantsList: document.getElementById('participants-list'),
  auditFeed: document.getElementById('audit-feed'),
  
  // Mobile UI
  mobileSidebar: document.getElementById('mobile-sidebar'),
  btnOpenSidebar: document.getElementById('btn-open-sidebar'),
  btnCloseSidebar: document.getElementById('btn-close-sidebar'),
  mobileParticipantsList: document.getElementById('mobile-participants-list'),
  mobileAuditFeed: document.getElementById('mobile-audit-feed'),
};

// ==========================================
// Initialize CodeMirror
// ==========================================
function initEditor() {
  editor = CodeMirror.fromTextArea(DOM.codeEditor, {
    mode: 'javascript',
    theme: 'dracula',
    lineNumbers: true,
    autoCloseBrackets: true,
    matchBrackets: true,
    styleActiveLine: true,
    indentUnit: 2,
    tabSize: 2,
    lineWrapping: true
  });

  // Handle local text changes
  editor.on('change', (cm, changeObj) => {
    if (isReceivingCode) return; // Prevent echo feedback loop
    
    const content = cm.getValue();
    const cursor = cm.getCursor();
    socket.emit('code-change', { content, cursor });
  });

  // Handle local cursor movement
  editor.on('cursorActivity', (cm) => {
    if (isReceivingCode) return;
    socket.emit('cursor-update', { cursor: cm.getCursor() });
  });

  // Handle local typing indicator
  editor.on('keydown', () => {
    socket.emit('typing-start');
    
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      socket.emit('typing-stop');
    }, 1500); // Stop typing indicator after 1.5s of inactivity
  });
}

// ==========================================
// Socket.IO Event Listeners
// ==========================================

socket.on('connect', () => {
  updateConnectionStatus('connected', 'Connected');
  // Re-join room automatically if socket re-connects after a drop
  if (currentRoomId && currentUserId) {
    socket.emit('request-sync');
  }
});

socket.on('disconnect', () => {
  updateConnectionStatus('disconnected', 'Disconnected');
});

socket.on('connect_error', () => {
  updateConnectionStatus('connecting', 'Reconnecting...');
});

socket.on('room-joined', (data) => {
  currentRoomId = data.roomId;
  currentUserId = data.userId;
  
  // UI Transitions
  DOM.landingPage.classList.add('hidden');
  DOM.workspacePage.classList.remove('hidden');
  
  // Update Header
  DOM.roomTitle.innerText = `Room: ${data.roomId}`;
  DOM.roomSubtitle.innerText = `Joined as ${data.userName}`;
  DOM.displayRoomId.innerText = data.roomId;
  
  // Initialize Workspace Data
  if (!editor) initEditor();
  
  isReceivingCode = true;
  editor.setValue(data.content || '');
  isReceivingCode = false;
  
  renderParticipants(data.users);
  renderAuditLog(data.auditLog);
  showToast(`Joined room successfully!`, 'success');
});

socket.on('room-error', (data) => {
  showError(data.message);
});

socket.on('code-update', (data) => {
  if (!editor) return;
  const currentContent = editor.getValue();
  
  if (currentContent !== data.content) {
    isReceivingCode = true;
    
    // Save current scroll and cursor state
    const cursor = editor.getCursor();
    const scrollInfo = editor.getScrollInfo();
    
    editor.setValue(data.content);
    
    // Restore scroll and cursor state
    editor.setCursor(cursor);
    editor.scrollTo(scrollInfo.left, scrollInfo.top);
    
    isReceivingCode = false;
  }

  // Update remote cursor for the user who made the change
  if (data.cursor) {
    updateRemoteCursor(data.userId, data.cursor);
  }
});

socket.on('remote-cursor', (data) => {
  updateRemoteCursor(data.userId, data.cursor, data.userName, data.userColor);
});

socket.on('user-list-update', (data) => {
  renderParticipants(data.users);
});

socket.on('audit-log-update', (data) => {
  renderAuditLog(data.logs);
});

socket.on('rate-limit-warning', (data) => {
  showToast(data.message, 'warning');
});

socket.on('user-left', (data) => {
  removeRemoteCursor(data.userId);
});

// ==========================================
// UI Interaction Listeners
// ==========================================

DOM.btnCreateRoom.addEventListener('click', () => {
  const roomId = DOM.createRoomId.value.trim().toUpperCase();
  const passcode = DOM.createPasscode.value.trim();
  const userName = DOM.createUserName.value.trim();
  
  if (!userName) {
    showError("Please enter your name to create a room.");
    return;
  }
  
  socket.emit('create-room', { 
    roomId: roomId || null, 
    passcode, 
    userName 
  });
});

DOM.btnJoinRoom.addEventListener('click', () => {
  const roomId = DOM.joinRoomId.value.trim().toUpperCase();
  const passcode = DOM.joinPasscode.value.trim();
  const userName = DOM.joinUserName.value.trim();
  
  if (!roomId || !userName) {
    showError("Room ID and Your Name are required.");
    return;
  }
  
  socket.emit('join-room', { roomId, passcode, userName });
});

DOM.btnLeaveRoom.addEventListener('click', () => {
  socket.emit('leave-room');
  currentRoomId = null;
  currentUserId = null;
  
  DOM.workspacePage.classList.add('hidden');
  DOM.landingPage.classList.remove('hidden');
  
  // Clear remote cursors
  for (let userId of remoteCursors.keys()) {
    removeRemoteCursor(userId);
  }
  
  showToast('You left the room', 'info');
});

DOM.languageSelect.addEventListener('change', (e) => {
  if (editor) {
    editor.setOption('mode', e.target.value);
  }
});

DOM.btnCopyRoomId.addEventListener('click', () => {
  navigator.clipboard.writeText(currentRoomId).then(() => {
    showToast('Room ID copied to clipboard!', 'success');
  });
});

// Mobile Sidebar Toggles
DOM.btnOpenSidebar.addEventListener('click', () => {
  DOM.mobileSidebar.classList.remove('hidden');
  DOM.mobileSidebar.classList.add('show');
});

DOM.btnCloseSidebar.addEventListener('click', () => {
  DOM.mobileSidebar.classList.remove('show');
  setTimeout(() => DOM.mobileSidebar.classList.add('hidden'), 300); // match animation
});

document.getElementById('sidebar-backdrop')?.addEventListener('click', () => {
  DOM.btnCloseSidebar.click();
});

// ==========================================
// Helper Functions
// ==========================================

function updateConnectionStatus(status, text) {
  DOM.statusIndicator.className = `w-2 h-2 rounded-full ${status}`;
  DOM.statusText.innerText = text;
}

function showError(message) {
  DOM.errorMessage.innerText = message;
  DOM.errorMessage.classList.remove('hidden');
  setTimeout(() => DOM.errorMessage.classList.add('hidden'), 5000);
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = '';
  if (type === 'success') icon = '<svg class="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>';
  if (type === 'error') icon = '<svg class="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>';
  if (type === 'warning') icon = '<svg class="w-4 h-4 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>';
  
  toast.innerHTML = `${icon} <span>${message}</span>`;
  document.body.appendChild(toast);
  
  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });
  
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function renderParticipants(users) {
  DOM.userCount.innerText = users.length;
  
  const generateHTML = (user) => `
    <div class="participant-item ${user.isHost ? 'host' : ''}" id="user-${user.id}">
      <div class="participant-avatar" style="background-color: ${user.color}30; color: ${user.color}; border: 1px solid ${user.color}50;">
        ${user.name.charAt(0)}
      </div>
      <div class="participant-info">
        <div class="participant-name">${user.name} ${user.id === currentUserId ? '(You)' : ''}</div>
        <div class="participant-badges">
          ${user.isHost ? '<span class="badge badge-host"><svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path></svg> Host</span>' : ''}
          ${user.isTyping && user.id !== currentUserId ? '<span class="typing-indicator">typing<span></span><span></span><span></span></span>' : ''}
        </div>
      </div>
    </div>
  `;

  const html = users.map(generateHTML).join('');
  DOM.participantsList.innerHTML = html;
  
  // Sync with mobile sidebar
  if (DOM.mobileParticipantsList) {
    DOM.mobileParticipantsList.innerHTML = html;
  }
}

function renderAuditLog(logs) {
  const getLogType = (msg) => {
    msg = msg.toLowerCase();
    if (msg.includes('joined') || msg.includes('created')) return 'join';
    if (msg.includes('left')) return 'leave';
    if (msg.includes('promoted')) return 'host-change';
    if (msg.includes('limit')) return 'rate-limit';
    return 'info';
  };

  const html = logs.map(log => {
    const time = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const type = getLogType(log.message);
    
    // Highlight usernames (usually the first word(s) before an action verb)
    let formattedMessage = log.message;
    const verbs = ['joined', 'left', 'created', 'promoted', 'exceeded'];
    for (let verb of verbs) {
      if (log.message.includes(verb)) {
        const parts = log.message.split(verb);
        formattedMessage = `<strong>${parts[0]}</strong> ${verb}${parts[1]}`;
        break;
      }
    }

    return `
      <div class="audit-item ${type}">
        <span class="audit-time">${time}</span>
        <span class="audit-message">${formattedMessage}</span>
      </div>
    `;
  }).join('');
  
  DOM.auditFeed.innerHTML = html;
  DOM.auditFeed.scrollTop = DOM.auditFeed.scrollHeight;
  
  // Sync with mobile sidebar
  if (DOM.mobileAuditFeed) {
    DOM.mobileAuditFeed.innerHTML = html;
    DOM.mobileAuditFeed.scrollTop = DOM.mobileAuditFeed.scrollHeight;
  }
}

function updateRemoteCursor(userId, cursorObj, userName = 'User', color = '#FFF') {
  if (!editor || !cursorObj) return;
  if (userId === currentUserId) return; // Don't highlight our own code

  removeRemoteCursor(userId);

  // 1. Create a dynamic style for this user's line tint
  let styleId = `style-user-${userId}`;
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    // The "20" at the end of the color adds ~12% opacity to the hex color
    style.innerHTML = `.line-tint-${userId} { background: ${color}20 !important; }`;
    document.head.appendChild(style);
  }

  // 2. Tint the background of the line they are currently editing
  const lineHandle = editor.addLineClass(cursorObj.line, 'background', `line-tint-${userId}`);

  // 3. Add a subtle name pill at the END of their current line
  const namePill = document.createElement('span');
  namePill.className = 'remote-author-name';
  namePill.style.backgroundColor = color;
  namePill.textContent = userName;

  const lineLength = editor.getLine(cursorObj.line).length;
  const widget = editor.setBookmark({ line: cursorObj.line, ch: lineLength }, {
    widget: namePill,
    insertLeft: false
  });

  remoteCursors.set(userId, { lineHandle, widget });
}

function removeRemoteCursor(userId) {
  if (remoteCursors.has(userId)) {
    const data = remoteCursors.get(userId);
    try {
      // Remove the background tint and the name pill
      editor.removeLineClass(data.lineHandle, 'background', `line-tint-${userId}`);
      data.widget.clear();
    } catch (e) {
      // Ignore if the editor text was completely reset
    }
    remoteCursors.delete(userId);
  }
}