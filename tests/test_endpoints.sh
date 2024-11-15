#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Set default API URL and sleep flag from arguments
API_URL=${1:-"http://localhost:8787"}
SLEEP_BEFORE_START=${2:-false}
FAILED_TESTS=0
TOTAL_TESTS=0

# If sleep flag is true, wait 10 seconds before starting tests
if [ "$SLEEP_BEFORE_START" = true ]; then
    echo "Waiting 10 seconds for deployment to stabilize..."
    sleep 10
fi

# Shared test addresses
TEST_ADDRESSES=(
    "SP3GEF4KYM4V41FHC9NX0F7K0GW1VC6A4WNJ855X3"
    "SP2733BAJCTWBM0790KC9GZYMP73S0VDYPRSAF95"
    "SP2CZP2W4PCD22GWXFYYKV40JXZBWVFN692T0FJQH"
    "SP22JJ7N9RN6ZDY2F6M2DHSDTYN4P768AHF3AG90A"
    "SPK0PEGF4Z37H0D6V1JEMGTD7BE36MHT75P8548J"
)

# tests an endpoint against several criteria
test_endpoint() {
    local endpoint=$1
    local expected_status=$2
    local description=$3
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    # Make the request and capture headers and body using -i
    response=$(curl -s -i -w "\n%{http_code}" -X GET "${API_URL}${endpoint}")
    
    # Parse response (modified to handle -i output)
    status=$(echo "$response" | tail -n1)
    headers=$(echo "$response" | grep -i "^[a-z-]*:" || true)
    body=$(echo "$response" | awk 'BEGIN{RS="\r\n\r\n"} NR==2')
    
    local test_failed=false

    # Check status code
    if [ "$status" -eq "$expected_status" ]; then
        echo -e "${GREEN}✓${NC} $description - Status: $status"
    else
        echo -e "${RED}✗${NC} $description - Expected status $expected_status, got $status"
        test_failed=true
    fi
    
    # Check CORS headers (case-insensitive)
    if ! echo "$headers" | grep -qi "access-control-allow-origin:"; then
        echo -e "${RED}✗${NC} Missing CORS headers for $endpoint"
        test_failed=true
    fi
    
    # Check content type (case-insensitive)
    if ! echo "$headers" | grep -qi "content-type:.*application/json"; then
        echo -e "${RED}✗${NC} Missing or incorrect Content-Type header for $endpoint"
        test_failed=true
    fi
    
    # Validate JSON response
    if ! echo "$body" | jq . >/dev/null 2>&1; then
        echo -e "${RED}✗${NC} Invalid JSON response for $endpoint"
        test_failed=true
    fi

    # Only increment failure counter once per endpoint
    if [ "$test_failed" = true ]; then
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi
}

# Test OPTIONS request for CORS
test_cors() {
    local endpoint=$1
    local description=$2
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    response=$(curl -s -w "\n%{http_code}" -X OPTIONS \
        -H "Origin: http://localhost:3000" \
        -H "Access-Control-Request-Method: GET" \
        "${API_URL}${endpoint}")
    
    status=$(echo "$response" | tail -n1)
    
    if [ "$status" -eq 200 ]; then
        echo -e "${GREEN}✓${NC} $description - CORS preflight OK"
    else
        echo -e "${RED}✗${NC} $description - CORS preflight failed"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi
}

echo -e "\nTesting API at: $API_URL"
echo "===================="
echo "Index Tests"
echo "===================="
# Test Index endpoints
test_cors "/" "Root endpoint CORS"
test_endpoint "/" 200 "Root endpoint"
test_cors "/invalid" "Invalid endpoint CORS"
test_endpoint "/invalid" 404 "Invalid endpoint"
echo "===================="
echo "HiroApiDO Tests"
echo "===================="
test_cors "/hiro-api" "Base endpoint CORS"
test_endpoint "/hiro-api" 200 "Base endpoint"
test_cors "/hiro-api/extended" "Extended info CORS"
test_endpoint "/hiro-api/extended" 200 "Extended info"
test_cors "/hiro-api/v2/info" "API info CORS"
test_endpoint "/hiro-api/v2/info" 200 "API info"
test_cors "/hiro-api/known-addresses" "Known addresses CORS"
test_endpoint "/hiro-api/known-addresses" 200 "Known addresses"
# Test each address for Hiro API
for address in "${TEST_ADDRESSES[@]}"; do
    test_cors "/hiro-api/extended/v1/address/${address}/balances" "Address balances CORS for ${address}"
    test_endpoint "/hiro-api/extended/v1/address/${address}/balances" 200 "Address balances for ${address}"
    test_cors "/hiro-api/extended/v1/address/${address}/assets" "Address assets CORS for ${address}"
    test_endpoint "/hiro-api/extended/v1/address/${address}/assets" 200 "Address assets for ${address}"
done
test_cors "/hiro-api/invalid" "Invalid endpoint CORS"
test_endpoint "/hiro-api/invalid" 404 "Invalid endpoint"
echo "===================="
echo "StxCityDO Tests"
echo "===================="
test_cors "/stx-city" "Base endpoint CORS"
test_endpoint "/stx-city" 200 "Base endpoint"
test_cors "/stx-city/tokens/tradable-full-details-tokens" "Token details CORS"
test_endpoint "/stx-city/tokens/tradable-full-details-tokens" 200 "Token details"
test_cors "/stx-city/invalid" "Invalid endpoint CORS"
test_endpoint "/stx-city/invalid" 404 "Invalid endpoint"
echo "===================="
echo "SupabaseDO Tests"
echo "===================="
test_cors "/supabase" "Base endpoint CORS"
test_endpoint "/supabase" 200 "Base endpoint"
test_cors "/supabase/stats" "Stats endpoint CORS"
test_endpoint "/supabase/stats" 200 "Stats endpoint"
test_cors "/supabase/invalid" "Invalid endpoint CORS"
test_endpoint "/supabase/invalid" 404 "Invalid endpoint"
echo "===================="
echo "BnsApiDO Tests"
echo "===================="
test_cors "/bns" "Base endpoint CORS"
test_endpoint "/bns" 200 "Base endpoint"
# Test each address for BNS
for address in "${TEST_ADDRESSES[@]}"; do
    test_cors "/bns/names/$address" "Names lookup CORS for $address"
    test_endpoint "/bns/names/$address" 200 "Names lookup for $address"
done
test_cors "/bns/invalid" "Invalid endpoint CORS"
test_endpoint "/bns/invalid" 404 "Invalid endpoint"
echo "===================="
echo "Test Summary"
echo "===================="
echo "Passed tests: $((TOTAL_TESTS - FAILED_TESTS))"
echo "Failed tests: $FAILED_TESTS"
echo "Total tests: $TOTAL_TESTS"

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed!${NC}"
    exit 1
fi
