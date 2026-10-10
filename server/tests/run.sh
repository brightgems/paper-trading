#!/bin/bash
cd "$(dirname "$0")/.."
node --test tests/api.test.js
