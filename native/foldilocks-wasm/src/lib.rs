//! y = W x + b for the Foldilocks network, 4-wide f32 SIMD (wasm simd128).
//! The JS side copies the weights into `ARENA` once and calls `linear` with offsets into it.
#![no_std]
use core::arch::wasm32::*;

/// Weights, biases and activations (floats). Zero-initialised, so it costs nothing in the binary.
static mut ARENA: [f32; 180_000] = [0.0; 180_000];

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

#[no_mangle]
pub extern "C" fn arena() -> *mut f32 {
    core::ptr::addr_of_mut!(ARENA) as *mut f32
}

/// Offsets are float indices into ARENA.
#[no_mangle]
pub unsafe extern "C" fn linear(w: usize, x: usize, b: usize, y: usize, out: usize, n: usize) {
    let base = arena();
    let xp = base.add(x) as *const f32;
    let n16 = n - n % 16;
    for o in 0..out {
        let row = base.add(w + o * n) as *const f32;
        let (mut a0, mut a1, mut a2, mut a3) = (f32x4_splat(0.0), f32x4_splat(0.0), f32x4_splat(0.0), f32x4_splat(0.0));
        let mut i = 0;
        while i < n16 {
            a0 = f32x4_add(a0, f32x4_mul(v128_load(row.add(i) as *const v128), v128_load(xp.add(i) as *const v128)));
            a1 = f32x4_add(a1, f32x4_mul(v128_load(row.add(i + 4) as *const v128), v128_load(xp.add(i + 4) as *const v128)));
            a2 = f32x4_add(a2, f32x4_mul(v128_load(row.add(i + 8) as *const v128), v128_load(xp.add(i + 8) as *const v128)));
            a3 = f32x4_add(a3, f32x4_mul(v128_load(row.add(i + 12) as *const v128), v128_load(xp.add(i + 12) as *const v128)));
            i += 16;
        }
        let acc = f32x4_add(f32x4_add(a0, a1), f32x4_add(a2, a3));
        let mut s = f32x4_extract_lane::<0>(acc) + f32x4_extract_lane::<1>(acc) + f32x4_extract_lane::<2>(acc) + f32x4_extract_lane::<3>(acc);
        while i < n {
            s += *row.add(i) * *xp.add(i);
            i += 1;
        }
        *base.add(y + o) = s + *base.add(b + o);
    }
}
