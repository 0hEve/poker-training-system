// glibc's reentrant drand48 family for macOS, force-included when building
// external/slumbot2019 (`-include native/compat/drand48_r.h`). Each struct keeps
// its own 48-bit state, so threads never share a generator, as on glibc.
#pragma once
#ifdef __APPLE__
#include <stdlib.h>
#include <string.h>

struct drand48_data {
  unsigned short x[3];
};

static inline int srand48_r(long seed, struct drand48_data *b) {
  b->x[0] = 0x330E;
  b->x[1] = (unsigned short)(seed & 0xFFFF);
  b->x[2] = (unsigned short)((seed >> 16) & 0xFFFF);
  return 0;
}

static inline int drand48_r(struct drand48_data *b, double *out) {
  *out = erand48(b->x);
  return 0;
}
#endif
