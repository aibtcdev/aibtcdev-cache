#!/bin/bash

# Set default API URL and sleep flag from arguments
export API_URL=${1:-"http://localhost:8787"}
export SLEEP_BEFORE_START=${2:-false}
export FAILED_TESTS=0
export TOTAL_TESTS=0

# Source all test files
SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/utils.sh"
source "$SCRIPT_DIR/test_index.sh"
source "$SCRIPT_DIR/test_hiro_api.sh"
source "$SCRIPT_DIR/test_stx_city.sh"
source "$SCRIPT_DIR/test_supabase.sh"
source "$SCRIPT_DIR/test_bns.sh"
source "$SCRIPT_DIR/test_contract_calls.sh"

# If sleep flag is true, wait 10 seconds before starting tests
if [ "$SLEEP_BEFORE_START" = true ]; then
    echo "Waiting 10 seconds for deployment to stabilize..."
    sleep 10
fi

echo -e "\nTesting API at: $API_URL"

# Run all test suites
test_index
#test_hiro_api (deprecated)
#test_stx_city (deprecated)
#test_supabase (deprecated)
#test_bns (deprecated)
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
