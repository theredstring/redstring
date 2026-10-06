#!/bin/sh
# Where training keeps what is large: model weights, checkpoints, the Hugging
# Face cache and the Python environment (models/, checkpoints/ and .venv here
# are links into it). On Grant's external SSD, inside an APFS disk image: the
# SSD is exFAT, whose 1 MB blocks and "._" sidecar files make a Python
# environment or a model cache of many small files unusable directly on it.
# Sourced by sft_mlx.sh; source it before grpo.py or a pip install.
IMAGE="/Volumes/Grant's SSD/Redstring Training/redstring-training.sparsebundle"
if [ ! -d "/Volumes/Redstring Training" ] && [ -d "$IMAGE" ]; then
  hdiutil attach "$IMAGE" -nobrowse >/dev/null || echo "could not open the training disk image: $IMAGE" >&2
fi
DRUID_TRAIN_HOME="${DRUID_TRAIN_HOME:-/Volumes/Redstring Training}"
if [ ! -d "$DRUID_TRAIN_HOME" ]; then
  echo "The training disk is not there ($DRUID_TRAIN_HOME): plug in the SSD, or set DRUID_TRAIN_HOME." >&2
fi
export DRUID_TRAIN_HOME
export HF_HOME="$DRUID_TRAIN_HOME/hf-cache"
export PIP_CACHE_DIR="$DRUID_TRAIN_HOME/pip-cache"
