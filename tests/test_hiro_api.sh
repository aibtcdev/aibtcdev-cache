#!/bin/bash

source "$(dirname "$0")/utils.sh"

test_hiro_api() {
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
    
    for address in "${TEST_ADDRESSES[@]}"; do
        test_cors "/hiro-api/extended/v1/address/${address}/balances" "Address balances CORS for ${address}"
        test_endpoint "/hiro-api/extended/v1/address/${address}/balances" 200 "Address balances for ${address}"
        test_cors "/hiro-api/extended/v1/address/${address}/assets" "Address assets CORS for ${address}"
        test_endpoint "/hiro-api/extended/v1/address/${address}/assets" 200 "Address assets for ${address}"
    done
    
    test_cors "/hiro-api/invalid" "Invalid endpoint CORS"
    test_endpoint "/hiro-api/invalid" 404 "Invalid endpoint"
}
