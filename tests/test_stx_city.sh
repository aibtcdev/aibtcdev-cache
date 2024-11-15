#!/bin/bash

source "$(dirname "$0")/utils.sh"

test_stx_city() {
    echo "===================="
    echo "StxCityDO Tests"
    echo "===================="
    test_cors "/stx-city" "Base endpoint CORS"
    test_endpoint "/stx-city" 200 "Base endpoint"
    test_cors "/stx-city/tokens/tradable-full-details-tokens" "Token details CORS"
    test_endpoint "/stx-city/tokens/tradable-full-details-tokens" 200 "Token details"
    test_cors "/stx-city/invalid" "Invalid endpoint CORS"
    test_endpoint "/stx-city/invalid" 404 "Invalid endpoint"
}
