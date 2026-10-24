# Tests

This directory contains property-based tests for the Interview Copilot application.

## Test Files

- `bug-exploration.test.ts` - Bug condition exploration tests
- `preservation-properties.test.ts` - Preservation property tests for VAD logic

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- bug-exploration.test.ts

# Run with verbose output
npm test -- --verbose
```

## Test Framework

- **Jest** - Test runner
- **fast-check** - Property-based testing library

## What is Property-Based Testing (PBT)?

Property-based testing validates that code satisfies formal specifications by:
1. Defining correctness properties (invariants that must always hold)
2. Generating random test inputs
3. Verifying properties hold for all inputs

This approach catches edge cases that example-based tests might miss.

## Test Suites

### Bug Exploration Tests
Tests that verify bug fixes by checking for specific conditions that should no longer occur:
- Fixed polling issues (VAD-based capture)
- Pre-flight checks (permissions, device availability)
- Screen capture protection
- DevTools security
- Memory management

### Preservation Property Tests
Tests that verify core functionality remains intact:
- Manual stop button behavior
- Answer display in stealth overlay
- Keyboard shortcuts
- Context file handling
- Audio accumulation
- Screen sharing audio capture
- MediaRecorder buffer management
- Track end detection
