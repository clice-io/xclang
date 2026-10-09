# cmake -DPROGRAM=<program> -DARGUMENT=<argument> -P trap.cmake: the program
# ends by a trap (a signal, or on Windows an exception), not by an exit
# code.
execute_process(COMMAND "${PROGRAM}" "${ARGUMENT}" RESULT_VARIABLE result OUTPUT_VARIABLE output ERROR_VARIABLE output)
message("${output}")
if(result MATCHES "^[0-9]+$" AND result LESS 256)
    message(FATAL_ERROR "${PROGRAM} ${ARGUMENT} exited with ${result} instead of a trap")
endif()
message("${PROGRAM} ${ARGUMENT}: ${result}")
