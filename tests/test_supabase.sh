#!/bin/bash

source "$(dirname "$0")/utils.sh"

test_supabase() {
    echo "===================="
    echo "SupabaseDO Tests"
    echo "===================="
    test_cors "/supabase" "Base endpoint CORS"
    test_endpoint "/supabase" 200 "Base endpoint"
    test_cors "/supabase/stats" "Stats endpoint CORS"
    test_endpoint "/supabase/stats" 200 "Stats endpoint"
    test_cors "/supabase/invalid" "Invalid endpoint CORS"
    test_endpoint "/supabase/invalid" 404 "Invalid endpoint"
}
