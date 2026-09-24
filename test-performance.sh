#!/bin/bash
# Performance Test Script for JIRA Monitor
# Run this before deployment to ensure performance requirements are met

set -e

echo "================================================================"
echo "JIRA Monitor Performance Test Suite"
echo "================================================================"
echo ""

# Performance thresholds
MAX_SCRIPT_TIME=30  # Monitor script must complete within 30 seconds
MAX_API_TIME=30     # API endpoint must respond within 30 seconds

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

test_passed=0
test_failed=0

# Test 1: Monitor Script Performance
echo "Test 1: Monitor Script Execution Time"
echo "--------------------------------------"
start=$(date +%s)
/usr/bin/python3 jira-test-monitor.py > /tmp/perf_test.log 2>&1
end=$(date +%s)
duration=$((end - start))

if [ $duration -le $MAX_SCRIPT_TIME ]; then
    echo -e "${GREEN}✅ PASS${NC} - Script completed in ${duration}s (threshold: ${MAX_SCRIPT_TIME}s)"
    test_passed=$((test_passed + 1))
else
    echo -e "${RED}❌ FAIL${NC} - Script took ${duration}s (threshold: ${MAX_SCRIPT_TIME}s)"
    echo "   Fix: Optimize API calls, use concurrent requests"
    test_failed=$((test_failed + 1))
fi
echo ""

# Test 2: Data File Creation
echo "Test 2: Data File Creation"
echo "--------------------------"
if [ -f "data/current.json" ]; then
    if cat data/current.json | jq empty 2>/dev/null; then
        echo -e "${GREEN}✅ PASS${NC} - Valid JSON data file created"
        test_passed=$((test_passed + 1))
    else
        echo -e "${RED}❌ FAIL${NC} - Invalid JSON format"
        test_failed=$((test_failed + 1))
    fi
else
    echo -e "${RED}❌ FAIL${NC} - Data file not created"
    test_failed=$((test_failed + 1))
fi
echo ""

# Test 3: API Response Time
echo "Test 3: Flask API Response Time"
echo "--------------------------------"
# Check if Flask is running
if ! curl -s http://localhost:5003/health > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  SKIP${NC} - Flask server not running"
else
    before=$(cat data/current.json | jq -r '.timestamp')
    start=$(date +%s)
    curl -s http://localhost:5003/api/current > /tmp/api_perf_test.json
    end=$(date +%s)
    duration=$((end - start))
    after=$(jq -r '.timestamp' /tmp/api_perf_test.json)

    if [ $duration -le $MAX_API_TIME ]; then
        echo -e "${GREEN}✅ PASS${NC} - API responded in ${duration}s (threshold: ${MAX_API_TIME}s)"
        test_passed=$((test_passed + 1))
    else
        echo -e "${RED}❌ FAIL${NC} - API took ${duration}s (threshold: ${MAX_API_TIME}s)"
        test_failed=$((test_failed + 1))
    fi

    # Verify data refresh
    if [ "$before" != "$after" ]; then
        echo -e "${GREEN}✅ PASS${NC} - Data refreshed (timestamp changed)"
        test_passed=$((test_passed + 1))
    else
        echo -e "${RED}❌ FAIL${NC} - Data not refreshed (timestamp unchanged)"
        test_failed=$((test_failed + 1))
    fi
fi
echo ""

# Test 4: Concurrent Refresh Test
echo "Test 4: Multiple Consecutive Refreshes"
echo "---------------------------------------"
refresh_failed=false
for i in 1 2 3; do
    start=$(date +%s)
    curl -s http://localhost:5003/api/current > /tmp/refresh_test_$i.json 2>&1
    end=$(date +%s)
    duration=$((end - start))

    if [ $duration -gt $MAX_API_TIME ]; then
        echo -e "${RED}❌ FAIL${NC} - Refresh $i took ${duration}s"
        refresh_failed=true
    else
        echo -e "${GREEN}✅ PASS${NC} - Refresh $i: ${duration}s"
    fi
done

if [ "$refresh_failed" = false ]; then
    test_passed=$((test_passed + 1))
else
    test_failed=$((test_failed + 1))
fi
echo ""

# Test 5: Data Structure Validation
echo "Test 5: Data Structure Validation"
echo "----------------------------------"
required_fields=(
    ".timestamp"
    ".execution_status.executed"
    ".execution_status.pass_rate"
    ".today"
    ".overall"
)

structure_valid=true
for field in "${required_fields[@]}"; do
    value=$(cat data/current.json | jq -r "$field")
    if [ "$value" = "null" ]; then
        echo -e "${RED}❌ FAIL${NC} - Missing field: $field"
        structure_valid=false
    fi
done

if [ "$structure_valid" = true ]; then
    echo -e "${GREEN}✅ PASS${NC} - All required fields present"
    test_passed=$((test_passed + 1))
else
    test_failed=$((test_failed + 1))
fi
echo ""

# Summary
echo "================================================================"
echo "Test Summary"
echo "================================================================"
echo -e "Passed: ${GREEN}${test_passed}${NC}"
echo -e "Failed: ${RED}${test_failed}${NC}"
echo ""

if [ $test_failed -eq 0 ]; then
    echo -e "${GREEN}✅ ALL TESTS PASSED${NC}"
    echo "System meets performance requirements."
    exit 0
else
    echo -e "${RED}❌ SOME TESTS FAILED${NC}"
    echo "Review failed tests and fix issues before deployment."
    exit 1
fi
