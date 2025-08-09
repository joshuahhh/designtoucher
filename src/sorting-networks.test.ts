import { expect, test } from "vitest";
import {
  medianNetworkFromSortingNetwork,
  Network,
  network31,
  oddEvenNetwork,
  parberryPairwiseNetwork,
  subNetwork,
} from "./sorting-networks.js";

function runNetwork(network: Network, input: number[]) {
  if (network.n !== input.length) {
    throw new Error(
      `Network size ${network.n} does not match input size ${input.length}`,
    );
  }

  const output = [...input];
  for (const [a, b] of network.comps) {
    if (output[a] > output[b]) {
      [output[a], output[b]] = [output[b], output[a]];
    }
  }
  return output;
}

function expectSortingNetworkToWork(network: Network, tests: number = 100) {
  for (let i = 1; i <= tests; i++) {
    const input = Array.from({ length: network.n }, (_) => Math.random());
    const output = runNetwork(network, input);
    expect(output).toEqual(output.slice().sort((a, b) => a - b));
  }
}

function expectMedianNetworkToWork(network: Network, tests: number = 100) {
  const medianIndex = Math.floor(network.n / 2);
  for (let i = 1; i <= tests; i++) {
    const input = Array.from({ length: network.n }, (_) => Math.random());
    const output = runNetwork(network, input);
    expect(output[medianIndex]).toEqual(
      input.slice().sort((a, b) => a - b)[medianIndex],
    );
  }
}

test("network31 & subs", () => {
  for (let n = 1; n <= 31; n++) {
    expectSortingNetworkToWork(subNetwork(network31, n), n);
  }
});

test("network31 & subs for median", () => {
  for (let n = 1; n <= 31; n += 2) {
    expectMedianNetworkToWork(
      medianNetworkFromSortingNetwork(subNetwork(network31, n)),
      n,
    );
  }
});

test("parberryPairwiseNetwork", () => {
  for (let n = 1; n <= 31; n++) {
    const network = parberryPairwiseNetwork(n);
    expectSortingNetworkToWork(network, n);
  }
});

test("oddEvenNetwork", () => {
  for (let n = 1; n <= 31; n++) {
    const network = oddEvenNetwork(n);
    expectSortingNetworkToWork(network, n);
  }
});

// examine sorting network sizes
if (false) {
  for (let n = 1; n <= 71; n += 2) {
    console.log(
      n,
      n <= 31 ? subNetwork(network31, n).comps.length : "n/a",
      parberryPairwiseNetwork(n).comps.length,
      oddEvenNetwork(n).comps.length,
    );
  }
}

// examine median network sizes
if (false) {
  for (let n = 1; n <= 71; n += 2) {
    console.log(
      n,
      n <= 31
        ? medianNetworkFromSortingNetwork(subNetwork(network31, n)).comps.length
        : "n/a",
      medianNetworkFromSortingNetwork(parberryPairwiseNetwork(n)).comps.length,
      medianNetworkFromSortingNetwork(oddEvenNetwork(n)).comps.length,
    );
  }
}
