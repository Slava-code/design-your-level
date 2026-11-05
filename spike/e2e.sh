#!/bin/sh
cd "$(dirname "$0")/.." && exec node --conditions=react-server --disable-warning=MODULE_TYPELESS_PACKAGE_JSON spike/e2e.mts "$@"
