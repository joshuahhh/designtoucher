/*****************/
/* GENERAL STUFF */
/*****************/

export type Network = {
  n: number;
  comps: [number, number][];
};

/**
 * Given a sorting network and a list of outputs, filter the network
 * to only the comparators that affect the specified outputs.
 */
function filterOutputs(network: Network, outputSet: Set<number>): Network {
  // iterate backwards through the network
  let filteredNetwork: Network = {
    n: network.n,
    comps: [],
  };
  for (let i = network.comps.length - 1; i >= 0; i--) {
    const [a, b] = network.comps[i];
    if (outputSet.has(a) || outputSet.has(b)) {
      filteredNetwork.comps.unshift([a, b]);
      outputSet.add(a);
      outputSet.add(b);
    }
  }
  return filteredNetwork;
}

/**
 * Restrict a sorting network to only the first n elements.
 */
export function subNetwork(network: Network, n: number): Network {
  if (n < 1 || n > network.n) {
    throw new Error(`n must be between 1 and ${network.n}`);
  }
  return {
    n,
    comps: network.comps.filter(([a, b]) => a < n && b < n),
  };
}

export function medianNetworkFromSortingNetwork(network: Network): Network {
  if (network.n % 2 !== 1) {
    throw new Error("n must be odd");
  }

  return filterOutputs(network, new Set([Math.floor(network.n / 2)]));
}

/********************/
/* GENERAL NETWORKS */
/********************/

// adapted from https://github.com/Gaming32/ArrayV/blob/74f6ada530f0ed0ae38fe95db40ebf971a19167c/src/main/java/io/github/arrayv/sorts/concurrent/PairwiseSortIterative.java
export function parberryPairwiseNetwork(n: number): Network {
  const comps: [number, number][] = [];

  let a = 1;
  while (a < n) {
    let b = a;
    let c = 0;
    while (b < n) {
      const i = b - a,
        j = b;
      comps.push([i, j]);
      c = (c + 1) % a;
      b++;
      if (c === 0) b += a;
    }
    a *= 2;
  }

  a = Math.floor(a / 4);
  let e = 1;
  while (a > 0) {
    let d = e;
    while (d > 0) {
      let b = (d + 1) * a;
      let c = 0;
      while (b < n) {
        const i = b - d * a,
          j = b;
        comps.push([i, j]);
        c = (c + 1) % a;
        b++;
        if (c === 0) b += a;
      }
      d = Math.floor(d / 2);
    }
    a = Math.floor(a / 2);
    e = e * 2 + 1;
  }

  return { n, comps };
}

// adapted from https://github.com/Gaming32/ArrayV/blob/74f6ada530f0ed0ae38fe95db40ebf971a19167c/src/main/java/io/github/arrayv/sorts/concurrent/PairwiseSortIterative.java
export function oddEvenNetwork(n: number): Network {
  const comps: [number, number][] = [];

  for (let p = 1; p < n; p += p)
    for (let k = p; k > 0; k = Math.floor(k / 2))
      for (let j = k % p; j + k < n; j += k + k)
        for (let i = 0; i < k; i++)
          if (
            Math.floor((i + j) / (p + p)) === Math.floor((i + j + k) / (p + p))
          )
            if (i + j + k < n) comps.push([i + j, i + j + k]);

  return { n, comps };
}

/**************************/
/* OPTIMAL NETWORK FOR 31 */
/**************************/

// flattened version of https://bertdobbelaere.github.io/sorting_networks.html#N31L180D14
export const network31: Network = {
  n: 31,
  comps: [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [8, 9],
    [10, 11],
    [12, 13],
    [14, 15],
    [16, 17],
    [18, 19],
    [20, 21],
    [22, 23],
    [24, 25],
    [26, 27],
    [28, 29],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [8, 10],
    [9, 11],
    [12, 14],
    [13, 15],
    [16, 18],
    [17, 19],
    [20, 22],
    [21, 23],
    [24, 26],
    [25, 27],
    [28, 30],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
    [8, 12],
    [9, 13],
    [10, 14],
    [11, 15],
    [16, 20],
    [17, 21],
    [18, 22],
    [19, 23],
    [24, 28],
    [25, 29],
    [26, 30],
    [0, 8],
    [1, 9],
    [2, 10],
    [3, 11],
    [4, 12],
    [5, 13],
    [6, 14],
    [7, 15],
    [16, 24],
    [17, 25],
    [18, 26],
    [19, 27],
    [20, 28],
    [21, 29],
    [22, 30],
    [0, 16],
    [1, 8],
    [2, 4],
    [3, 12],
    [5, 10],
    [6, 9],
    [7, 14],
    [11, 13],
    [17, 24],
    [18, 20],
    [19, 28],
    [21, 26],
    [22, 25],
    [23, 30],
    [27, 29],
    [1, 2],
    [3, 5],
    [4, 8],
    [6, 22],
    [7, 11],
    [9, 25],
    [10, 12],
    [13, 14],
    [17, 18],
    [19, 21],
    [20, 24],
    [23, 27],
    [26, 28],
    [29, 30],
    [1, 17],
    [2, 18],
    [3, 19],
    [4, 20],
    [5, 10],
    [7, 23],
    [8, 24],
    [11, 27],
    [12, 28],
    [13, 29],
    [14, 30],
    [21, 26],
    [3, 17],
    [4, 16],
    [5, 21],
    [6, 18],
    [7, 9],
    [8, 20],
    [10, 26],
    [11, 23],
    [13, 25],
    [14, 28],
    [15, 27],
    [22, 24],
    [1, 4],
    [3, 8],
    [5, 16],
    [7, 17],
    [9, 21],
    [10, 22],
    [11, 19],
    [12, 20],
    [14, 24],
    [15, 26],
    [23, 28],
    [27, 30],
    [2, 5],
    [7, 8],
    [9, 18],
    [11, 17],
    [12, 16],
    [13, 22],
    [14, 20],
    [15, 19],
    [23, 24],
    [26, 29],
    [2, 4],
    [6, 12],
    [9, 16],
    [10, 11],
    [13, 17],
    [14, 18],
    [15, 22],
    [19, 25],
    [20, 21],
    [27, 29],
    [5, 6],
    [8, 12],
    [9, 10],
    [11, 13],
    [14, 16],
    [15, 17],
    [18, 20],
    [19, 23],
    [21, 22],
    [25, 26],
    [3, 5],
    [6, 7],
    [8, 9],
    [10, 12],
    [11, 14],
    [13, 16],
    [15, 18],
    [17, 20],
    [19, 21],
    [22, 23],
    [24, 25],
    [26, 28],
    [3, 4],
    [5, 6],
    [7, 8],
    [9, 10],
    [11, 12],
    [13, 14],
    [15, 16],
    [17, 18],
    [19, 20],
    [21, 22],
    [23, 24],
    [25, 26],
    [27, 28],
  ],
};
