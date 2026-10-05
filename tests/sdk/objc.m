#import <Foundation/Foundation.h>

int main(void) {
  @autoreleasepool {
    NSArray<NSString *> *words = @[ @"hello", @"Foundation" ];
    NSString *s = [words componentsJoinedByString:@", "];
    NSUInteger (^count)(NSString *) = ^(NSString *x) { return x.length; };
    @try {
      [NSException raise:@"Probe" format:@"thrown %d", 1];
    } @catch (NSException *e) {
      printf("caught: %s\n", e.reason.UTF8String);
    }
    printf("%s (%lu), %s\n", s.UTF8String, (unsigned long)count(s),
           NSProcessInfo.processInfo.operatingSystemVersionString.UTF8String);
  }
  return 0;
}
