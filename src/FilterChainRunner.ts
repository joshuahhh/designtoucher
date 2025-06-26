import { FilterChain, filterSpecByName, FilterUse, Value } from "./filters.js";
import * as glfx from "./glfx/lib.js";
import { GlfxCanvas, GlfxTexture } from "./glfx/lib.js";

// A FilterChain is the "spec of" / "code for" a filter chain. It gets serialized.
// A FilterChainRunner actually runs it. It also maintains runtime state so that a FilterChain can be run efficiently.

export type Result =
  | Value
  | {
      type: "error";
      message: string;
    }
  | {
      type: "unrun";
    };

export default class FilterChainRunner {
  filterChain: FilterChain = [];

  _glfxResourcesById: { [filterId: string]: GlfxResources } = {};

  run(input: Value): RunnerResults {
    console.log("running filter chain", this.filterChain);
    let value: Value | null = input;
    let intermediate: { [filterId: string]: Result } = {};
    for (const filterUse of this.filterChain) {
      if (!value) {
        intermediate[filterUse.id] = { type: "unrun" };
        continue;
      }
      const result = this.applyFilter(filterUse, value);
      intermediate[filterUse.id] = result;
      if (result.type === "error") {
        value = null;
      } else {
        value = result;
      }
    }
    return { intermediate, final: value };
  }

  applyFilter(
    filterUse: FilterUse,
    value: Value,
  ): Exclude<Result, { type: "unrun" }> {
    const filterSpec = filterSpecByName(filterUse.specName);
    // if (filterSpec.inputType !== value.type) {
    //     // TODO: better error handling; mark future filters as invalid or something
    //     throw new Error('mismatch input type')
    // }

    const parameterValues = { ...filterUse.parameterValues };
    for (const parameter of filterSpec.parameters) {
      if (!(parameter.name in parameterValues)) {
        parameterValues[parameter.name] = parameter.default;
      }
    }

    try {
      if (filterSpec.operation.type === "value") {
        value = filterSpec.operation.apply(value, parameterValues);
      } else {
        if (value.type !== "image") {
          throw new Error(`needs image input, not ${value.type}`);
        }

        const glfxResources = this.updateGlfxResources(
          filterUse.id,
          value.source,
        );
        glfxResources.canvas.draw(glfxResources.texture);
        filterSpec.operation.apply(glfxResources.canvas, parameterValues);
        glfxResources.canvas.update();
        value = { type: "image", source: glfxResources.canvas };
      }
      return value;
    } catch (e) {
      let message: string;
      if (e instanceof Error) {
        message = e.message;
      } else {
        message = "unknown error; logging";
        console.error(e);
      }
      return { type: "error", message };
    }
  }

  updateGlfxResources(
    filterUseId: string,
    textureSource: HTMLVideoElement | HTMLCanvasElement,
  ): GlfxResources {
    // set to "false" means we always create new resources; a way to
    // test how important persistence / keys are
    let glfxResources = true ? this._glfxResourcesById[filterUseId] : undefined;
    if (!glfxResources) {
      const canvas = glfx.canvas();
      const texture = canvas.texture(textureSource);
      glfxResources = { canvas, texture };
      this._glfxResourcesById[filterUseId] = glfxResources;
    } else {
      try {
        glfxResources.texture.loadContentsOf(textureSource);
      } catch {
        console.warn("trouble loading texture; let's try again");
        glfxResources.texture.destroy();
        delete this._glfxResourcesById[filterUseId];
        return this.updateGlfxResources(filterUseId, textureSource);
      }
    }
    return glfxResources;
  }

  // getGlfxResources(filterUseId: string): GlfxResources | undefined {
  //     return this._glfxResourcesById[filterUseId];
  // }
}

interface GlfxResources {
  canvas: GlfxCanvas;
  texture: GlfxTexture;
}

export interface RunnerResults {
  intermediate: { [filterId: string]: Result };
  final: Value | null;
}
