#!/bin/bash

# Interview Copilot - Quick Setup Script

echo "🚀 Interview Copilot - Setup"
echo "=============================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    echo "Please install Node.js 18+ from https://nodejs.org"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version is too old (found v$NODE_VERSION, need v18+)"
    echo "Please upgrade Node.js from https://nodejs.org"
    exit 1
fi

echo "✅ Node.js $(node -v) detected"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo "✅ Dependencies installed"
echo ""

# Setup .env file
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cp .env.example .env
    echo "✅ .env file created"
    echo ""
    echo "⚠️  IMPORTANT: You need to add an API key to .env"
    echo ""
    echo "Choose ONE option:"
    echo ""
    echo "Option 1 (Recommended - Free Tier):"
    echo "  1. Go to https://console.groq.com"
    echo "  2. Sign up and get your API key"
    echo "  3. Add to .env: GROQ_API_KEY=your_key_here"
    echo ""
    echo "Option 2 (Fallback):"
    echo "  1. Go to https://platform.openai.com/api-keys"
    echo "  2. Get your API key"
    echo "  3. Add to .env: AI_INTEGRATIONS_OPENAI_API_KEY=sk-your_key_here"
    echo ""
    echo "After adding your API key, run: npm run dev"
else
    echo "✅ .env file already exists"
    
    # Check if API key is set
    if grep -q "GROQ_API_KEY=.\+" .env || grep -q "AI_INTEGRATIONS_OPENAI_API_KEY=sk-.\+" .env; then
        echo "✅ API key found in .env"
        echo ""
        echo "🎉 Setup complete! Starting the server..."
        echo ""
        npm run dev
    else
        echo "⚠️  No API key found in .env"
        echo ""
        echo "Please add ONE of these to .env:"
        echo "  - GROQ_API_KEY=your_key_here (recommended, free)"
        echo "  - AI_INTEGRATIONS_OPENAI_API_KEY=sk-your_key_here"
        echo ""
        echo "Then run: npm run dev"
    fi
fi
