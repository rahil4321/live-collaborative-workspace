# Live Collaborative Workspace & Code Pad

A highly responsive, multi-user real-time web workspace. Users can join persistent virtual rooms, collaborate on code across multiple languages, and track participant presence—all powered by Node.js, Express, Socket.IO, and CodeMirror.

## Features

- **Real-Time Synchronization**: Instant code and text syncing across all peers using Socket.IO.
- **Remote Presence & Highlights**: See exactly where other users are typing with subtle background line highlights and dynamic name tags to prevent code blocking.
- **Room Management**: Secure custom rooms with optional passcodes, or utilize the auto-generating room ID feature. 
- **Activity Audit Feed**: Live scrolling log tracking users joining, leaving, rate-limit warnings, and role changes.
- **Dynamic Role Reassignment**: The creator is assigned as Host. If the Host abruptly disconnects, the oldest remaining active user is automatically promoted to Host.
- **Connection Security**: Built-in server-side socket traffic throttling (max 5 updates/second) to prevent packet flooding and socket abuse.
- **Graceful Reconnection**: Smoothly handles abrupt socket disconnections, cleaning up user memory and seamlessly re-syncing the workspace upon reconnection.
- **Responsive Split UI**: A dark-mode interface (`Dracula` theme) built with TailwindCSS that works seamlessly on both desktop and mobile layouts.

## Tech Stack

- **Backend**: Node.js, Express, Socket.IO
- **Frontend**: Vanilla JavaScript, HTML5, CSS3, TailwindCSS (CDN)
- **Editor**: CodeMirror 5 (CDN)

## Prerequisites

- [Node.js](https://nodejs.org/en/) (v18.0.0 or higher recommended)
- npm (Node Package Manager)

## Environment Configuration & Setup

1. **Clone the Repository:**
   ```bash
   git clone <your-repository-url>
   cd live-collaborative-workspace
