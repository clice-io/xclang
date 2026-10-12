# cmake -DPROGRAM=<program> -DARGUMENT=<argument> -P report.cmake: what the
# program writes, however it ends (a sanitizer's report ends in an abort on
# macOS), for the test's PASS_REGULAR_EXPRESSION.
execute_process(COMMAND "${PROGRAM}" "${ARGUMENT}" RESULT_VARIABLE result OUTPUT_VARIABLE output ERROR_VARIABLE output)
message("${output}")
message("${PROGRAM} ${ARGUMENT}: ${result}")
