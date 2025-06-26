import { Shader } from "./shader";

export const Texture = (function () {
  Texture.fromElement = function (element) {
    var texture = new Texture(0, 0, window.gl.RGBA, window.gl.UNSIGNED_BYTE);
    texture.loadContentsOf(element);
    return texture;
  };

  function Texture(width, height, format, type) {
    this.gl = window.gl;
    this.id = window.gl.createTexture();
    this.width = width;
    this.height = height;
    this.format = format;
    this.type = type;

    window.gl.bindTexture(window.gl.TEXTURE_2D, this.id);
    window.gl.texParameteri(
      window.gl.TEXTURE_2D,
      window.gl.TEXTURE_MAG_FILTER,
      window.gl.LINEAR,
    );
    window.gl.texParameteri(
      window.gl.TEXTURE_2D,
      window.gl.TEXTURE_MIN_FILTER,
      window.gl.LINEAR,
    );
    window.gl.texParameteri(
      window.gl.TEXTURE_2D,
      window.gl.TEXTURE_WRAP_S,
      window.gl.CLAMP_TO_EDGE,
    );
    window.gl.texParameteri(
      window.gl.TEXTURE_2D,
      window.gl.TEXTURE_WRAP_T,
      window.gl.CLAMP_TO_EDGE,
    );
    if (width && height)
      window.gl.texImage2D(
        window.gl.TEXTURE_2D,
        0,
        this.format,
        width,
        height,
        0,
        this.format,
        this.type,
        null,
      );
  }

  Texture.prototype.loadContentsOf = function (element) {
    // JAH: videoX has precedence
    // this.width = element.width || element.videoWidth;
    // this.height = element.height || element.videoHeight;
    this.width = element.videoWidth || element.width;
    this.height = element.videoHeight || element.height;
    window.gl.bindTexture(window.gl.TEXTURE_2D, this.id);
    window.gl.texImage2D(
      window.gl.TEXTURE_2D,
      0,
      this.format,
      this.format,
      this.type,
      element,
    );
  };

  Texture.prototype.initFromBytes = function (width, height, data) {
    this.width = width;
    this.height = height;
    this.format = window.gl.RGBA;
    this.type = window.gl.UNSIGNED_BYTE;
    window.gl.bindTexture(window.gl.TEXTURE_2D, this.id);
    window.gl.texImage2D(
      window.gl.TEXTURE_2D,
      0,
      window.gl.RGBA,
      width,
      height,
      0,
      window.gl.RGBA,
      this.type,
      new Uint8Array(data),
    );
  };

  Texture.prototype.destroy = function () {
    window.gl.deleteTexture(this.id);
    this.id = null;
  };

  Texture.prototype.use = function (unit) {
    window.gl.activeTexture(window.gl.TEXTURE0 + (unit || 0));
    window.gl.bindTexture(window.gl.TEXTURE_2D, this.id);
  };

  Texture.prototype.unuse = function (unit) {
    window.gl.activeTexture(window.gl.TEXTURE0 + (unit || 0));
    window.gl.bindTexture(window.gl.TEXTURE_2D, null);
  };

  Texture.prototype.ensureFormat = function (width, height, format, type) {
    // allow passing an existing texture instead of individual arguments
    if (arguments.length == 1) {
      var texture = arguments[0];
      width = texture.width;
      height = texture.height;
      format = texture.format;
      type = texture.type;
    }

    // change the format only if required
    if (
      width != this.width ||
      height != this.height ||
      format != this.format ||
      type != this.type
    ) {
      this.width = width;
      this.height = height;
      this.format = format;
      this.type = type;
      window.gl.bindTexture(window.gl.TEXTURE_2D, this.id);
      window.gl.texImage2D(
        window.gl.TEXTURE_2D,
        0,
        this.format,
        width,
        height,
        0,
        this.format,
        this.type,
        null,
      );
    }
  };

  Texture.prototype.drawTo = function (callback) {
    // start rendering to this texture
    window.gl.framebuffer =
      window.gl.framebuffer || window.gl.createFramebuffer();
    window.gl.bindFramebuffer(window.gl.FRAMEBUFFER, window.gl.framebuffer);
    window.gl.framebufferTexture2D(
      window.gl.FRAMEBUFFER,
      window.gl.COLOR_ATTACHMENT0,
      window.gl.TEXTURE_2D,
      this.id,
      0,
    );
    if (
      window.gl.checkFramebufferStatus(window.gl.FRAMEBUFFER) !==
      window.gl.FRAMEBUFFER_COMPLETE
    ) {
      throw new Error("incomplete framebuffer");
    }
    window.gl.viewport(0, 0, this.width, this.height);

    // do the drawing
    callback();

    // stop rendering to this texture
    window.gl.bindFramebuffer(window.gl.FRAMEBUFFER, null);
  };

  var canvas = null;

  function getCanvas(texture) {
    if (canvas == null) canvas = document.createElement("canvas");
    canvas.width = texture.width;
    canvas.height = texture.height;
    var c = canvas.getContext("2d");
    c.clearRect(0, 0, canvas.width, canvas.height);
    return c;
  }

  Texture.prototype.fillUsingCanvas = function (callback) {
    callback(getCanvas(this));
    this.format = window.gl.RGBA;
    this.type = window.gl.UNSIGNED_BYTE;
    window.gl.bindTexture(window.gl.TEXTURE_2D, this.id);
    window.gl.texImage2D(
      window.gl.TEXTURE_2D,
      0,
      window.gl.RGBA,
      window.gl.RGBA,
      window.gl.UNSIGNED_BYTE,
      canvas,
    );
    return this;
  };

  Texture.prototype.toImage = function (image) {
    this.use();
    Shader.getDefaultShader().drawRect();
    var size = this.width * this.height * 4;
    var pixels = new Uint8Array(size);
    var c = getCanvas(this);
    var data = c.createImageData(this.width, this.height);
    window.gl.readPixels(
      0,
      0,
      this.width,
      this.height,
      window.gl.RGBA,
      window.gl.UNSIGNED_BYTE,
      pixels,
    );
    for (var i = 0; i < size; i++) {
      data.data[i] = pixels[i];
    }
    c.putImageData(data, 0, 0);
    image.src = canvas.toDataURL();
  };

  Texture.prototype.swapWith = function (other) {
    var temp;
    temp = other.id;
    other.id = this.id;
    this.id = temp;
    temp = other.width;
    other.width = this.width;
    this.width = temp;
    temp = other.height;
    other.height = this.height;
    this.height = temp;
    temp = other.format;
    other.format = this.format;
    this.format = temp;
  };

  return Texture;
})();
