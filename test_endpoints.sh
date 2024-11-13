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
    
    # Make the request and capture headers and body
    response=$(curl -s -w "\n%{http_code}\n%{http_headers_curl}" -X GET "${API_URL}${endpoint}")
    
    # Parse response
    body=$(echo "$response" | sed -n '1p')
    status=$(echo "$response" | sed -n '2p')
    headers=$(echo "$response" | sed -n '3,$p')
    
    # Check status code
    if [ "$status" -eq "$expected_status" ]; then
        echo -e "${GREEN}✓${NC} $description - Status: $status"
    else
        echo -e "${RED}✗${NC} $description - Expected status $expected_status, got $status"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi
    
    # Check CORS headers
    if ! echo "$headers" | grep -q "access-control-allow-origin"; then
        echo -e "${RED}✗${NC} Missing CORS headers for $endpoint"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi
    
    # Check content type
    if ! echo "$headers" | grep -q "content-type: application/json"; then
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

echo "Testing API at: $API_URL"
echo "----------------------------------------"

# Test root endpoint
test_endpoint "/" 200 "Root endpoint"
test_cors "/" "Root endpoint CORS"

# Test Hiro API endpoint
test_endpoint "/hiro-api" 404 "Hiro API base endpoint"
test_cors "/hiro-api" "Hiro API CORS"

# Test Supabase endpoint
test_endpoint "/supabase" 404 "Supabase base endpoint"
test_cors "/supabase" "Supabase CORS"

# Test invalid endpoint
test_endpoint "/invalid" 404 "Invalid endpoint"
test_cors "/invalid" "Invalid endpoint CORS"

# Summary
echo "Test Summary:"
echo "Total tests: $TOTAL_TESTS"
echo "Failed tests: $FAILED_TESTS"

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed!${NC}"
    exit 1
fi
