# Timesheet App - Mac Setup Instructions

## Prerequisites
- Docker Desktop for Mac: https://www.docker.com/products/docker-desktop/
- Node.js (v16+): https://nodejs.org/

## Quick Setup

### 1. Clone Repository
```bash
git clone <repository-url>
cd timesheet-app
```

### 2. Start PostgreSQL with Docker
```bash
# Start PostgreSQL and pgAdmin
docker-compose up -d

# Verify containers are running
docker ps
```

### 3. Setup Backend
```bash
cd backend
npm install

# Setup database
npm run prisma:generate
npm run prisma:push
npm run prisma:seed

# Start backend server
npm run dev
```

### 4. Setup Frontend (New Terminal)
```bash
cd frontend
npm install

# Start frontend
npm run dev
```

### 5. Access Applications
- **Frontend**: http://localhost:8080
- **Backend API**: http://localhost:3000/api/health
- **pgAdmin**: http://localhost:5050
  - Email: `admin@timesheet.com`
  - Password: `admin`
  - Database password: `postgres`

## Common Commands

### Database Reset
```bash
cd backend
npm run db:reset
```

### View Database
```bash
cd backend
npm run prisma:studio
```

### Stop Services
```bash
# Stop frontend/backend: Ctrl+C in respective terminals

# Stop Docker containers
docker-compose down
```

### Full Restart
```bash
# Stop everything
docker-compose down

# Start fresh
docker-compose up -d
cd backend && npm run dev
# New terminal
cd frontend && npm run dev
```

## Troubleshooting

### Port Already in Use
```bash
# Find process using port 3000
lsof -i :3000
# Kill process
kill -9 <PID>

# Same for port 8080 or 5432
```

### Database Connection Issues
```bash
# Check Docker is running
docker ps

# Restart PostgreSQL
docker-compose restart postgres

# Check logs
docker logs timesheet_postgres
```

### Clear Cache/Reset
```bash
# Frontend
cd frontend
rm -rf node_modules .quasar
npm install

# Backend
cd backend
rm -rf node_modules dist
npm install
```