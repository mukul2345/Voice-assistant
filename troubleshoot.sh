#!/bin/bash

# Interview Copilot - Troubleshooting Script

echo "🔍 Interview Copilot - Troubleshooting"
echo "======================================"
echo ""

# Check Node.js
echo "Checking Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    echo "✅ Node.js $NODE_VERSION installed"
else
    echo "❌ Node.js not found"
    echo "   Install from: https://nodejs.org"
    exit 1
fi
echo ""

# Check npm
echo "Checking npm..."
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm -v)
    echo "✅ npm $NPM_VERSION installed"
else
    echo "❌ npm not found"
    exit 1
fi
echo ""

# Check if node_modules exists
echo "Checking dependencies..."
if [ -d "node_modules" ]; then
    echo "✅ node_modules folder exists"
else
    echo "⚠️  node_modules not found"
    echo "   Run: npm install"
fi
echo ""

# Check .env file
echo "Checking .env file..."
if [ -f ".env" ]; then
    echo "✅ .env file exists"
    
    # Check for API keys
    if grep -q "GROQ_API_KEY=.\+" .env; then
        echo "✅ GROQ_API_KEY found"
    elif grep -q "AI_INTEGRATIONS_OPENAI_API_KEY=sk-.\+" .env; then
        echo "✅ AI_INTEGRATIONS_OPENAI_API_KEY found"
    else
        echo "❌ No API key found in .env"
        echo "   Add one of:"
        echo "   - GROQ_API_KEY=your_key (recommended, free)"
        echo "   - AI_INTEGRATIONS_OPENAI_API_KEY=sk-your_key"
    fi
else
    echo "❌ .env file not found"
    echo "   Run: cp .env.example .env"
    echo "   Then add your API key"
fi
echo ""

# Check if port 5000 is available
echo "Checking port 5000..."
if lsof -Pi :5000 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "⚠️  Port 5000 is in use"
    echo "   Process using port 5000:"
    lsof -Pi :5000 -sTCP:LISTEN
    echo ""
    echo "   To kill it: lsof -i :5000 -t | xargs kill"
else
    echo "✅ Port 5000 is available"
fi
echo ""

# Check browser
echo "Checking browser..."
if [ "$(uname)" == "Darwin" ]; then
    # macOS
    if [ -d "/Applications/Google Chrome.app" ]; then
        echo "✅ Google Chrome found"
    elif [ -d "/Applications/Microsoft Edge.app" ]; then
        echo "✅ Microsoft Edge found"
    else
        echo "⚠️  Chrome or Edge not found"
        echo "   This app works best with Chrome or Edge"
    fi
else
    echo "ℹ️  Browser check skipped (not macOS)"
    echo "   Ensure you have Chrome or Edge installed"
fi
echo ""

# Check TypeScript compilation
echo "Checking TypeScript..."
if npm run check > /dev/null 2>&1; then
    echo "✅ TypeScript compilation successful"
else
    echo "⚠️  TypeScript has errors"
    echo "   Run: npm run check"
    echo "   (This may not prevent the app from running)"
fi
echo ""

# Summary
echo "======================================"
echo "Summary:"
echo ""

ISSUES=0

if ! command -v node &> /dev/null; then
    echo "❌ Install Node.js"
    ISSUES=$((ISSUES+1))
fi

if [ ! -d "node_modules" ]; then
    echo "❌ Run: npm install"
    ISSUES=$((ISSUES+1))
fi

if [ ! -f ".env" ]; then
    echo "❌ Create .env file"
    ISSUES=$((ISSUES+1))
elif ! grep -q "GROQ_API_KEY=.\+" .env && ! grep -q "AI_INTEGRATIONS_OPENAI_API_KEY=sk-.\+" .env; then
    echo "❌ Add API key to .env"
    ISSUES=$((ISSUES+1))
fi

if [ $ISSUES -eq 0 ]; then
    echo "✅ All checks passed!"
    echo ""
    echo "Ready to start:"
    echo "  npm run dev"
    echo ""
    echo "Then open: http://localhost:5000"
else
    echo ""
    echo "⚠️  Found $ISSUES issue(s) - fix them and try again"
fi
echo ""
