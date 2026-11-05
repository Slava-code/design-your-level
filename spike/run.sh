#!/bin/sh
# Wrapper: node type stripping + react-server condition (so "server-only" resolves to its empty stub).
cd "$(dirname "$0")/.." && exec node --conditions=react-server --disable-warning=MODULE_TYPELESS_PACKAGE_JSON spike/run.mts "$@"
