# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Backend (Node.js + Express + Prisma)
```bash
cd backend
npm run dev              # Start development server with nodemon
npm run build            # Build TypeScript to dist/
npm start                # Run production build
npm run prisma:generate  # Generate Prisma client
npm run prisma:migrate   # Run database migrations
npm run prisma:seed      # Seed database with sample data
npm run prisma:studio    # Open Prisma Studio GUI
npm run db:reset         # Reset database and reseed
npm run setup            # Full setup: generate + migrate + seed
```

### Frontend (Vue 3 + Quasar + TypeScript)
```bash
cd frontend
npm run dev              # Start Quasar dev server (port 8080)
npm run build            # Build for production
npm run build:pwa        # Build as PWA
npm run lint             # Run ESLint
npm run format           # Format code with Prettier
```

### Database (PostgreSQL via Docker)
```bash
docker-compose up -d postgres    # Start PostgreSQL container
docker-compose up -d pgadmin     # Start pgAdmin (localhost:5050)
docker-compose down              # Stop all containers
```

## Architecture Overview

This is a full-stack timesheet tracking application with a clear separation between backend API and frontend SPA.

### Backend Architecture
- **Express.js API** with TypeScript serving REST endpoints at `/api/*`
- **Prisma ORM** for database operations with PostgreSQL
- **Modular route structure** in `backend/src/routes/` with separate files for each entity
- **Database models**: TeamMember, Client, Matter, Task, Timesheet, TimesheetEntry
- **Percentage-based time tracking** - hours stored as percentages (0-100) in database
- **Week-based timesheets** with unique constraint on teamMember + weekStartDate

### Frontend Architecture  
- **Vue 3 Composition API** with TypeScript
- **Quasar Framework** for UI components and responsive design
- **Centralized API service** in `src/services/api.ts` with Axios interceptors
- **Shared TypeScript models** in `src/types/models.ts` matching backend schema
- **Single-page timesheet interface** with week navigation and percentage-based entry

### Key Business Logic
- Time entries use **percentage-based hours** that convert to actual hours based on team member's working hours
- **Urgency levels**: HOT, MEDIUM, MILD for task prioritization  
- **Duplicate prevention**: Same matter + task combination not allowed within a week
- **Copy from previous week** functionality for efficiency
- **Real-time validation** ensuring projected/actual hours total 100%

### Database Schema Highlights
- `TimesheetEntry` has unique constraint on `[timesheetId, matterId, taskDescription]`
- Hours stored as integers (0-100 percentages) in `projectedHours` and `actualHours`
- `TeamMember.workingHours` defaults to 40 for percentage-to-hours conversion
- Cascading deletes configured for timesheet entries

### Development Environment
- **Backend port**: 3000 (configurable via PORT env var)
- **Frontend port**: 8080 (Quasar dev server)
- **Database**: PostgreSQL on port 5432 via Docker
- **pgAdmin**: Available on port 5050 for database management
- **Environment files**: `.env` required in both backend/ and frontend/ directories

### API Patterns
- RESTful endpoints following `/api/{resource}` pattern
- Timesheet operations use composite keys: `/:teamMemberId/:weekStartDate`
- Matter-task relationships for dropdown population
- Error handling with JSON responses and proper HTTP status codes