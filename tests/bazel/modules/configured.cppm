module;

#if XCLANG_TEST_CONFIGURED != 1
#error "a dependency's defines do not reach this module unit"
#endif

export module configured;

export int configured() { return XCLANG_TEST_CONFIGURED; }
