# Lab Firewall Dashboard

A teacher dashboard for managing lab firewall access via Mikrotik REST API. Teachers can login and toggle firewall access to specific lab subnets (lab-1, lab-2, lab-3).

## Features

- **Teacher Authentication**: Login with teacher credentials
- **Lab Management**: View and toggle firewall access for each lab
- **Real-time Stats**:
    - Connected device count
    - IP range information
    - Firewall rule status
    - Active firewall rules count
    - Last refresh timestamp
- **Auto-refresh**: Dashboard auto-refreshes every 30 seconds
- **Responsive UI**: Works on desktop and mobile devices

## Architecture

### Backend (Bun HTTP Server)

- REST API endpoints for authentication and lab management
- Mikrotik REST API integration
- SQLite database for teacher credentials
- JWT-based authentication

### Frontend (React + Vite + TypeScript + Mantine)

- Single-page application with login and dashboard
- Fully typed with TypeScript
- Mantine UI components for modern, accessible UI
- Lab card components showing real-time stats
- Toggle buttons for enabling/disabling lab access
- Real-time status indicators
- Responsive design with Mantine's grid system

## Prerequisites

- Bun runtime (install from https://bun.sh)
- Access to Mikrotik router with REST API enabled
- Node.js 18+ (for npm/yarn if needed)

## Setup & Installation

### 1. Backend Setup

Install backend dependencies:

```bash
cd /home/d/Projects/chania-utils/labs
bun install
```

### 2. Configure Mikrotik Settings

Edit `config.json` with your Mikrotik router details:

```json
{
    "mikrotik": {
        "baseUrl": "https://192.168.88.1",
        "username": "admin",
        "password": "your-password",
        "insecure": true
    }
}
```

### 3. Install Frontend Dependencies

```bash
cd frontend
bun install
```

### 4. Build Frontend (for production)

```bash
cd frontend
bun run build
```

## Running the Application

### Development Mode (Backend Only)

```bash
bun run dev
```

Server runs at `http://localhost:3000`

### Development Mode (Frontend with Proxy)

In a separate terminal:

```bash
cd frontend
bun run dev
```

Frontend runs at `http://localhost:5173` with API proxy to backend

### Production Mode

```bash
bun run serve
```

Both frontend and backend run on `http://localhost:3000`

## Testing

### Test Teacher Credentials

Login with any of these test accounts:

```
mr_smith / password123
ms_johnson / password456
dr_williams / password789
```

Add more teachers by modifying the seed data in `backend/database.ts`.

## API Endpoints

### Authentication

- `POST /api/auth/login` - Login with teacher name and password
    - Request: `{ "name": "mr_smith", "password": "password123" }`
    - Response: `{ "token": "...", "teacher": { "id": 1, "name": "mr_smith" } }`

### Labs

- `GET /api/labs` - Get list of all labs
    - Headers: `Authorization: Bearer <token>`
    - Response: `{ "labs": [{ "id": "lab-1", "name": "Lab 1", ... }] }`

- `GET /api/labs/:labId/stats` - Get stats for a specific lab
    - Headers: `Authorization: Bearer <token>`
    - Response: `{ "lab": {...}, "firewall": {...}, "devices": {...}, "rules": {...} }`

- `POST /api/labs/:labId/toggle` - Toggle lab access
    - Headers: `Authorization: Bearer <token>`
    - Request: `{ "enable": true }`
    - Response: `{ "success": true, "lab": "lab-1", "enabled": true }`

## Mikrotik Configuration

The dashboard controls firewall rules on your Mikrotik router:

**Firewall Rules Controlled:**

- Lab-1: Rule ID 12 (pool::lab-1, subnet 10.0.1.0/24)
- Lab-2: Rule ID 13 (pool::lab-2, subnet 10.0.2.0/24)
- Lab-3: Rule ID 14 (pool::lab-3, subnet 10.0.3.0/24)

**Required Services:**

- `www-ssl` must be enabled on the router for HTTPS REST API access

**Required Router Capabilities:**

- REST API enabled
- Firewall rules configured (rules 12, 13, 14)
- DHCP server running with pools for each lab
- Address-lists for lab IP ranges

## Database

SQLite database created at `backend/teachers.db` on first run.

**Schema:**

```sql
CREATE TABLE teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

## Project Structure

```
/labs
├── backend/
│   ├── server.ts          # Main Bun HTTP server
│   ├── mikrotik.ts        # Mikrotik API wrapper
│   ├── auth.ts            # JWT & authentication
│   ├── database.ts        # SQLite setup & queries
│   └── teachers.db        # SQLite database (created on first run)
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Login.tsx     # Login page (TypeScript + Mantine)
│   │   │   └── Dashboard.tsx # Main dashboard (TypeScript + Mantine)
│   │   ├── components/
│   │   │   └── LabCard.tsx   # Lab card component (TypeScript + Mantine)
│   │   ├── api.ts           # API utilities with TypeScript interfaces
│   │   ├── App.tsx          # Main app component (TypeScript)
│   │   ├── main.tsx         # React entry point (TypeScript)
│   │   └── vite-env.d.ts    # Vite type declarations
│   ├── public/
│   │   └── index.html     # HTML entry point
│   ├── build/             # Built frontend (production)
│   ├── vite.config.ts     # Vite configuration (TypeScript)
│   ├── tsconfig.json      # TypeScript configuration
│   └── package.json
├── config.json            # Mikrotik & server configuration
├── package.json           # Backend dependencies
└── README.md
```

## Frontend Stack

- **React 18** - UI library
- **TypeScript** - Type-safe development
- **Vite** - Fast build tool and dev server
- **Mantine UI** - Modern, accessible component library
- **Tabler Icons** - Icon set for Mantine components
- **Mantine Hooks** - Custom React hooks for state management

## Troubleshooting

### "Connection refused" to Mikrotik

- Verify Mikrotik IP address in `config.json`
- Ensure `www-ssl` service is enabled on router
- Check firewall rules allow access from your network
- Verify username and password are correct
- Test with curl: `curl -k https://192.168.88.1/rest/ip/firewall/filter`

### Frontend not loading

- Ensure frontend is built: `cd frontend && bun run build`
- Check that backend is serving files from `frontend/build/`
- Try accessing `http://localhost:3000` after starting backend
- Check browser console (F12) for errors

### Login fails with valid credentials

- Check SQLite database exists: `backend/teachers.db`
- Verify test teacher credentials match `backend/database.ts`
- Check browser console for API error messages
- Verify backend server is running and accessible

### Stats not updating

- Verify Mikrotik API is responding
- Check rule IDs in `config.json` match your router (e.g., rules 12, 13, 14)
- Verify DHCP pools are configured on router
- Confirm firewall rules exist and are not invalid

## Development Notes

### Security Considerations

- **JWT Secret**: Change `JWT_SECRET` in `backend/auth.ts` for production
- **CORS**: Currently allows all origins. Restrict in production:
    ```typescript
    "Access-Control-Allow-Origin": "https://yourdomain.com"
    ```
- **SSL**: Self-signed certificates bypass verification in dev (`insecure: true`). Use proper certs in production.

### Database Persistence

- Current implementation uses sql.js with file persistence via `fs.writeFileSync()`
- For high-availability, consider migrating to PostgreSQL or MySQL

### Performance Tuning

- Auto-refresh interval: Adjust in `config.json` `server.statsRefreshInterval`
- DHCP cache: Implement caching to reduce router API calls
- Connection pooling: Consider for high-traffic production deployments

## Extending the Dashboard

### Add More Labs

1. Add lab definition to `config.json`:

    ```json
    {
        "id": "lab-4",
        "name": "Lab 4",
        "pool": "pool::lab-4",
        "subnet": "10.0.4.0/24",
        "ruleId": "15"
    }
    ```

2. Add firewall rule to Mikrotik router

### Add More Teachers

Edit `backend/database.ts` and add to `TEST_PASSWORDS`:

```typescript
const TEST_PASSWORDS: Record<string, string> = {
    new_teacher: 'secure_password',
    // ...
};
```

### Add Audit Logging

Create `backend/logging.ts` to log all firewall rule changes with teacher names and timestamps.

## License

MIT

```

The dashboard will be available at `http://localhost:3000`

## Default Teacher Credentials

- **Username**: teacher
- **Password**: teacher123

## Features

- Teacher authentication via SQLite database
- Real-time lab firewall rule toggling
- Connected device count per lab
- Lab bandwidth and active device statistics
- Auto-refreshing dashboard (30s intervals)

## Architecture

- **Backend**: Bun HTTP server with Express-like routing
- **Frontend**: React SPA with Vite
- **Database**: SQLite3 for teacher credentials
- **Router API**: Mikrotik REST API for firewall control
```
