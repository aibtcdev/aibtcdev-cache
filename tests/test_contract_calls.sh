#!/bin/bash

source "$(dirname "$0")/utils.sh"

test_contract_calls() {
    echo "===================="
    echo "ContractCallsDO Tests"
    echo "===================="
    test_cors "/contract-calls" "Base endpoint CORS"
    test_endpoint "/contract-calls" 200 "Base endpoint"
    test_cors "/contract-calls/known-contracts" "Known contracts CORS"
    test_endpoint "/contract-calls/known-contracts" 200 "Known contracts"
    
    # Test ABI endpoint with a known contract
    test_cors "/contract-calls/abi/SP000000000000000000002Q6VF78/pox" "Contract ABI CORS"
    test_endpoint "/contract-calls/abi/SP000000000000000000002Q6VF78/pox" 200 "Contract ABI"
    
    # Test invalid endpoints
    test_cors "/contract-calls/invalid" "Invalid endpoint CORS"
    test_endpoint "/contract-calls/invalid" 404 "Invalid endpoint"
}
