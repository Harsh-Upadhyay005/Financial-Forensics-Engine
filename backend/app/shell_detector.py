"""
shell_detector.py – Detect layered shell account networks.

Definition
----------
A shell chain is a directed path of length SHELL_MIN_CHAIN to SHELL_MAX_CHAIN
hops where ALL intermediate nodes (everything except source and destination)
have a total transaction count ≤ SHELL_MAX_TX. These low-activity "shell"
accounts are used purely as pass-through layers to obscure money origin.

Algorithm
---------
Iterative DFS from all non-shell source nodes into the shell subgraph.
Iterative (stack-based) instead of recursive to avoid Python stack limits
on deep graphs and to be safe with large datasets.

False-positive reduction
------------------------
• Source and destination must NOT themselves be shell nodes.
• Paths that revisit any node are skipped (set-based visited tracking).
• Hard cap MAX_SHELL_CHAINS prevents excessive output.
"""
from __future__ import annotations

import logging
from typing import List, Dict

import networkx as nx

from .config import SHELL_MAX_TX, SHELL_MIN_CHAIN, SHELL_MAX_CHAIN, MAX_SHELL_CHAINS

log = logging.getLogger(__name__)


def detect_shell_networks(G: nx.DiGraph) -> List[Dict]:
    """
    Detect layered shell-account chains.

    Returns
    -------
    List of ring dicts with keys:
        members               : list[str]  – full path [source, shell1, ..., dest]
        pattern               : "shell_chain"
        chain_length          : int        – number of hops
        shell_intermediaries  : list[str]  – the low-tx intermediate accounts
    """
    rings: List[Dict] = []
    seen_paths: set = set()
    chain_count = 0

    # Classify nodes
    shell_nodes: set = {
        n for n, d in G.nodes(data=True)
        if d.get("tx_count", 0) <= SHELL_MAX_TX
    }
    non_shell_nodes: set = set(G.nodes()) - shell_nodes

    log.info(
        "Shell detection: %d shell candidates / %d total nodes",
        len(shell_nodes),
        G.number_of_nodes(),
    )

    if not shell_nodes:
        return rings

    # Iterative DFS from non-shell sources
    for source in non_shell_nodes:
        if chain_count >= MAX_SHELL_CHAINS:
            log.warning("Shell chain cap (%d) reached.", MAX_SHELL_CHAINS)
            break

        # Stack elements: (current_node, path_so_far, visited_set)
        initial_neighbors = [
            nbr for nbr in G.successors(source) if nbr in shell_nodes
        ]
        if not initial_neighbors:
            continue

        stack = [
            ([source, nbr], {source, nbr})
            for nbr in initial_neighbors
        ]

        while stack and chain_count < MAX_SHELL_CHAINS:
            path, visited = stack.pop()
            current = path[-1]
            path_len = len(path)   # number of nodes = hops + 1
            n_hops = path_len - 1

            # Explore successors
            for nbr in G.successors(current):
                if nbr in visited:
                    continue

                new_path = path + [nbr]
                new_hops = n_hops + 1
                intermediaries = new_path[1:-1]  # everything between source and nbr

                if nbr not in shell_nodes:
                    # nbr is a non-shell destination – candidate chain endpoint
                    if (
                        new_hops >= SHELL_MIN_CHAIN
                        and all(n in shell_nodes for n in intermediaries)
                    ):
                        key = tuple(new_path)
                        if key not in seen_paths:
                            seen_paths.add(key)
                            rings.append({
                                "members": new_path,
                                "pattern": "shell_chain",
                                "chain_length": new_hops,
                                "shell_intermediaries": intermediaries,
                            })
                            chain_count += 1
                    # Do NOT continue extending past a non-shell destination
                else:
                    # Still inside shell territory – extend if within depth limit
                    if new_hops < SHELL_MAX_CHAIN:
                        stack.append((new_path, visited | {nbr}))

    log.info("Shell detection: %d chains found", len(rings))
    return rings
