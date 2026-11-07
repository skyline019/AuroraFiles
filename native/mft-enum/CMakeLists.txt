cmake_minimum_required(VERSION 3.20)
project(aurora-mft-enum LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(aurora-mft-enum
  src/main.cpp
  src/mft_enum.cpp
  src/path_rebuild.cpp
  src/usn_read.cpp
)

target_include_directories(aurora-mft-enum PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)

if(MSVC)
  target_compile_definitions(aurora-mft-enum PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
  target_compile_options(aurora-mft-enum PRIVATE /W3 /O2 /EHsc)
  target_link_libraries(aurora-mft-enum PRIVATE psapi)
endif()

install(TARGETS aurora-mft-enum RUNTIME DESTINATION bin)
