#!/bin/sh

echo
echo "======================================"
echo " METROPOLIS ATOM5 MONITOR"
echo "======================================"
echo
echo "Local health:"
curl -s http://127.0.0.1:8500/health
echo
echo
echo "Cluster status:"
curl -s http://127.0.0.1:8500/status
echo
