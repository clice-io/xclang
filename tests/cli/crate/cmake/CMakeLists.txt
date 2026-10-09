cmake_minimum_required(VERSION 3.20)
project(probe_cmake C)
add_library(probe_cmake STATIC probe_cmake.c)
install(TARGETS probe_cmake ARCHIVE DESTINATION lib)
