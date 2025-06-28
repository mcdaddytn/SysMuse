# pgAdmin Setup and Usage Guide

## Overview
pgAdmin is a powerful web-based administration tool for PostgreSQL. With our Docker setup, it runs alongside your PostgreSQL database and provides a visual interface for database management.

## Initial Setup

### 1. Create pgAdmin Server Configuration
Create a file named `pgadmin-servers.json` in your project root (same directory as docker-compose.yml):

```json
{
  "Servers": {
    "1": {
      "Name": "Timesheet Database",
      "Group": "Servers",
      "Host": "postgres",
      "Port": 5432,
      "MaintenanceDB": "postgres",
      "Username": "postgres",
      "SSLMode": "prefer",
      "PassFile": "/tmp/pgpassfile"
    }
  }
}
```

### 2. Start the Services
```powershell
# Start both PostgreSQL and pgAdmin
docker-compose up -d

# Verify both containers are running
docker ps

# You should see both timesheet_postgres and timesheet_pgadmin running
```

### 3. Access pgAdmin
1. Open your browser and navigate to: **http://localhost:5050**
2. Login with:
   - Email: `admin@timesheet.com`
   - Password: `admin`

### 4. Connect to the Database
If the server isn't automatically connected:
1. Right-click on "Timesheet Database" in the left panel
2. Click "Connect"
3. Enter password: `postgres`
4. Check "Save password" for convenience

## Using pgAdmin with the Timesheet Application

### Viewing Tables and Data

1. **Navigate to your database**:
   ```
   Servers → Timesheet Database → Databases → timesheet_db → Schemas → public → Tables
   ```

2. **View table data**:
   - Right-click on any table (e.g., `TeamMember`)
   - Select "View/Edit Data" → "All Rows"

3. **Important tables in our application**:
   - `TeamMember`: All team members
   - `Client`: Client organizations
   - `Matter`: Legal matters/projects
   - `Task`: Task descriptions linked to matters
   - `Timesheet`: Weekly timesheet headers
   - `TimesheetEntry`: Individual time entries

### Common pgAdmin Tasks for Development

#### 1. View Weekly Timesheet Data
```sql
-- View all timesheet entries for a specific week
SELECT 
    tm.name as team_member,
    m.name as matter,
    c.name as client,
    te.task_description,
    te.urgency,
    te.projected_hours,
    te.actual_hours,
    t.week_start_date
FROM "TimesheetEntry" te
JOIN "Timesheet" t ON te.timesheet_id = t.id
JOIN "TeamMember" tm ON t.team_member_id = tm.id
JOIN "Matter" m ON te.matter_id = m.id
JOIN "Client" c ON m.client_id = c.id
WHERE t.week_start_date = '2025-06-22'
ORDER BY tm.name, m.name;
```

#### 2. Check Time Allocation Totals
```sql
-- Verify that projected/actual hours sum to 100 for each timesheet
SELECT 
    tm.name,
    t.week_start_date,
    SUM(te.projected_hours) as total_projected,
    SUM(te.actual_hours) as total_actual
FROM "TimesheetEntry" te
JOIN "Timesheet" t ON te.timesheet_id = t.id
JOIN "TeamMember" tm ON t.team_member_id = tm.id
GROUP BY tm.name, t.week_start_date
ORDER BY t.week_start_date DESC;
```

#### 3. Find Available Matters
```sql
-- List all matters with their clients
SELECT 
    m.name as matter_name,
    m.description,
    c.name as client_name
FROM "Matter" m
JOIN "Client" c ON m.client_id = c.id
ORDER BY c.name, m.name;
```

### Using Query Tool

1. **Open Query Tool**:
   - Right-click on `timesheet_db`
   - Select "Query Tool"

2. **Run queries**:
   - Type or paste SQL
   - Press F5 or click the "Execute" button

3. **Save useful queries**:
   - File → Save As
   - Save queries for repeated use

### Database Maintenance Tasks

#### 1. Backup Database
Using pgAdmin:
1. Right-click on `timesheet_db`
2. Select "Backup..."
3. Provide filename and location
4. Click "Backup"

Using Docker command:
```powershell
docker exec -t timesheet_postgres pg_dump -U postgres timesheet_db > backup.sql
```

#### 2. Restore Database
Using pgAdmin:
1. Right-click on `timesheet_db`
2. Select "Restore..."
3. Choose backup file
4. Click "Restore"

Using Docker command:
```powershell
docker exec -i timesheet_postgres psql -U postgres timesheet_db < backup.sql
```

#### 3. Reset Test Data
```powershell
# From backend directory
cd backend

# Reset database and reseed
npm run prisma:migrate reset
npm run prisma:seed
```

### Monitoring and Debugging

#### 1. View Active Connections
```sql
SELECT pid, usename, application_name, client_addr, state
FROM pg_stat_activity
WHERE datname = 'timesheet_db';
```

#### 2. Check Table Sizes
```sql
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### pgAdmin Dashboard Features

1. **Server Dashboard**:
   - Click on "Timesheet Database"
   - View the Dashboard tab for real-time metrics
   - Monitor connections, transactions, and performance

2. **Table Statistics**:
   - Right-click any table → "Properties"
   - View "Statistics" tab for row counts and size

3. **SQL History**:
   - View → "Query History"
   - See all previously executed queries

## Docker Commands for pgAdmin

```powershell
# View pgAdmin logs
docker logs timesheet_pgadmin

# Restart pgAdmin
docker restart timesheet_pgadmin

# Stop pgAdmin only (database stays running)
docker stop timesheet_pgadmin

# Remove pgAdmin data and start fresh
docker-compose down
docker volume rm timesheet-app_pgadmin_data
docker-compose up -d
```

## Security Considerations

For production environments:
1. Change default pgAdmin credentials
2. Use environment variables for passwords
3. Restrict pgAdmin access to specific IP addresses
4. Use HTTPS for pgAdmin interface
5. Consider using Docker secrets for sensitive data

## Troubleshooting

### Cannot connect to pgAdmin
- Ensure Docker is running
- Check if port 5050 is available: `netstat -an | findstr 5050`
- Try accessing http://127.0.0.1:5050 instead of localhost

### Connection to database failed
- Ensure both containers are on the same network
- Use `postgres` as hostname (not localhost) when connecting from pgAdmin
- Verify PostgreSQL container is running: `docker ps`

### Slow performance
- Increase Docker memory allocation
- Clear pgAdmin cache: Settings → Reset Layout

### Data not showing up
- Refresh the browser (F5)
- Right-click on Tables and select "Refresh"
- Ensure you're connected to the correct database

## Useful pgAdmin Features for Timesheet App

1. **Visual Query Builder**: Tools → Query Tool → Graphical Query Builder
2. **Import/Export Data**: Right-click table → Import/Export
3. **ER Diagram**: Right-click on database → Generate ERD
4. **Table Dependencies**: Right-click table → Properties → Dependencies
5. **Backup Scheduler**: Tools → Schedule → Add Job (for automated backups)