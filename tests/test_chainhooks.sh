#!/bin/bash

# Set default API URL from argument if provided
export API_URL=${1:-"http://localhost:8787"}

source "$(dirname "$0")/utils.sh"

test_chainhooks() {
    echo "===================="
    echo "ChainhooksDO Tests"
    echo "===================="
    
    # Test base endpoint
    test_cors "/chainhooks" "Base endpoint CORS"
    test_endpoint "/chainhooks" 200 "Base endpoint"
    
    # Test events endpoint (GET all events)
    test_cors "/chainhooks/events" "Events endpoint CORS"
    test_endpoint "/chainhooks/events" 200 "Get all events"
    
    # Test post-event endpoint without auth (should fail with 401)
    echo "Testing post-event without auth (should fail)..."
    local post_url="${API_URL}/chainhooks/post-event"
    local payload='{"test":"data"}'
    
    # Test CORS for post-event endpoint
    test_cors "/chainhooks/post-event" "Post event CORS"
    
    # Test unauthorized post (should return 401)
    local unauth_response=$(curl -s -X POST -H "Content-Type: application/json" -d "$payload" "$post_url")
    local unauth_status=$(echo "$unauth_response" | jq -r '.success // false')
    
    if [ "$unauth_status" == "false" ]; then
        echo -e "${GREEN}✓${NC} Unauthorized post correctly rejected"
        ((TOTAL_TESTS++))
    else
        echo -e "${RED}✗${NC} Unauthorized post should have been rejected: $unauth_response"
        ((TOTAL_TESTS++))
        ((FAILED_TESTS++))
    fi
    
    # Test post-event with auth token (if available in environment)
    if [ -n "$CHAINHOOKS_AUTH_TOKEN" ]; then
        echo "Testing post-event with auth..."
        local auth_response=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $CHAINHOOKS_AUTH_TOKEN" -d "$payload" "$post_url")
        local auth_status=$(echo "$auth_response" | jq -r '.success // false')
        local event_id=$(echo "$auth_response" | jq -r '.data.eventId // ""')
        
        if [ "$auth_status" == "true" ] && [ -n "$event_id" ]; then
            echo -e "${GREEN}✓${NC} Authorized post successful"
            ((TOTAL_TESTS++))
            
            # Now test retrieving the specific event we just created
            echo "Testing get specific event..."
            test_endpoint "/chainhooks/events/$event_id" 200 "Get specific event"
        else
            echo -e "${RED}✗${NC} Authorized post failed: $auth_response"
            ((TOTAL_TESTS++))
            ((FAILED_TESTS++))
        fi
    else
        echo "Skipping authorized post test (CHAINHOOKS_AUTH_TOKEN not set)"
    fi
    
    # Test invalid event ID
    test_endpoint "/chainhooks/events/invalid-id" 404 "Invalid event ID"
    
    # Test invalid endpoints
    test_cors "/chainhooks/invalid" "Invalid endpoint CORS"
    test_endpoint "/chainhooks/invalid" 404 "Invalid endpoint"
}

# Allow running just this test file
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    export FAILED_TESTS=0
    export TOTAL_TESTS=0
    
    echo -e "\nTesting Chainhooks API at: $API_URL"
    test_chainhooks
    
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
fi
