#include <CoreFoundation/CoreFoundation.h>
#include <stdio.h>

int main(void) {
  CFMutableStringRef s = CFStringCreateMutable(NULL, 0);
  CFStringAppendCString(s, "hello, CoreFoundation", kCFStringEncodingUTF8);
  CFStringUppercase(s, NULL);
  CFArrayRef parts = CFStringCreateArrayBySeparatingStrings(NULL, s, CFSTR(", "));
  char buf[64];
  CFStringGetCString(s, buf, sizeof buf, kCFStringEncodingUTF8);
  printf("%s (%ld parts)\n", buf, (long)CFArrayGetCount(parts));
  CFRelease(parts);
  CFRelease(s);
  return 0;
}
