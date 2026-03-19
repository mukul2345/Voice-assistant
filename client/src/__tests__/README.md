# Bug Condition Exploration Tests

## Overview

This directory contains bug condition exploration tests for the Production-Ready Stealth Copilot bugfix spec. These tests are designed to run on UNFIXED code and are EXPECTED TO FAIL, confirming that the bugs exist.

## Test Files

### 1. `bug-exploration.test.ts`
Main test file containing exploration tests for all 9 bugs across 5 test suites:
- **Suite 1.1**: Bug 1-2 - Fixed polling issues (Requirements 2.1, 2.2, 2.9)
- **Suite 1.2**: Bug 3-4 - Missing pre-flight checks (Requirements 2.3, 2.4)
- **Suite 1.3**: Bug 5-6 - Screen capture visibility (Requirements 2.5, 2.6)
- **Suite 1.4**: Bug 7 - DevTools exposure (Requirements 2.7)
- **Suite 1.5**: Bug 8-9 - Memory limitations (Requirements 2.8)

### 2. `bug-exploration-findings.md`
Detailed documentation of test results, root cause analysis, and counterexamples found.

### 3. `preservation-properties.test.ts`
Property-based tests for baseline behaviors that must be preserved after fixes:
- **Suite 2.1**: Manual stop button preservation (Requirement 3.1)
- **Suite 2.2**: Answer display preservation (Requirement 3.2)
- **Suite 2.3**: Keyboard shortcut preservation (Requirement 3.3)
- **Suite 2.4**: Context file upload preservation (Requirement 3.4)
- **Suite 2.5**: Audio accumulation preservation (Requirement 3.5)
- **Suite 2.6**: Screen sharing audio capture preservation (Requirement 3.6)
- **Suite 2.7**: MediaRecorder accumulation preservation (Requirement 3.7)
- **Suite 2.8**: Track end detection preservation (Requirement 3.8)

### 4. `preservation-test-findings.md`
Detailed documentation of preservation test results and verified baseline behaviors.

### 5. `preservation-properties-README.md`
Comprehensive guide to preservation property testing methodology and results.

## Running the Tests

### Bug Exploration Tests
```bash
npx tsx client/src/__tests__/bug-exploration.test.ts
```

### Preservation Property Tests
```bash
npx jest client/src/__tests__/preservation-properties.test.ts --verbose
```

## Test Philosophy

These tests follow the **Bug Condition Exploration** methodology:

1. **Run on UNFIXED code** - Tests are executed before implementing any fixes
2. **Expected to FAIL** - Failures confirm bugs exist and validate root cause analysis
3. **Document counterexamples** - Each failure provides evidence of the bug
4. **Encode expected behavior** - Tests represent requirements 2.1-2.9
5. **Validate fixes later** - Same tests will pass after bugs are fixed

## Test Status

✅ **Phase 1 Complete**: All 9 bugs confirmed through exploration testing
✅ **Phase 2 Complete**: All 8 preservation properties verified on unfixed code

### Confirmed Bugs (Phase 1)

1. ✅ Bug 1: 15-second questions processed at 10-second mark
2. ✅ Bug 2: Questions with pauses processed prematurely
3. ✅ Bug 3: Permission denied causes crash
4. ✅ Bug 4: No audio device causes crash
5. ✅ Bug 5: Windows overlay visible in screen capture
6. ✅ Bug 6: macOS overlay visible in screen capture
7. ✅ Bug 7: DevTools accessible in production mode
8. ✅ Bug 8: Repeated questions get inconsistent answers
9. ✅ Bug 9: Multi-part questions fragmented

### Verified Preservation Properties (Phase 2)

1. ✅ Manual stop button immediately halts capture and cleans up resources
2. ✅ AI answers display correctly in stealth overlay window
3. ✅ Keyboard shortcut toggles overlay visibility
4. ✅ Context files (resume, job description) included in AI prompts
5. ✅ Audio chunks accumulate when speech detected above threshold
6. ✅ System audio captured from meeting tab with screen sharing permissions
7. ✅ MediaRecorder accumulates chunks in audioChunksRef buffer
8. ✅ Track.onended event stops capture gracefully when screen sharing ends

## Root Causes Confirmed

1. **Fixed Polling Architecture** - 10-second interval in `use-audio-capture.ts`
2. **Missing Pre-flight Validation** - No permission/device checks before capture
3. **Missing Content Protection APIs** - Incomplete OS-level screen capture protection
4. **No DevTools Disabling** - Production mode doesn't disable DevTools
5. **Naive Memory Strategy** - No conversation memory hook, limited retention

## Next Steps

1. ✅ Phase 1 Complete: Bug exploration tests written and executed
2. ✅ Phase 2 Complete: Preservation property tests written and passing
3. ⏭️ Phase 3: Implement fixes for all 9 bugs
4. ⏭️ Phase 4: Verify exploration tests pass after fixes
5. ⏭️ Phase 5: Verify preservation tests still pass

## Important Notes

- **DO NOT** attempt to fix tests or code when they fail during Phase 1
- **DO** document all counterexamples and failures
- **DO** confirm root cause analysis matches actual code
- Tests encode expected behavior from requirements 2.1-2.9
- Same tests validate fixes in Phase 3+
