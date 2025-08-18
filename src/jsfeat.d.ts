declare module "jsfeat" {
  /**
   * `matrix_t` is quite flexible structure, it can be used as image
   * representation or regular matrix for mathematics.
   */
  export class matrix_t {
    cols: number;
    rows: number;
    data: number[];
    /** Number of channels */
    channel: number;

    /**
     * You can resize `matrix_t` at any time using `resize` method.
     * NOTE: this operation will delete current data array if new
     * size is larger.
     */
    resize(width: number, height: number, type: number): void;
  }

  export class pyramid_t {
    levels: number;
    data: matrix_t[];

    constructor(levels: number);

    allocate(width: number, height: number, type: number): void;
  }

  export const F32_t: number;
  export const C1_t: number;
  export const C3_t: number;
  export const C4_t: number;

  export module imgproc {
    /**
     * Downsample `source` to `dest` writing simple 4 pix average
     * value. Works with single channel only.
     */
    export function pyrdown(src: matrix_t, dst: matrix_t): void;

    /**
     * Works with single channel data only. You can choose between
     * providing kernel_size or sigma argument or both.
     */
    export function gaussian_blur(
      src: matrix_t,
      dst: matrix_t,
      kernel_size?: number,
      sigma?: number,
    ): void;
  }
}
