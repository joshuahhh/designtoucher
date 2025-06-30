import jsfeat, { matrix_t } from "jsfeat";

(window as any).jsfeat = jsfeat;

class ColorPyr {
  Y: jsfeat.pyramid_t;
  U: jsfeat.pyramid_t;
  V: jsfeat.pyramid_t;

  constructor(
    public W: number,
    public H: number,
    public levels: number,
  ) {
    function init_pyr(): jsfeat.pyramid_t {
      var pyr = new jsfeat.pyramid_t(levels);
      pyr.allocate(W, H, jsfeat.F32_t | jsfeat.C1_t);
      return pyr;
    }

    this.Y = init_pyr();
    this.U = init_pyr();
    this.V = init_pyr();
  }

  pyrDown() {
    function downchan(chan: jsfeat.pyramid_t) {
      var i = 2,
        a = chan.data[0],
        b = chan.data[1];
      jsfeat.imgproc.pyrdown(a, b);
      for (; i < chan.levels; i++) {
        a = b;
        b = chan.data[i];
        jsfeat.imgproc.pyrdown(a, b);
        // jsfeat.imgproc.pyrup(b, img_ryp.data[i - 1])
      }
    }
    downchan(this.Y);
    downchan(this.U);
    downchan(this.V);
  }

  pyrUp(source: ColorPyr) {
    function upchan(chan: jsfeat.pyramid_t, schan: jsfeat.pyramid_t) {
      for (var i = 1; i < chan.levels; i++) {
        pyrup(schan.data[i], chan.data[i - 1]);
      }
    }
    upchan(this.Y, source.Y);
    upchan(this.U, source.U);
    upchan(this.V, source.V);
  }

  lpyrUp(source: ColorPyr) {
    function lchan(chan: jsfeat.pyramid_t, schan: jsfeat.pyramid_t) {
      var inner = chan.data[chan.levels - 2];
      for (var i = 0; i < inner.cols * inner.rows; i++) {
        inner.data[i] = 0;
      }

      for (var i = chan.levels - 1; i > 0; i--) {
        pyrup(chan.data[i], chan.data[i - 1]);
        imadd(chan.data[i - 1], schan.data[i - 1]);
      }
    }
    lchan(this.Y, source.Y);
    lchan(this.U, source.U);
    lchan(this.V, source.V);
  }

  lpyrDown(source: ColorPyr) {
    function lchan(chan: jsfeat.pyramid_t, schan: jsfeat.pyramid_t) {
      for (var i = 0; i < chan.levels - 1; i++) {
        imsub(schan.data[i], chan.data[i]);
      }
    }
    lchan(this.Y, source.Y);
    lchan(this.U, source.U);
    lchan(this.V, source.V);
  }

  iirFilter(source: ColorPyr, r: number) {
    function iir(chan: jsfeat.pyramid_t, schan: jsfeat.pyramid_t) {
      for (var i = 0; i < chan.levels - 1; i++) {
        var lpl = chan.data[i],
          pyl = schan.data[i];

        for (var j = 0; j < pyl.cols * pyl.rows; j++) {
          lpl.data[j] = (1 - r) * lpl.data[j] + r * pyl.data[j];
        }
      }
    }
    iir(this.Y, source.Y);
    iir(this.U, source.U);
    iir(this.V, source.V);
  }

  setSubtract(a: ColorPyr, b: ColorPyr) {
    function subp(
      chan: jsfeat.pyramid_t,
      chana: jsfeat.pyramid_t,
      chanb: jsfeat.pyramid_t,
    ) {
      for (var i = 0; i < b.levels; i++) {
        var al = chana.data[i],
          bl = chanb.data[i],
          cl = chan.data[i];
        for (var j = 0; j < al.cols * al.rows; j++) {
          cl.data[j] = al.data[j] - bl.data[j];
        }
      }
    }
    subp(this.Y, a.Y, b.Y);
    subp(this.U, a.U, b.U);
    subp(this.V, a.V, b.V);
  }

  fromRGBA(src: ImageData) {
    var w = src.width,
      h = src.height;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var r = src.data[(y * w + x) * 4],
          g = src.data[(y * w + x) * 4 + 1],
          b = src.data[(y * w + x) * 4 + 2];

        var Y = r * 0.299 + g * 0.587 + b * 0.114,
          U = r * -0.168736 + g * -0.331264 + b * 0.5 + 128,
          V = r * 0.5 + g * -0.418688 + b * -0.081312 + 128;

        this.Y.data[0].data[y * w + x] = Y;
        this.U.data[0].data[y * w + x] = U;
        this.V.data[0].data[y * w + x] = V;
      }
    }
  }

  toRGBA(dest: ImageData) {
    for (var i = 0; i < this.levels; i++) this.exportLayerRGB(i, dest);
  }

  exportLayer(layer: number, dest: ImageData) {
    var Yp = this.Y.data[layer].data,
      Up = this.U.data[layer].data,
      Vp = this.V.data[layer].data,
      Dd = dest.data;

    var w = this.Y.data[layer].cols,
      h = this.Y.data[layer].rows;

    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var Y = Yp[i],
          U = Up[i],
          V = Vp[i];
        var r = Y + 1.4075 * (V - 128),
          g = Y - 0.3455 * (U - 128) - 0.7169 * (V - 128),
          b = Y + 1.779 * (U - 128);

        var n = 4 * (y * dest.width + x);

        Dd[n] = r;
        Dd[n + 1] = g;
        Dd[n + 2] = b;
        Dd[n + 3] = 255;
      }
    }
  }

  exportLayerRGB(layer: number, dest: ImageData) {
    var Yp = this.Y.data[layer].data,
      Up = this.U.data[layer].data,
      Vp = this.V.data[layer].data,
      Dd = dest.data;

    var w = this.Y.data[layer].cols,
      h = this.Y.data[layer].rows;

    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var Y = Yp[i],
          U = Up[i],
          V = Vp[i];
        var n = 4 * (y * dest.width + x);
        Dd[n] = 127 + 10 * Y;
        Dd[n + 1] = 127 + 10 * U;
        Dd[n + 2] = 127 + 10 * V;
        Dd[n + 3] = 255;
      }
    }
  }

  mulLevel(n: number, c: number) {
    function mul(chan: jsfeat.pyramid_t) {
      var d = chan.data[n];
      for (var i = 0; i < d.cols * d.rows; i++) {
        d.data[i] *= c;
      }
    }
    mul(this.Y);
    mul(this.U);
    mul(this.V);
  }
}

function pyrup(src: matrix_t, dst: matrix_t) {
  var w = src.cols,
    h = src.rows;
  var w2 = w << 1,
    h2 = h << 1;
  var x = 0,
    y = 0;
  dst.resize(w2, h2, src.channel);
  var src_d = src.data,
    dst_d = dst.data;

  for (y = 0; y < h; ++y) {
    for (x = 0; x < w; ++x) {
      dst_d[(2 * y + 0) * w2 + (x * 2 + 0)] =
        dst_d[(2 * y + 1) * w2 + (x * 2 + 0)] =
        dst_d[(2 * y + 0) * w2 + (x * 2 + 1)] =
        dst_d[(2 * y + 1) * w2 + (x * 2 + 1)] =
          src_d[y * w + x];
    }
  }

  jsfeat.imgproc.gaussian_blur(dst, dst, 2);
}

function immul(
  n: number,
  chan: jsfeat.pyramid_t,
  schan: jsfeat.pyramid_t,
  c: number,
) {
  var d = chan.data[n],
    e = schan.data[n];

  for (var i = 0; i < d.cols * d.rows; i++) {
    d.data[i] = c * d.data[i] + e.data[i];
  }
}

function imadd(a: matrix_t, b: matrix_t) {
  var a_d = a.data,
    b_d = b.data;
  var w = a.cols,
    h = a.rows,
    n = w * h;
  for (var i = 0; i < n; ++i) {
    a_d[i] = a_d[i] + b_d[i];
  }
}

function imsub(a: matrix_t, b: matrix_t) {
  var a_d = a.data,
    b_d = b.data;
  var w = a.cols,
    h = a.rows,
    n = w * h;
  for (var i = 0; i < n; ++i) {
    b_d[i] = b_d[i] - a_d[i];
  }
}

export class Demo {
  img_pyr: ColorPyr;
  img_ryp: ColorPyr;
  lowpass1: ColorPyr;
  lowpass2: ColorPyr;
  filtered: ColorPyr;

  canvas: HTMLCanvasElement = document.createElement("canvas");
  savnac: HTMLCanvasElement = document.createElement("canvas");

  ctx: CanvasRenderingContext2D;
  xtc: CanvasRenderingContext2D;

  exaggeration_factor: number = 2;
  alpha: number = 10;
  lambda_c: number = 16;
  chromAttenuation: number = 1;
  r1: number = 0.4;
  r2: number = 0.05;

  constructor(
    public vidWidth: number,
    public vidHeight: number,
  ) {
    this.savnac.width = this.canvas.width = vidWidth;
    this.savnac.height = this.canvas.height = vidHeight;

    this.ctx = this.canvas.getContext("2d")!;
    this.xtc = this.savnac.getContext("2d")!;

    this.ctx.fillStyle = "rgb(0,255,0)";
    this.ctx.strokeStyle = "rgb(0,255,0)";

    var num_deep = 5;

    this.img_pyr = new ColorPyr(vidWidth, vidHeight, num_deep);
    this.img_ryp = new ColorPyr(vidWidth, vidHeight, num_deep);
    this.lowpass1 = new ColorPyr(vidWidth, vidHeight, num_deep);
    this.lowpass2 = new ColorPyr(vidWidth, vidHeight, num_deep);
    this.filtered = new ColorPyr(vidWidth, vidHeight, num_deep);
  }

  run() {
    var imageData = this.ctx.getImageData(0, 0, this.vidWidth, this.vidHeight);
    this.img_pyr.fromRGBA(imageData);
    console.log("img_pyr", this.img_pyr);

    this.img_pyr.pyrDown();
    this.img_ryp.pyrUp(this.img_pyr);
    this.img_pyr.lpyrDown(this.img_ryp);

    this.lowpass1.iirFilter(this.img_pyr, this.r1);
    this.lowpass2.iirFilter(this.img_pyr, this.r2);
    this.filtered.setSubtract(this.lowpass1, this.lowpass2);

    var delta = this.lambda_c / 8 / (1 + this.alpha);
    var lambda =
      Math.sqrt(
        this.vidHeight * this.vidHeight + this.vidWidth * this.vidWidth,
      ) / 3;

    // for(var n = filtered.levels - 1; n >= 0; n--){
    for (var n = 0; n < this.filtered.levels; n++) {
      var currAlpha = lambda / delta / 8 - 1;
      currAlpha *= this.exaggeration_factor;
      if (n <= 0 || n === this.filtered.levels - 1) {
        this.filtered.mulLevel(n, 0);
      } else if (currAlpha > this.alpha) {
        this.filtered.mulLevel(n, this.alpha);
      } else {
        this.filtered.mulLevel(n, currAlpha);
      }
      lambda = lambda / 2;
    }

    this.img_ryp.lpyrUp(this.filtered);

    var blah = this.ctx.createImageData(this.vidWidth, this.vidHeight);
    this.filtered.toRGBA(blah);
    this.xtc.putImageData(blah, 0, 0);

    var merp = this.ctx.createImageData(this.vidWidth, this.vidHeight);
    // img_ryp.toRGBA(merp)
    this.img_pyr.fromRGBA(imageData);
    // img_pyr.addLevel(0, img_ryp)
    immul(0, this.img_ryp.Y, this.img_pyr.Y, 1);
    immul(0, this.img_ryp.U, this.img_pyr.U, this.chromAttenuation);
    immul(0, this.img_ryp.V, this.img_pyr.V, this.chromAttenuation);

    this.img_ryp.exportLayer(0, merp);
    this.ctx.putImageData(merp, 0, 0);
  }
}
