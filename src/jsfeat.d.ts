declare module "jsfeat" {
  export class matrix_t {
    cols: number;
    rows: number;
    data: number[];
    type: number;
    channel: number;

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
    export function pyrdown(src: matrix_t, dst: matrix_t): void;
    export function gaussian_blur(
      src: matrix_t,
      dst: matrix_t,
      sigma: number,
    ): void;
  }
}
