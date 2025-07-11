#!/bin/bash

# Setup script for Matter Tracker application
# This script helps migrate from the old timesheet app to the new Matter Tracker

echo "🚀 Setting up Matter Tracker..."

# Check if we're in the right directory
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ Error: docker-compose.yml not found. Please run this script from the project root."
    exit 1
fi

echo "📦 Installing backend dependencies..."
cd backend
npm install

echo "🗄️ Updating database schema..."
npx prisma generate
npx prisma migrate dev --name "matter-tracker-update"

echo "🌱 Seeding database with updated data..."
npx prisma:seed

echo "📦 Installing frontend dependencies..."
cd ../frontend
npm install

echo "🏗️ Building frontend..."
npm run build

echo "🐳 Starting Docker services..."
cd ..
docker-compose up -d

echo "⏳ Waiting for services to start..."
sleep 10

echo "🎉 Matter Tracker setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Frontend: http://localhost:8080"
echo "2. Backend API: http://localhost:3000"
echo "3. pgAdmin: http://localhost:5050"
echo "   - Email: admin@timesheet.com"
echo "   - Password: admin"
echo ""
echo "🔧 To start development servers:"
echo "   Backend: cd backend && npm run dev"
echo "   Frontend: cd frontend && npm run dev"
echo ""
echo "📚 Features:"
echo "   - Weekly timesheets (default page)"
echo "   - Daily timesheets (/daily)"
echo "   - Percentage and time-based tracking"
echo "   - Task creation and management"
echo "   - Flexible time increments"
echo ""
echo "✅ Matter Tracker is ready to use!"