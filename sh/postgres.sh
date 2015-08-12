#!/bin/bash

apt-get update -qq
apt-get install -qq -y \
	postgresql \
	postgresql-contrib
apt-get autoremove -y -qq