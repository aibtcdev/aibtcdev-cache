#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Check if URL argument is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <API_URL>"
    echo "Example: $0 http://localhost:8787"
    exit 1
fi

API_URL=$1
FAILED_TESTS=0
TOTAL_TESTS=0

# Test function
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
    
    # Check status code
    if [ "$status" -eq "$expected_status" ]; then
        echo -e "${GREEN}✓${NC} $description - Status: $status"
    else
        echo -e "${RED}✗${NC} $description - Expected status $expected_status, got $status"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi
    
    # Check CORS headers (case-insensitive)
    if ! echo "$headers" | grep -qi "access-control-allow-origin:"; then
        echo -e "${RED}✗${NC} Missing CORS headers for $endpoint"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi
    
    # Check content type (case-insensitive)
    if ! echo "$headers" | grep -qi "content-type:.*application/json"; then
        echo -e "${RED}✗${NC} Missing or incorrect Content-Type header for $endpoint"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi
    
    # Validate JSON response
    if ! echo "$body" | jq . >/dev/null 2>&1; then
        echo -e "${RED}✗${NC} Invalid JSON response for $endpoint"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi
    
    echo "----------------------------------------"
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
    
    echo "----------------------------------------"
}

echo -e "\nTesting API at: $API_URL"
echo -e "\n${GREEN}Index Tests${NC}"
echo "===================="

# Test Index endpoints
test_endpoint "/" 200 "Root endpoint"
test_cors "/" "Root endpoint CORS"
test_endpoint "/invalid" 404 "Invalid endpoint"
test_cors "/invalid" "Invalid endpoint CORS"

echo -e "\n${GREEN}HiroApiDO Tests${NC}"
echo "===================="
test_endpoint "/hiro-api" 200 "HiroApiDO - Base endpoint"
test_cors "/hiro-api" "HiroApiDO - Base endpoint CORS"
test_endpoint "/hiro-api/extended" 200 "HiroApiDO - Extended info"
test_cors "/hiro-api/extended" "HiroApiDO - Extended info CORS"
test_endpoint "/hiro-api/v2/info" 200 "HiroApiDO - API info"
test_cors "/hiro-api/v2/info" "HiroApiDO - API info CORS"
test_endpoint "/hiro-api/known-addresses" 200 "HiroApiDO - Known addresses"
test_cors "/hiro-api/known-addresses" "HiroApiDO - Known addresses CORS"
test_endpoint "/hiro-api/invalid" 404 "HiroApiDO - Invalid endpoint"
test_cors "/hiro-api/invalid" "HiroApiDO - Invalid endpoint CORS"

echo -e "\n${GREEN}SupabaseDO Tests${NC}"
echo "===================="
test_endpoint "/supabase" 200 "SupabaseDO - Base endpoint"
test_cors "/supabase" "SupabaseDO - Base endpoint CORS"
test_endpoint "/supabase/stats" 200 "SupabaseDO - Stats endpoint"
test_cors "/supabase/stats" "SupabaseDO - Stats endpoint CORS"
test_endpoint "/supabase/invalid" 404 "SupabaseDO - Invalid endpoint"
test_cors "/supabase/invalid" "SupabaseDO - Invalid endpoint CORS"

echo -e "\n${GREEN}Test Summary${NC}"
echo "===================="
echo "Total tests: $TOTAL_TESTS"
echo "Failed tests: $FAILED_TESTS"

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed!${NC}"
    exit 1
fi
