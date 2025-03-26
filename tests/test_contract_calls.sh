#!/bin/bash

source "$(dirname "$0")/utils.sh"

test_contract_calls() {
    echo "===================="
    echo "ContractCallsDO Tests"
    echo "===================="
    
    # Test base endpoint
    test_cors "/contract-calls" "Base endpoint CORS"
    test_endpoint "/contract-calls" 200 "Base endpoint"
    
    # Test known contracts endpoint
    test_cors "/contract-calls/known-contracts" "Known contracts CORS"
    test_endpoint "/contract-calls/known-contracts" 200 "Known contracts"
    
    # Test ABI endpoints with known contracts
    # Mainnet contract
    test_cors "/contract-calls/abi/SP000000000000000000002Q6VF78/pox-4" "Mainnet Contract ABI CORS"
    test_endpoint "/contract-calls/abi/SP000000000000000000002Q6VF78/pox-4" 200 "Mainnet Contract ABI"
    
    # Testnet contract
    test_cors "/contract-calls/abi/ST252TFQ08T74ZZ6XK426TQNV4EXF1D4RMTTNCWFA/media3-core-proposals-v2" "Testnet Contract ABI CORS"
    test_endpoint "/contract-calls/abi/ST252TFQ08T74ZZ6XK426TQNV4EXF1D4RMTTNCWFA/media3-core-proposals-v2" 200 "Testnet Contract ABI"
    
    # Test read-only function call endpoint
    # This requires a POST request with function arguments
    echo "Testing read-only function call..."
    local read_only_url="${API_URL}/contract-calls/read-only/SP000000000000000000002Q6VF78/pox-4/get-pox-info"
    local payload='{"functionArgs":[],"network":"mainnet"}'
    
    # Test CORS for read-only endpoint
    test_cors "/contract-calls/read-only/SP000000000000000000002Q6VF78/pox-4/get-pox-info" "Read-only function CORS"
    
    # Test actual function call
    local response=$(curl -s -X POST -H "Content-Type: application/json" -d "$payload" "$read_only_url")
    local status=$?
    
    if [ $status -eq 0 ] && [ "$(echo "$response" | jq -e 'has("data")' 2>/dev/null)" == "true" ]; then
        echo -e "${GREEN}✓${NC} Read-only function call successful"
        ((TOTAL_TESTS++))
    else
        echo -e "${RED}✗${NC} Read-only function call failed: $response"
        ((TOTAL_TESTS++))
        ((FAILED_TESTS++))
    fi
    
    # Test decode clarity value endpoint
    echo "Testing decode clarity value endpoint..."
    local decode_url="${API_URL}/contract-calls/decode-clarity-value"
    local decode_payload='{"clarityValue":{"type":"uint","value":"12"}}'
    
    # Test CORS for decode endpoint
    test_cors "/contract-calls/decode-clarity-value" "Decode clarity value CORS"
    
    # Test actual decode function
    local decode_response=$(curl -s -X POST -H "Content-Type: application/json" -d "$decode_payload" "$decode_url")
    local decode_status=$?
    
    if [ $decode_status -eq 0 ] && [ "$(echo "$decode_response" | jq -e 'has("decoded")' 2>/dev/null)" == "true" ]; then
        echo -e "${GREEN}✓${NC} Decode clarity value successful"
        ((TOTAL_TESTS++))
    else
        echo -e "${RED}✗${NC} Decode clarity value failed: $decode_response"
        ((TOTAL_TESTS++))
        ((FAILED_TESTS++))
    fi
    
    # Test invalid endpoints
    test_cors "/contract-calls/invalid" "Invalid endpoint CORS"
    test_endpoint "/contract-calls/invalid" 404 "Invalid endpoint"
}

# Allow running just this test file
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    # Set default API URL if not already set
    export API_URL=${API_URL:-"http://localhost:8787"}
    export FAILED_TESTS=0
    export TOTAL_TESTS=0
    
    source "$(dirname "$0")/utils.sh"
    
    echo -e "\nTesting Contract Calls API at: $API_URL"
    test_contract_calls
    
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
