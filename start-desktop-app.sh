#!/bin/bash

# Interview Copilot - Desktop App Launcher
# This script starts both the backend server and the Electron desktop app

echo "🚀 Starting Interview Copilot Desktop App..."
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "⚠️  Warning: .env file not found!"
    echo "Please create .env file with your API keys:"
    echo "  GROQ_API_KEY=your_groq_api_key"
    echo "  or"
    echo "  AI_INTEGRATIONS_OPENAI_API_KEY=your_openai_api_key"
    echo ""
    read -p "Press Enter to continue anyway or Ctrl+C to exit..."
fi

# Kill any existing processes on port 5000
echo "🧹 Cleaning up existing processes..."
lsof -ti:5000 | xargs kill -9 2>/dev/null || true

echo ""
echo "✅ Starting backend server and desktop app..."
echo ""
echo "📝 Usage:"
echo "  - Backend will start at http://localhost:5000"
echo "  - Desktop app will open automatically"
echo "  - Use Cmd+Shift+A to toggle window visibility"
echo "  - Use Cmd+Shift+R to reload window"
echo "  - Click tray icon for more options"
echo ""
echo "Press Ctrl+C to stop both processes"
echo ""

# Start both backend and electron app
npm run electron:dev
