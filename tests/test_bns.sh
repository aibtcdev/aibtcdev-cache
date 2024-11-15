#!/bin/bash

source "$(dirname "$0")/test_utils.sh"

test_bns() {
    echo "===================="
    echo "BnsApiDO Tests"
    echo "===================="
    test_cors "/bns" "Base endpoint CORS"
    test_endpoint "/bns" 200 "Base endpoint"
    
    for address in "${TEST_ADDRESSES[@]}"; do
        test_cors "/bns/names/$address" "Names lookup CORS for $address"
        test_endpoint "/bns/names/$address" 200 "Names lookup for $address"
    done
    
    test_cors "/bns/invalid" "Invalid endpoint CORS"
    test_endpoint "/bns/invalid" 404 "Invalid endpoint"
}
