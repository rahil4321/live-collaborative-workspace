const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const rooms = new Map();
const userRateLimits = new Map();
const MAX_UPDATES_PER_SECOND = 5;
const RATE_LIMIT_WINDOW_MS = 1000;

function generateUserId() {
  return 'user_' + Math.random().toString(36).substr(2, 9);
}

function generateRoomId() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      passcode: null,
      content: '',
      users: new Map(),
      hostId: null,
      auditLog: [],
      createdAt: Date.now()
    });
  }
  return rooms.get(roomId);
}

function addAuditLog(room, message) {
  const timestamp = new Date().toISOString();
  room.auditLog.push({ timestamp, message });
  if (room.auditLog.length > 100) {
    room.auditLog.shift();
  }
}

function broadcastUserList(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  const users = Array.from(room.users.values()).map(u => ({
    id: u.id,
    name: u.name,
    color: u.color,
    isHost: u.id === room.hostId,
    isTyping: u.isTyping || false,
    cursor: u.cursor || null
  }));

  io.to(roomId).emit('user-list-update', { users });
}

function broadcastAuditLog(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit('audit-log-update', { logs: room.auditLog });
}

function checkRateLimit(socketId) {
  const now = Date.now();
  const userLimit = userRateLimits.get(socketId) || { count: 0, windowStart: now };

  if (now - userLimit.windowStart >= RATE_LIMIT_WINDOW_MS) {
    userLimit.count = 1;
    userLimit.windowStart = now;
  } else {
    userLimit.count++;
  }

  userRateLimits.set(socketId, userLimit);

  return userLimit.count <= MAX_UPDATES_PER_SECOND;
}

function cleanupUserRateLimit(socketId) {
  userRateLimits.delete(socketId);
}

function reassignHost(room) {
  if (room.users.size === 0) {
    room.hostId = null;
    return;
  }

  let oldestUser = null;
  let oldestTime = Infinity;

  for (const [, user] of room.users) {
    if (user.joinedAt < oldestTime) {
      oldestTime = user.joinedAt;
      oldestUser = user;
    }
  }

  if (oldestUser && oldestUser.id !== room.hostId) {
    const previousHostId = room.hostId;
    room.hostId = oldestUser.id;
    addAuditLog(room, `${oldestUser.name} was promoted to host`);
    broadcastUserList(room.id);
    broadcastAuditLog(room.id);
  }
}

io.on('connection', (socket) => {
  let currentRoomId = null;
  let currentUserId = null;

  socket.on('create-room', ({ roomId, passcode, userName }) => {
    roomId = roomId || generateRoomId(); // <-- Add this line to auto-generate if empty
    const room = getRoom(roomId);

    if (room.users.size > 0) {
      socket.emit('room-error', { message: 'Room already exists' });
      return;
    }

    room.passcode = passcode || null;
    currentRoomId = roomId;
    currentUserId = generateUserId();

    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'];
    const userColor = colors[room.users.size % colors.length];

    const user = {
      id: currentUserId,
      name: userName || `User ${currentUserId.slice(0, 4)}`,
      color: userColor,
      socketId: socket.id,
      joinedAt: Date.now(),
      isTyping: false,
      cursor: null
    };

    room.users.set(currentUserId, user);
    room.hostId = currentUserId;
    room.content = room.content || '';

    addAuditLog(room, `${user.name} created and joined the room`);

    socket.join(roomId);
    socket.emit('room-joined', {
      roomId,
      userId: currentUserId,
      userName: user.name,
      userColor: user.color,
      isHost: true,
      content: room.content,
      users: Array.from(room.users.values()).map(u => ({
        id: u.id,
        name: u.name,
        color: u.color,
        isHost: u.id === room.hostId,
        isTyping: u.isTyping,
        cursor: u.cursor
      })),
      auditLog: room.auditLog
    });

    broadcastUserList(roomId);
    broadcastAuditLog(roomId);
  });

  socket.on('join-room', ({ roomId, passcode, userName }) => {
    const room = rooms.get(roomId);

    if (!room) {
      socket.emit('room-error', { message: 'Room does not exist' });
      return;
    }

    if (room.passcode && room.passcode !== passcode) {
      socket.emit('room-error', { message: 'Invalid passcode' });
      return;
    }

    currentRoomId = roomId;
    currentUserId = generateUserId();

    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'];
    const userColor = colors[room.users.size % colors.length];

    const user = {
      id: currentUserId,
      name: userName || `User ${currentUserId.slice(0, 4)}`,
      color: userColor,
      socketId: socket.id,
      joinedAt: Date.now(),
      isTyping: false,
      cursor: null
    };

    room.users.set(currentUserId, user);

    addAuditLog(room, `${user.name} joined the room`);

    socket.join(roomId);
    socket.emit('room-joined', {
      roomId,
      userId: currentUserId,
      userName: user.name,
      userColor: user.color,
      isHost: currentUserId === room.hostId,
      content: room.content,
      users: Array.from(room.users.values()).map(u => ({
        id: u.id,
        name: u.name,
        color: u.color,
        isHost: u.id === room.hostId,
        isTyping: u.isTyping,
        cursor: u.cursor
      })),
      auditLog: room.auditLog
    });

    socket.to(roomId).emit('user-joined', {
      user: {
        id: user.id,
        name: user.name,
        color: user.color,
        isHost: user.id === room.hostId,
        isTyping: false,
        cursor: null
      }
    });

    broadcastUserList(roomId);
    broadcastAuditLog(roomId);
  });

  socket.on('code-change', ({ content, cursor }) => {
    if (!currentRoomId || !currentUserId) return;

    if (!checkRateLimit(socket.id)) {
      socket.emit('rate-limit-warning', { message: 'Slow down: Too many updates per second' });
      const room = rooms.get(currentRoomId);
      if (room) {
        addAuditLog(room, `${room.users.get(currentUserId)?.name || 'Unknown'} exceeded rate limit`);
        broadcastAuditLog(currentRoomId);
      }
      return;
    }

    const room = rooms.get(currentRoomId);
    if (!room) return;

    room.content = content;

    const user = room.users.get(currentUserId);
    if (user) {
      user.cursor = cursor;
    }

    socket.to(currentRoomId).emit('code-update', {
      content,
      userId: currentUserId,
      cursor
    });
  });

  socket.on('cursor-update', ({ cursor }) => {
    if (!currentRoomId || !currentUserId) return;

    const room = rooms.get(currentRoomId);
    if (!room) return;

    const user = room.users.get(currentUserId);
    if (user) {
      user.cursor = cursor;
      socket.to(currentRoomId).emit('remote-cursor', {
        userId: currentUserId,
        userName: user.name,
        userColor: user.color,
        cursor
      });
    }
  });

  socket.on('typing-start', () => {
    if (!currentRoomId || !currentUserId) return;

    const room = rooms.get(currentRoomId);
    if (!room) return;

    const user = room.users.get(currentUserId);
    if (user) {
      user.isTyping = true;
      socket.to(currentRoomId).emit('user-typing', {
        userId: currentUserId,
        isTyping: true
      });
      broadcastUserList(currentRoomId);
    }
  });

  socket.on('typing-stop', () => {
    if (!currentRoomId || !currentUserId) return;

    const room = rooms.get(currentRoomId);
    if (!room) return;

    const user = room.users.get(currentUserId);
    if (user) {
      user.isTyping = false;
      socket.to(currentRoomId).emit('user-typing', {
        userId: currentUserId,
        isTyping: false
      });
      broadcastUserList(currentRoomId);
    }
  });

  socket.on('request-sync', () => {
    if (!currentRoomId) return;

    const room = rooms.get(currentRoomId);
    if (!room) return;

    socket.emit('code-sync', { content: room.content });
  });

  socket.on('disconnect', () => {
    if (currentRoomId && currentUserId) {
      const room = rooms.get(currentRoomId);
      if (room) {
        const user = room.users.get(currentUserId);
        if (user) {
          const userName = user.name;
          const wasHost = currentUserId === room.hostId;

          room.users.delete(currentUserId);
          addAuditLog(room, `${userName} left the room`);

          if (wasHost) {
            reassignHost(room);
          }

          socket.to(currentRoomId).emit('user-left', {
            userId: currentUserId,
            userName: userName
          });

          broadcastUserList(currentRoomId);
          broadcastAuditLog(currentRoomId);

          if (room.users.size === 0) {
            setTimeout(() => {
              const checkRoom = rooms.get(currentRoomId);
              if (checkRoom && checkRoom.users.size === 0) {
                rooms.delete(currentRoomId);
              }
            }, 300000);
          }
        }
      }
    }
    cleanupUserRateLimit(socket.id);
  });

  socket.on('leave-room', () => {
    if (currentRoomId && currentUserId) {
      const room = rooms.get(currentRoomId);
      if (room) {
        const user = room.users.get(currentUserId);
        if (user) {
          const userName = user.name;
          const wasHost = currentUserId === room.hostId;

          room.users.delete(currentUserId);
          addAuditLog(room, `${userName} left the room`);

          if (wasHost) {
            reassignHost(room);
          }

          socket.to(currentRoomId).emit('user-left', {
            userId: currentUserId,
            userName: userName
          });

          broadcastUserList(currentRoomId);
          broadcastAuditLog(currentRoomId);

          socket.leave(currentRoomId);
          currentRoomId = null;
          currentUserId = null;
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});