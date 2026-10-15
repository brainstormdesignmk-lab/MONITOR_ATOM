#!/bin/sh

echo
echo "======================================"
echo " METROPOLIS ATOM6 MONITOR"
echo "======================================"
echo
echo "Local health:"
curl --connect-timeout 2 --max-time 5 -s http://127.0.0.1:8500/health
echo
echo
echo "Cluster status:"
curl --connect-timeout 2 --max-time 5 -s http://127.0.0.1:8500/status
echo
echo "Service process:"
sudo service metropolis-monitor status
echo
