// scripts/setup.sh
#!/bin/bash

echo "Setting up Judicial Transcripts System..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "Docker is not installed. Please install Docker first."
    exit 1
fi

# Install dependencies
echo "Installing npm dependencies..."
npm install

# Start Docker services
echo "Starting Docker services..."
docker-compose up -d

# Wait for services to be ready
echo "Waiting for services to start..."
sleep 10

# Generate Prisma client
echo "Generating Prisma client..."
npm run prisma:generate

# Run database migrations
echo "Running database migrations..."
npm run prisma:migrate

# Seed database
echo "Seeding database..."
npm run seed

# Create necessary directories
echo "Creating directories..."
mkdir -p logs
mkdir -p transcripts
mkdir -p exports
mkdir -p uploads

echo "Setup completed successfully!"
echo ""
echo "To start processing transcripts, run:"
echo "  npm run parse -- --config ./config/your-config.json --all"
echo ""
echo "To start the API server, run:"
echo "  npm run start"
echo ""
echo "Access Kibana at: http://localhost:5601"
echo "Access PostgreSQL at: localhost:5432"