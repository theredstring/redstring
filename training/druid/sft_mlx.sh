#!/bin/sh
# Teach the Druid's small model by example, on this Mac (Apple MLX): LoRA on
# the teacher's checked answers (prepare.py), loss on the answer only.
#
#   ROLE=druid sh training/druid/sft_mlx.sh     the Druid's adapter
#   ROLE=wizard sh training/druid/sft_mlx.sh    the wizard's (MODEL=… for another base)
#
# One base model, one adapter per role, each trained only on its own role's
# examples (prepare.py), so the roles cannot cross over.
#
# Then fuse it into a model LM Studio can load, and judge it with the
# benchmark (training/druid/README.md). Settings are a first guess for a ~4B
# model in 24 GB; check `.venv/bin/python -m mlx_lm lora --help` for the installed version's flags.
set -e
cd "$(dirname "$0")"
. ./env.sh
PY="${PY:-.venv/bin/python}"
MODEL="${MODEL:-Qwen/Qwen3-4B-Instruct-2507}"
ROLE="${ROLE:?ROLE=druid or ROLE=wizard}"
RUN="${RUN:-checkpoints/$ROLE-sft-$(date +%Y%m%d-%H%M)}"
mkdir -p "$RUN"

"$PY" -m mlx_lm lora \
  --model "$MODEL" \
  --train \
  --data "data/sft-$ROLE" \
  --mask-prompt \
  --batch-size 4 \
  --num-layers 16 \
  --iters "${ITERS:-2000}" \
  --learning-rate "${LR:-1e-4}" \
  --steps-per-eval 200 \
  --val-batches 25 \
  --save-every 200 \
  --adapter-path "$RUN/adapter" | tee "$RUN/train.log"

"$PY" -m mlx_lm fuse --model "$MODEL" --adapter-path "$RUN/adapter" --save-path "models/redstring-$(basename "$RUN")"
echo "fused into models/redstring-$(basename "$RUN"): load it in LM Studio, then judge it with its role's benchmark (npm run druid:bench or npm run wizard:bench)"
