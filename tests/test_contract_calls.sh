#!/bin/bash

# Import common utilities
source "$(dirname "$0")/utils.sh"

# Set the base URL for the API
BASE_URL=${API_URL:-"http://localhost:8787"}
ENDPOINT="/contract-calls"

echo "Testing Contract Calls API at $BASE_URL$ENDPOINT"

# Test the root endpoint
echo -e "\n--- Testing root endpoint ---"
curl -s "$BASE_URL$ENDPOINT" | jq

# Test fetching ABI for a known contract
echo -e "\n--- Testing ABI endpoint ---"
curl -s "$BASE_URL$ENDPOINT/abi/SP000000000000000000002Q6VF78/pox-3" | jq

# Test known contracts endpoint
echo -e "\n--- Testing known contracts endpoint ---"
curl -s "$BASE_URL$ENDPOINT/known-contracts" | jq

# Test a read-only contract call
echo -e "\n--- Testing read-only contract call ---"
curl -s -X POST "$BASE_URL$ENDPOINT/read-only/SP000000000000000000002Q6VF78/pox-3/get-pox-info" \
  -H "Content-Type: application/json" \
  -d '{"functionArgs":[], "network":"mainnet", "senderAddress":"SP000000000000000000002Q6VF78"}' | jq

echo -e "\nTests completed!"
